import type { CardMetric } from '@stumps/contracts';
import type {
  CardEngineEvent,
  CardInstance,
  CardPoints,
  MatchResult,
  MatchState,
  PotCard,
} from '@stumps/game-engines';
import type { Tx } from '../../db/transaction';

/**
 * Persistence of a card match (DB spec §5.2). `card_instances` is the location
 * authority; engine state is rebuilt from rows under the room lock and every
 * transition is written back as row changes in the same transaction.
 */

export interface MatchMeta {
  totalCards: number;
  tieCap: number;
  dealMode: 'stratified' | 'random';
  rngVersion: string;
  roomNonce: string;
  configHash: string;
  phaseDeadline: Date | null;
  timerGeneration: string;
  finishPending: boolean;
}

export interface LoadedMatch {
  state: MatchState;
  meta: MatchMeta;
}

export const SELECTION_TIMEOUT = 'card.selection_timeout';
export const MATCH_LIMIT = 'card.match_limit';

interface GameRow {
  total_cards: number;
  tie_cap: number;
  deal_mode: 'stratified' | 'random';
  chain_selector_id: string | null;
  chain_index: number;
  comparison_index: number;
  tie_count: number;
  tied_member_ids: string[];
  phase_deadline: Date | null;
  timer_generation: string;
  finish_pending: boolean;
  rng_version: string;
  room_nonce: string;
  config_hash: string;
  fallback_order: string[];
  completed_contests: number;
  eliminations: number;
  result: MatchResult | null;
}

interface InstanceRow {
  id: string;
  definition_id: string;
  ratings: CardPoints;
  location: 'DECK' | 'ACTIVE' | 'POT';
  owner_member_id: string | null;
  ordinal: string | null;
  comparison_id: string | null;
  contributor_member_id: string | null;
  pot_order: string | null;
  comparison_index: number | null;
}

/** Rebuild the engine state of a room's match (caller holds the room lock). */
export async function loadMatch(tx: Tx, roomId: string): Promise<LoadedMatch | null> {
  const game = (
    await tx.query<GameRow>(
      `SELECT total_cards, tie_cap, deal_mode, chain_selector_id, chain_index, comparison_index, tie_count,
              tied_member_ids, phase_deadline, timer_generation::text, finish_pending, rng_version, room_nonce,
              config_hash, fallback_order, completed_contests, eliminations, result
         FROM app_private.card_games WHERE room_id = $1`,
      [roomId],
    )
  ).rows[0];
  if (!game) return null;
  const seats = await tx.query<{
    member_id: string;
    eliminated_chain: number | null;
    elimination_order: number | null;
    chain_start_count: number;
    contests_won: number;
  }>(
    `SELECT member_id, eliminated_chain, elimination_order, chain_start_count, contests_won
       FROM app_private.card_seats WHERE room_id = $1 ORDER BY seat_order`,
    [roomId],
  );
  const instances = (
    await tx.query<InstanceRow>(
      `SELECT i.id, i.definition_id, i.ratings, i.location, i.owner_member_id, i.ordinal::text,
              i.comparison_id, i.contributor_member_id, i.pot_order::text, c.comparison_index
         FROM app_private.card_instances i
         LEFT JOIN app_private.card_comparisons c ON c.id = i.comparison_id
        WHERE i.room_id = $1`,
      [roomId],
    )
  ).rows;
  const open = (
    await tx.query<{
      id: string;
      comparison_index: number;
      selector_id: string;
      eligible_ids: string[];
    }>(
      `SELECT id, comparison_index, selector_id, eligible_ids FROM app_private.card_comparisons
        WHERE room_id = $1 AND status = 'open'`,
      [roomId],
    )
  ).rows[0];
  const cycles = await tx.query<{ key: string; occurrences: number }>(
    `SELECT encode(state_hash, 'hex') AS key, occurrences FROM app_private.card_cycle_counts WHERE room_id = $1`,
    [roomId],
  );

  const byOrdinal = (a: InstanceRow, b: InstanceRow) => Number(a.ordinal) - Number(b.ordinal);
  const deckOf = (memberId: string) =>
    instances
      .filter((i) => i.location === 'DECK' && i.owner_member_id === memberId)
      .sort(byOrdinal)
      .map((i) => i.id);
  const pot: PotCard[] = instances
    .filter((i) => i.location === 'POT')
    .sort((a, b) => Number(a.pot_order) - Number(b.pot_order))
    .map((i) => ({
      memberId: i.contributor_member_id as string,
      instanceId: i.id,
      comparisonId: i.comparison_id as string,
      comparisonIndex: i.comparison_index as number,
    }));
  const active = instances.filter((i) => i.location === 'ACTIVE');

  const state: MatchState = {
    totalCards: game.total_cards,
    tieCap: game.tie_cap,
    seats: seats.rows.map((s) => ({
      memberId: s.member_id,
      deck: deckOf(s.member_id),
      eliminatedChain: s.eliminated_chain,
      eliminationOrder: s.elimination_order,
      chainStartCount: s.chain_start_count,
      contestsWon: s.contests_won,
    })),
    instances: Object.fromEntries(
      instances.map(
        (i) =>
          [
            i.id,
            { id: i.id, definitionId: i.definition_id, ratings: i.ratings } as CardInstance,
          ] as const,
      ),
    ),
    fallbackOrder: game.fallback_order,
    chainIndex: game.chain_index,
    chainSelector: game.chain_selector_id ?? '',
    tieCount: game.tie_count,
    tiedSeats: game.tied_member_ids,
    comparison: open
      ? {
          id: open.id,
          index: open.comparison_index,
          selector: open.selector_id,
          contributors: open.eligible_ids,
          active: open.eligible_ids.map((memberId) => {
            const card = active.find(
              (a) => a.comparison_id === open.id && a.contributor_member_id === memberId,
            );
            if (!card) throw new Error(`open comparison ${open.id} lacks a card for ${memberId}`);
            return { memberId, instanceId: card.id };
          }),
        }
      : null,
    lastComparisonIndex: game.comparison_index,
    pot,
    completedContests: game.completed_contests,
    eliminationsSoFar: game.eliminations,
    cycleCounts: Object.fromEntries(cycles.rows.map((c) => [c.key, c.occurrences] as const)),
    result: game.result,
  };
  return {
    state,
    meta: {
      totalCards: game.total_cards,
      tieCap: game.tie_cap,
      dealMode: game.deal_mode,
      rngVersion: game.rng_version,
      roomNonce: game.room_nonce,
      configHash: game.config_hash,
      phaseDeadline: game.phase_deadline,
      timerGeneration: game.timer_generation,
      finishPending: game.finish_pending,
    },
  };
}

