import { CARD_METRICS, type ArenaCardDTO, type CardSettings } from '@stumps/contracts';
import {
  CardEngineError,
  RNG_VERSION,
  displayRating,
  type CardEngineEvent,
  type MatchState,
  type Transition,
} from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import type { RoomRow } from '../../rooms/room-tx';
import type { EventDraft } from '../../rooms/streams';
import { cardsByDefinition } from '../cricket-data/read';
import { FINISH_GRACE, FINISH_GRACE_SECONDS, persistTransition, type MatchMeta } from './store';

const PUBLIC = { kind: 'public' } as const;

/** Engine refusals become the catalogued API errors (DB/realtime §8.2). */
export function engineError(error: unknown): never {
  if (error instanceof CardEngineError) {
    switch (error.code) {
      case 'SELECTOR_ONLY':
        throw new AppError('SELECTOR_ONLY', 'Only the selector can choose a category.');
      case 'STALE_COMPARISON':
        throw new AppError('STALE_COMPARISON', 'That comparison has already been decided.');
      case 'METRIC_NOT_ALLOWED':
        throw new AppError('RULE_VIOLATION', 'That category is not available.');
      case 'GAME_FINISHED':
        throw new AppError('ALREADY_COMPLETED', 'This match has finished.');
      case 'POOL_INSUFFICIENT':
        throw new AppError('POOL_INSUFFICIENT', error.message);
      case 'CONFIG_INVALID':
        throw new AppError('CONFIG_INVALID', error.message);
      default:
        throw new AppError('INTERNAL', 'The match state is inconsistent.');
    }
  }
  throw error;
}

export function cardSettings(room: RoomRow): CardSettings {
  return room.settings as unknown as CardSettings;
}

/** Revealed cards as public card DTOs (portrait included, ADR-017). */
export async function arenaCards(
  tx: Tx,
  state: MatchState,
  instanceIds: readonly string[],
): Promise<Map<string, ArenaCardDTO>> {
  const defs = await cardsByDefinition(
    tx,
    instanceIds.map((id) => state.instances[id]?.definitionId ?? ''),
  );
  const out = new Map<string, ArenaCardDTO>();
  for (const id of instanceIds) {
    const card = defs.get(state.instances[id]?.definitionId ?? '');
    if (!card) throw new AppError('INTERNAL', 'A dealt card is missing from its data version.');
    out.set(id, { ...card, instanceId: id });
  }
  return out;
}

export function openSeed(secrets: Secrets, room: { id: string }, ciphertext: Buffer): string {
  return secrets.encryptor.decrypt(ciphertext.toString('utf8'), `card-seed:${room.id}`);
}

/**
 * Persist a transition and translate its engine events into public events
 * (ratings shown as whole numbers 0–100). A finished match moves the room to
 * FINALIZING and discloses the seed for audit.
 */
export async function applyTransition(
  tx: Tx,
  secrets: Secrets,
  room: RoomRow,
  before: MatchState | null,
  meta: MatchMeta,
  t: Transition,
  now: Date,
  priorOrdinal: (instanceId: string) => number,
): Promise<EventDraft[]> {
  const settings = cardSettings(room);
  const { deadline } = await persistTransition(tx, room.id, t.state, t.events, {
    now,
    selectionSeconds: settings.selectionSeconds,
    before,
    priorOrdinal,
    meta,
  });
  const revealed = t.events.flatMap((e) =>
    e.type === 'roundOpened' ? e.cards.map((c) => c.instanceId) : [],
  );
  const cards = await arenaCards(tx, t.state, revealed);
  // An end requested mid-chain: the chain has at most FINISH_GRACE_SECONDS to settle.
  let graceDeadline: Date | null = null;
  if (t.events.some((e) => e.type === 'finishPending')) {
    graceDeadline = new Date(now.getTime() + FINISH_GRACE_SECONDS * 1000);
    await tx.query(
      `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
       VALUES ($1, '${FINISH_GRACE}', NULL, 0, $2)
       ON CONFLICT (room_id, kind, subject_id, generation) DO UPDATE SET due_at = EXCLUDED.due_at`,
      [room.id, graceDeadline],
    );
  }
  const drafts: EventDraft[] = [];
  for (const event of t.events)
    drafts.push(await toDraft(tx, secrets, room, event, cards, deadline, now, graceDeadline));
  if (t.state.result) {
    await tx.query(
      `UPDATE app_private.rooms SET lifecycle = 'FINALIZING', phase = 'FINISHED', match_deadline = NULL
        WHERE id = $1`,
      [room.id],
    );
  }
  return drafts;
}

async function toDraft(
  tx: Tx,
  secrets: Secrets,
  room: RoomRow,
  event: CardEngineEvent,
  cards: Map<string, ArenaCardDTO>,
  deadline: Date | null,
  now: Date,
  graceDeadline: Date | null = null,
): Promise<EventDraft> {
  switch (event.type) {
    case 'roundOpened':
      return {
        audience: PUBLIC,
        type: 'card.roundOpened',
        payload: {
          comparisonId: event.comparisonId,
          comparisonIndex: event.comparisonIndex,
          chainIndex: event.chainIndex,
          eligibleSeats: event.contributors,
          selector: event.selector,
          visibleCards: event.cards.map((c) => ({
            memberId: c.memberId,
            card: cards.get(c.instanceId),
          })),
          allowedMetrics: [...CARD_METRICS],
          deadline: (deadline ?? now).toISOString(),
          potCount: event.potCount,
          tie: event.tie,
        },
      };
    case 'comparisonResolved':
      return {
        audience: PUBLIC,
        type: 'card.comparisonResolved',
        payload: {
          comparisonId: event.comparisonId,
          metric: event.metric,
          byTimeout: event.byTimeout,
          submittedValues: event.values.map((v) => ({
            memberId: v.memberId,
            value: displayRating(v.points),
          })),
          winnerId: event.winnerId,
          tiedSeats: event.tiedSeats,
          reason: event.reason,
          fallback: event.fallback ?? null,
        },
      };
    case 'finishPending':
      return {
        audience: PUBLIC,
        type: 'game.finalizing',
        payload: {
          stage: 'finish_pending',
          progressPercent: 0,
          reason: event.reason,
          deadline: (graceDeadline ?? now).toISOString(),
        },
      };
    case 'potChanged':
      return {
        audience: PUBLIC,
        type: 'card.potChanged',
        payload: {
          potCount: event.potCount,
          awardedTo: event.awardedTo,
          awardedCount: event.awardedCount,
          deckCounts: event.deckCounts,
        },
      };
    case 'playerEliminated':
      return {
        audience: PUBLIC,
        type: 'card.playerEliminated',
        payload: {
          memberId: event.memberId,
          eliminationOrder: event.eliminationOrder,
          reason: 'NO_CARDS',
        },
      };
    case 'finished': {
      const seed = (
        await tx.query<{ seed_ciphertext: Buffer }>(
          'SELECT seed_ciphertext FROM app_private.rooms WHERE id = $1',
          [room.id],
        )
      ).rows[0]?.seed_ciphertext;
      return {
        audience: PUBLIC,
        type: 'game.completed',
        payload: {
          publicResult: event.result,
          medalStatus: 'deferred',
          resultsExpiresAt: null,
          auditSeed: seed ? openSeed(secrets, room, seed) : '',
          rngVersion: RNG_VERSION,
        },
      };
    }
  }
}
