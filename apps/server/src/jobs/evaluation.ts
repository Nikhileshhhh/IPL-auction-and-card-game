import {
  OPTIMIZER_CHUNK,
  XI_RULES,
  binomial,
  initialState,
  optimizeChunk,
  prepare,
  type OptimizerState,
} from '@stumps/game-engines';
import type { Secrets } from '../config/secrets';
import { finalizeAuctionRoom, type BestXi } from '../modules/achievements/auction';
import { loadEvaluationInput } from '../modules/achievements/auction-input';
import { EVALUATE_JOB } from '../modules/auctions/settlement';
import type { DeadlineRegistry } from './deadlines';

/**
 * Exact squad evaluation after an auction (rules §10, DB/realtime §4,
 * ADR-029). Each run works for a bounded slice (chunks of 10,000 XI
 * combinations), checkpoints the cursor and best XI with the input hash, and
 * reschedules itself; a restart resumes from the checkpoint and a changed
 * input restarts from zero. Medals are minted only once every squad is done.
 */

/** Work per run before yielding to other rooms and commands. */
export const EVALUATION_SLICE_MS = 250;

interface Cursor {
  index: number;
  state: OptimizerState | null;
  /** Last progress published, so progress events are not spammed. */
  published: number;
}

export function registerEvaluationJob(registry: DeadlineRegistry, secrets: Secrets) {
  registry.register(EVALUATE_JOB, async (tx, room, _job, now) => {
    if (room.game_type !== 'auction' || room.lifecycle !== 'FINALIZING') return {};
    const input = await loadEvaluationInput(tx, room);
    const saved = (
      await tx.query<{
        evaluation_input_hash: string | null;
        evaluation_cursor: Cursor | null;
        evaluation_best: Record<string, BestXi> | null;
      }>(
        `SELECT evaluation_input_hash, evaluation_cursor, evaluation_best
           FROM app_private.auction_games WHERE room_id = $1`,
        [room.id],
      )
    ).rows[0];
    const fresh = saved?.evaluation_input_hash !== input.hash;
    let cursor: Cursor =
      fresh || !saved?.evaluation_cursor
        ? { index: 0, state: null, published: 0 }
        : saved.evaluation_cursor;
    const best: Record<string, BestXi> = fresh ? {} : { ...(saved?.evaluation_best ?? {}) };

    const started = Date.now();
    while (cursor.index < input.squads.length && Date.now() - started < EVALUATION_SLICE_MS) {
      const squad = input.squads[cursor.index];
      if (!squad) break;
      if (squad.players.length < XI_RULES.size || squad.players.length > 25) {
        best[squad.franchiseId] = { bestObjective: null, bestMask: null };
        cursor = { ...cursor, index: cursor.index + 1, state: null };
        continue;
      }
      const prep = prepare(squad.players, input.rules);
      let state = cursor.state ?? initialState(prep);
      while (state.cursor < state.total && Date.now() - started < EVALUATION_SLICE_MS) {
        state = optimizeChunk(prep, state, OPTIMIZER_CHUNK);
      }
      if (state.cursor >= state.total) {
        best[squad.franchiseId] = { bestObjective: state.bestObjective, bestMask: state.bestMask };
        cursor = { ...cursor, index: cursor.index + 1, state: null };
      } else {
        cursor = { ...cursor, state };
      }
    }

    if (cursor.index >= input.squads.length) {
      const events = await finalizeAuctionRoom(tx, secrets, room, input, best, now);
      await tx.query(
        `UPDATE app_private.auction_games
            SET evaluation_input_hash = $2, evaluation_cursor = $3, evaluation_best = $4
          WHERE room_id = $1`,
        [room.id, input.hash, JSON.stringify({ ...cursor, published: 100 }), JSON.stringify(best)],
      );
      return { events, bumpState: true };
    }

    // Progress over all squads' combinations.
    const totals = input.squads.map((s) =>
      s.players.length >= XI_RULES.size && s.players.length <= 25
        ? binomial(s.players.length, XI_RULES.size)
        : 0,
    );
    const all = totals.reduce((a, b) => a + b, 0) || 1;
    const done =
      totals.slice(0, cursor.index).reduce((a, b) => a + b, 0) + (cursor.state?.cursor ?? 0);
    const percent = Math.min(99, Math.floor((done * 100) / all));
    const publish = percent - cursor.published >= 5;
    cursor = { ...cursor, published: publish ? percent : cursor.published };
    await tx.query(
      `UPDATE app_private.auction_games
          SET evaluation_input_hash = $2, evaluation_cursor = $3, evaluation_best = $4,
              evaluation_generation = evaluation_generation + CASE WHEN $5 THEN 1 ELSE 0 END
        WHERE room_id = $1`,
      [room.id, input.hash, JSON.stringify(cursor), JSON.stringify(best), fresh],
    );
    await tx.query(
      `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
       VALUES ($1, '${EVALUATE_JOB}', NULL, 0, $2)
       ON CONFLICT (room_id, kind, subject_id, generation) DO UPDATE SET due_at = EXCLUDED.due_at`,
      [room.id, now],
    );
    return publish
      ? {
          events: [
            {
              audience: { kind: 'public' },
              type: 'game.evaluationProgress',
              payload: { stage: 'evaluating', progressPercent: percent },
            },
          ],
        }
      : {};
  });
}
