import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CARD_METRICS } from '@stumps/contracts';
import {
  RNG_VERSION,
  dealMatch,
  seedCommitment,
  startMatch,
  streams,
  type CardPoints,
  type DealResult,
  type MatchState,
  type Transition,
} from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import { AppError } from '../../http/app-error';
import type { MemberRow } from '../../rooms/projection';
import { canonicalJson } from '../../rooms/room-tx';
import type { GameStarter } from '../../rooms/starters';
import { currentVersion, dealPool } from '../cricket-data/read';
import { applyTransition, cardSettings, engineError } from './apply';
import { MATCH_LIMIT, type MatchMeta } from './store';

/** Bumped when the card rules change in a way that alters outcomes. */
export const CARD_RULES_VERSION = 'card-rules-v1';

/** Immutable seat order: lobby seat, then join order (UUID tie-break). */
export function seatOrder(players: readonly MemberRow[]): string[] {
  return [...players]
    .sort(
      (a, b) =>
        (a.seat ?? Number.MAX_SAFE_INTEGER) - (b.seat ?? Number.MAX_SAFE_INTEGER) ||
        a.joined_at.getTime() - b.joined_at.getTime() ||
        (a.id < b.id ? -1 : 1),
    )
    .map((p) => p.id);
}

/**
 * Card starter (rules §4): inside the start transaction it freezes the data
 * version, commits a fresh 256-bit seed (sealed with the data key, disclosed
 * only when the match completes), deals through the pure engine and opens the
 * first comparison. A rollback leaves no partial match (one transaction).
 */
export function cardStarter(secrets: Secrets): GameStarter {
  return {
    async start(tx, room, players, now) {
      const settings = cardSettings(room);
      const version = await currentVersion(tx);
      if (!version) throw new AppError('POOL_INSUFFICIENT', 'No published card data is available.');
      const pool = await dealPool(tx, version.id);
      const seats = seatOrder(players);
      const configHash = createHash('sha256')
        .update(
          canonicalJson({
            rules: CARD_RULES_VERSION,
            rng: RNG_VERSION,
            dataVersion: version.id,
            seats,
            settings,
          }),
        )
        .digest('hex');
      const roomNonce = room.id;
      const seed = randomBytes(32);
      const commitment = seedCommitment(seed, roomNonce, configHash);
      const rng = streams(seed);

      let deal: DealResult;
      let opened: Transition;
      try {
        deal = dealMatch({
          pool: pool.map((d) => ({
            definitionId: d.id,
            rarity: d.rarity,
            ratings: d.ratings as unknown as CardPoints,
          })),
          seats,
          totalCards: settings.totalCards,
          enabledRarities: settings.rarities,
          mode: settings.dealMode,
          streams: rng,
          newId: randomUUID,
        });
        opened = startMatch({
          seats,
          instances: deal.instances,
          decks: deal.decks,
          selector: deal.selector,
          fallbackOrder: deal.fallbackOrder,
          tieCap: settings.tieCap,
          newId: randomUUID,
        });
      } catch (error) {
        engineError(error);
      }

      const matchDeadline = settings.matchMinutes
        ? new Date(now.getTime() + settings.matchMinutes * 60_000)
        : null;
      await tx.query(
        `UPDATE app_private.rooms SET seed_commitment = $2, seed_ciphertext = $3, match_deadline = $4 WHERE id = $1`,
        [
          room.id,
          commitment,
          Buffer.from(
            secrets.encryptor.encrypt(Buffer.from(seed).toString('hex'), `card-seed:${room.id}`),
          ),
          matchDeadline,
        ],
      );
      await tx.query(
        `INSERT INTO app_private.card_games
           (room_id, total_cards, tie_cap, deal_mode, allowed_metrics, rng_version, rng_draws, room_nonce,
            config_hash, fallback_order, chain_selector_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          room.id,
          settings.totalCards,
          settings.tieCap,
          settings.dealMode,
          [...CARD_METRICS],
          RNG_VERSION,
          JSON.stringify({
            deal: rng.deal.draws,
            seats: rng.seats.draws,
            fallback: rng.fallback.draws,
          }),
          roomNonce,
          configHash,
          deal.fallbackOrder,
          deal.selector,
        ],
      );
      await tx.query(
        `INSERT INTO app_private.card_seats (room_id, member_id, seat_order, chain_start_count)
         SELECT $1, u.member_id, u.ord - 1, $3 FROM unnest($2::uuid[]) WITH ORDINALITY AS u(member_id, ord)`,
        [room.id, seats, settings.totalCards / seats.length],
      );
      if (matchDeadline) {
        await tx.query(
          `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
           VALUES ($1, '${MATCH_LIMIT}', NULL, 0, $2)`,
          [room.id, matchDeadline],
        );
      }

      const meta: MatchMeta = {
        totalCards: settings.totalCards,
        tieCap: settings.tieCap,
        dealMode: settings.dealMode,
        rngVersion: RNG_VERSION,
        roomNonce,
        configHash,
        phaseDeadline: null,
        timerGeneration: '0',
        finishPending: false,
      };
      const dealtAt = new Map(deal.decks.flatMap((deck) => deck.map((id, i) => [id, i] as const)));
      const events = await applyTransition(
        tx,
        secrets,
        room,
        null as MatchState | null,
        meta,
        opened,
        now,
        (id) => dealtAt.get(id) ?? 0,
      );
      return {
        phase: 'CARD_MATCH',
        dataVersionId: version.id,
        events: [
          {
            audience: { kind: 'public' },
            type: 'game.started',
            payload: {
              stateVersion: (BigInt(room.state_version) + 1n).toString(),
              seedCommitment: commitment,
              dataVersion: version.id,
              rulesHash: configHash,
            },
          },
          ...events,
        ],
      };
    },
  };
}