interface Location {
  location: 'DECK' | 'ACTIVE' | 'POT';
  owner: string | null;
  ordinal: number | null;
  comparison: string | null;
  contributor: string | null;
  potOrder: number | null;
}

/** Where every instance is in a state (exactly one location each). */
function locations(state: MatchState): Map<string, Location> {
  const out = new Map<string, Location>();
  for (const seat of state.seats) {
    seat.deck.forEach((id, ordinal) =>
      out.set(id, {
        location: 'DECK',
        owner: seat.memberId,
        ordinal,
        comparison: null,
        contributor: null,
        potOrder: null,
      }),
    );
  }
  for (const a of state.comparison?.active ?? []) {
    out.set(a.instanceId, {
      location: 'ACTIVE',
      owner: null,
      ordinal: null,
      comparison: state.comparison?.id ?? null,
      contributor: a.memberId,
      potOrder: null,
    });
  }
  state.pot.forEach((p, potOrder) =>
    out.set(p.instanceId, {
      location: 'POT',
      owner: null,
      ordinal: null,
      comparison: p.comparisonId,
      contributor: p.memberId,
      potOrder,
    }),
  );
  return out;
}

const sameLocation = (a: Location | undefined, b: Location) =>
  a !== undefined &&
  a.location === b.location &&
  a.owner === b.owner &&
  a.ordinal === b.ordinal &&
  a.comparison === b.comparison &&
  a.contributor === b.contributor &&
  a.potOrder === b.potOrder;

export interface PersistOptions {
  now: Date;
  selectionSeconds: number;
  /** Prior state; null when the match is being created. */
  before: MatchState | null;
  /** Deck position of each card before this transition (contribution history). */
  priorOrdinal: (instanceId: string) => number;
  meta: MatchMeta;
}

/**
 * Write a transition: comparisons (from engine events, in order), instance
 * locations, contributions, seats, the game row, cycle counts and the
 * selection deadline job. Returns the new deadline (null when none is open).
 */
