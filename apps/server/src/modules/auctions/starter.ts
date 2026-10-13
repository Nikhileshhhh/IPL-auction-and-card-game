import { createHash, randomBytes } from 'node:crypto';
import {
  RNG_VERSION,
  RandomStream,
  lotOrder,
  seedCommitment,
  type CappedStatus,
  type PoolRole,
} from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import { AppError } from '../../http/app-error';
import type { GameStarter } from '../../rooms/starters';
import { JOBS } from './live-store';
import { openNextLot, scheduleJob } from './settlement';

/** Bowling styles that make a player pace or spin for the legal-XI check. */
const PACE = '(fast|medium|seam)';
const SPIN = '(break|spin|orthodox|chinaman|googly|slow left|wrist)';

/**
 * Auction starter (ADR-025). From the auction lobby it commits a fresh seed,
 * orders the lots in the real sets with a seeded shuffle inside each set, and
 * opens the first lot. The seed is disclosed when the auction ends.
 */
export function auctionStarter(secrets: Secrets): GameStarter {
  return {
    async start(tx, room, _players, now) {
      if (room.phase !== 'AUCTION_LOBBY' || !room.data_version_id) {
        throw new AppError('NOT_READY', 'Every team must lock its retentions first.', {
          reason: 'SETUP_INCOMPLETE',
        });
      }
      const game = (
        await tx.query<{ rules_hash: string }>(
          'SELECT rules_hash FROM app_private.auction_games WHERE room_id = $1',
          [room.id],
        )
      ).rows[0];
      if (!game) throw new AppError('STATE_CONFLICT', 'This room has no auction.');
      await tx.query(
        `UPDATE app_private.auction_pool ap
            SET bowl_type = CASE WHEN ap.role NOT IN ('bowler', 'all_rounder') THEN NULL
                                 WHEN p.bowling_style ~* '${PACE}' THEN 'pace'
                                 WHEN p.bowling_style ~* '${SPIN}' THEN 'spin' END
           FROM app_private.players p
          WHERE ap.room_id = $1 AND p.id = ap.player_id`,
        [room.id],
      );
      const pool = await tx.query<{
        player_id: string;
        name: string;
        role: PoolRole;
        capped_status: CappedStatus;
        base_price: string;
      }>(
        `SELECT ap.player_id, p.canonical_name AS name, ap.role, ap.capped_status, ap.base_price::text
           FROM app_private.auction_pool ap JOIN app_private.players p ON p.id = ap.player_id
          WHERE ap.room_id = $1 AND ap.status = 'available'`,
        [room.id],
      );
      const configHash = createHash('sha256')
        .update(
          `${game.rules_hash}:${room.id}:${pool.rows
            .map((r) => r.player_id)
            .sort()
            .join(',')}`,
        )
        .digest('hex');
      const seed = randomBytes(32);
      const commitment = seedCommitment(seed, room.id, configHash);
      const order = lotOrder(
        pool.rows.map((r) => ({
          playerId: r.player_id,
          name: r.name,
          role: r.role,
          cappedStatus: r.capped_status,
          basePrice: BigInt(r.base_price),
        })),
        new RandomStream(seed, 'lots'),
      );
      // Two steps keep UQ(room, order_index) valid row by row.
      await tx.query(
        'UPDATE app_private.auction_pool SET order_index = order_index + 1000000 WHERE room_id = $1',
        [room.id],
      );
      await tx.query(
        `UPDATE app_private.auction_pool ap SET order_index = u.ord - 1
           FROM unnest($2::uuid[]) WITH ORDINALITY AS u(player_id, ord)
          WHERE ap.room_id = $1 AND ap.player_id = u.player_id`,
        [room.id, order.map((p) => p.playerId)],
      );
      await tx.query(
        `UPDATE app_private.auction_games
            SET seed_commitment = $2, seed_ciphertext = $3, rng_version = $4
          WHERE room_id = $1`,
        [
          room.id,
          commitment,
          Buffer.from(
            secrets.encryptor.encrypt(Buffer.from(seed).toString('hex'), `auction-seed:${room.id}`),
          ),
          RNG_VERSION,
        ],
      );
      // The 8-hour ceiling ends the auction at a safe point whatever happens.
      await scheduleJob(
        tx,
        room.id,
        JOBS.hardLimit,
        null,
        0,
        new Date(now.getTime() + 480 * 60_000),
      );
      const events = await openNextLot(tx, { ...room, lifecycle: 'RUNNING' }, now);
      // A pool nobody can buy from ends at once (openNextLot moved it to FINALIZING).
      const ended = events.some((e) => e.type === 'game.finalizing');
      return {
        phase: ended ? 'FINALIZING' : 'AUCTION',
        lifecycle: ended ? 'FINALIZING' : 'RUNNING',
        dataVersionId: room.data_version_id,
        events: [
          {
            audience: { kind: 'public' },
            type: 'game.started',
            payload: {
              stateVersion: (BigInt(room.state_version) + 1n).toString(),
              seedCommitment: commitment,
              dataVersion: room.data_version_id,
              rulesHash: game.rules_hash,
            },
          },
          ...events,
        ],
      };
    },
  };
}