export async function persistTransition(
  tx: Tx,
  roomId: string,
  after: MatchState,
  events: readonly CardEngineEvent[],
  opts: PersistOptions,
): Promise<{ deadline: Date | null; timerGeneration: string }> {
  const { now } = opts;
  const opened: Extract<CardEngineEvent, { type: 'roundOpened' }>[] = [];
  for (const event of events) {
    if (event.type === 'comparisonResolved') {
      await tx.query(
        `UPDATE app_private.card_comparisons
            SET status = $3, metric = $4, by_timeout = $5, reason = $6, tied_ids = $7, winner_id = $8, resolved_at = $9
          WHERE room_id = $1 AND id = $2 AND status = 'open'`,
        [
          roomId,
          event.comparisonId,
          event.winnerId ? 'awarded' : 'tied',
          event.metric,
          event.byTimeout,
          event.reason,
          event.tiedSeats,
          event.winnerId,
          now,
        ],
      );
      for (const v of event.values) {
        await tx.query(
          `UPDATE app_private.card_contributions SET metric_points = $3
            WHERE comparison_id = $1 AND contributor_id = $2`,
          [event.comparisonId, v.memberId, v.points],
        );
      }
    } else if (event.type === 'roundOpened') {
      await tx.query(
        `INSERT INTO app_private.card_comparisons
           (id, room_id, chain_index, comparison_index, selector_id, is_tie, eligible_ids, opened_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          event.comparisonId,
          roomId,
          event.chainIndex,
          event.comparisonIndex,
          event.selector,
          event.tie,
          event.contributors,
          now,
        ],
      );
      opened.push(event);
    }
  }
  // A match ended mid-chain (time limit): its open comparison is cancelled.
  await tx.query(
    `UPDATE app_private.card_comparisons SET status = 'cancelled', resolved_at = $3
      WHERE room_id = $1 AND status = 'open' AND id IS DISTINCT FROM $2`,
    [roomId, after.comparison?.id ?? null, now],
  );

  // Instance locations: insert all at creation, otherwise only the moved ones.
  const before = opts.before ? locations(opts.before) : null;
  const moved = [...locations(after)].filter(
    ([id, loc]) => !before || !sameLocation(before.get(id), loc),
  );
  const cols = {
    id: moved.map(([id]) => id),
    location: moved.map(([, l]) => l.location),
    owner: moved.map(([, l]) => l.owner),
    ordinal: moved.map(([, l]) => l.ordinal),
    comparison: moved.map(([, l]) => l.comparison),
    contributor: moved.map(([, l]) => l.contributor),
    potOrder: moved.map(([, l]) => l.potOrder),
  };
  if (!before) {
    await tx.query(
      `INSERT INTO app_private.card_instances
         (id, room_id, definition_id, ratings, location, owner_member_id, ordinal, comparison_id,
          contributor_member_id, pot_order)
       SELECT u.id, $1, u.definition_id, u.ratings, u.location, u.owner, u.ordinal, u.cmp, u.contrib, u.pot_order
         FROM unnest($2::uuid[], $3::uuid[], $4::jsonb[], $5::text[], $6::uuid[], $7::bigint[], $8::uuid[],
                     $9::uuid[], $10::bigint[])
              AS u(id, definition_id, ratings, location, owner, ordinal, cmp, contrib, pot_order)`,
      [
        roomId,
        cols.id,
        cols.id.map((id) => after.instances[id]?.definitionId),
        cols.id.map((id) => JSON.stringify(after.instances[id]?.ratings)),
        cols.location,
        cols.owner,
        cols.ordinal,
        cols.comparison,
        cols.contributor,
        cols.potOrder,
      ],
    );
  } else if (moved.length > 0) {
    await tx.query(
      `UPDATE app_private.card_instances i
          SET location = u.location, owner_member_id = u.owner, ordinal = u.ordinal, comparison_id = u.cmp,
              contributor_member_id = u.contrib, pot_order = u.pot_order
         FROM unnest($2::uuid[], $3::text[], $4::uuid[], $5::bigint[], $6::uuid[], $7::uuid[], $8::bigint[])
              AS u(id, location, owner, ordinal, cmp, contrib, pot_order)
        WHERE i.room_id = $1 AND i.id = u.id`,
      [
        roomId,
        cols.id,
        cols.location,
        cols.owner,
        cols.ordinal,
        cols.comparison,
        cols.contributor,
        cols.potOrder,
      ],
    );
  }

  // Contribution history for each comparison opened in this transition.
  const seatOrder = new Map(after.seats.map((s, i) => [s.memberId, i] as const));
  for (const event of opened) {
    for (const card of event.cards) {
      await tx.query(
        `INSERT INTO app_private.card_contributions
           (room_id, comparison_id, instance_id, contributor_id, seat_order, original_ordinal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          roomId,
          event.comparisonId,
          card.instanceId,
          card.memberId,
          seatOrder.get(card.memberId),
          opts.priorOrdinal(card.instanceId),
        ],
      );
    }
  }

  await tx.query(
    `UPDATE app_private.card_seats s
        SET eliminated_chain = u.eliminated_chain, elimination_order = u.elimination_order,
            chain_start_count = u.chain_start_count, contests_won = u.contests_won, next_tail_ordinal = u.deck_count
       FROM unnest($2::uuid[], $3::int[], $4::int[], $5::int[], $6::int[], $7::bigint[])
            AS u(member_id, eliminated_chain, elimination_order, chain_start_count, contests_won, deck_count)
      WHERE s.room_id = $1 AND s.member_id = u.member_id`,
    [
      roomId,
      after.seats.map((s) => s.memberId),
      after.seats.map((s) => s.eliminatedChain),
      after.seats.map((s) => s.eliminationOrder),
      after.seats.map((s) => s.chainStartCount),
      after.seats.map((s) => s.contestsWon),
      after.seats.map((s) => s.deck.length),
    ],
  );

  // Selection deadline: a new open comparison gets a fresh timer generation.
  const reopened = after.comparison && opts.before?.comparison?.id !== after.comparison.id;
  let deadline = after.comparison ? opts.meta.phaseDeadline : null;
  let generation = opts.meta.timerGeneration;
  if (reopened || !after.comparison) {
    await tx.query(
      `DELETE FROM app_private.deadline_jobs WHERE room_id = $1 AND kind = '${SELECTION_TIMEOUT}'`,
      [roomId],
    );
  }
  if (reopened && after.comparison) {
    generation = (BigInt(generation) + 1n).toString();
    deadline = new Date(now.getTime() + opts.selectionSeconds * 1000);
    await tx.query(
      `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
       VALUES ($1, '${SELECTION_TIMEOUT}', $2, $3, $4)`,
      [roomId, after.comparison.id, generation, deadline],
    );
  }
  if (after.result) {
    await tx.query(
      `DELETE FROM app_private.deadline_jobs WHERE room_id = $1 AND kind LIKE 'card.%'`,
      [roomId],
    );
  }

  await tx.query(
    `UPDATE app_private.card_games
        SET selector_member_id = $2, chain_selector_id = $3, chain_index = $4, comparison_index = $5,
            tie_count = $6, tied_member_ids = $7, phase_deadline = $8, timer_generation = $9,
            completed_contests = $10, eliminations = $11, result = $12, finish_pending = false
      WHERE room_id = $1`,
    [
      roomId,
      after.comparison?.selector ?? null,
      after.chainSelector || null,
      after.chainIndex,
      after.lastComparisonIndex,
      after.tieCount,
      after.tiedSeats,
      deadline,
      generation,
      after.completedContests,
      after.eliminationsSoFar,
      after.result ? JSON.stringify(after.result) : null,
    ],
  );

  const changed = Object.entries(after.cycleCounts).filter(
    ([key, n]) => opts.before?.cycleCounts[key] !== n,
  );
  if (changed.length > 0) {
    await tx.query(
      `INSERT INTO app_private.card_cycle_counts (room_id, state_hash, occurrences)
       SELECT $1, decode(u.key, 'hex'), u.n FROM unnest($2::text[], $3::int[]) AS u(key, n)
       ON CONFLICT (room_id, state_hash) DO UPDATE SET occurrences = EXCLUDED.occurrences`,
      [roomId, changed.map(([k]) => k), changed.map(([, n]) => n)],
    );
  }
  return { deadline, timerGeneration: generation };
}

/** The metric values a resolved comparison recorded (S10 comparison sheet). */
export async function lastResolved(tx: Tx, roomId: string) {
  const row = (
    await tx.query<{
      id: string;
      metric: CardMetric;
      by_timeout: boolean;
      winner_id: string | null;
      tied_ids: string[];
      reason: string;
    }>(
      `SELECT id, metric, by_timeout, winner_id, tied_ids, reason FROM app_private.card_comparisons
        WHERE room_id = $1 AND status IN ('tied', 'awarded')
        ORDER BY comparison_index DESC LIMIT 1`,
      [roomId],
    )
  ).rows[0];
  if (!row) return null;
  const values = await tx.query<{ contributor_id: string; metric_points: number }>(
    `SELECT contributor_id, metric_points FROM app_private.card_contributions
      WHERE comparison_id = $1 ORDER BY seat_order`,
    [row.id],
  );
  return { ...row, values: values.rows };
}
