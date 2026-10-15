import {
  expireFinishGrace,
  finishMatch,
  requestFinish,
  type MatchState,
  type Transition,
} from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import type { Tx } from '../../db/transaction';
import type { DeadlineRegistry, DeadlineResult } from '../../jobs/deadlines';
import type { RoomRow } from '../../rooms/room-tx';
import { deferWhileVoting } from '../voting/clocks';
import { applyTransition, engineError } from './apply';
import { ordinals } from './commands';
import { FINISH_GRACE, HARD_LIMIT, MATCH_LIMIT, loadMatch, type LoadedMatch } from './store';

/**
 * Match endings (rules §6.2, ADR-023), all through the pure engine under the
 * room lock:
 * - soft time limit: an open chain may settle, so the end is requested and the
 *   match finishes at the next normal boundary (`finishPending`);
 * - grace expiry: a chain still unsettled after 60 s is restored to deck fronts
 *   and the match finishes;
 * - hard ceiling: always ends now, restoring any open chain.
 * Handlers re-validate under the lock and no-op when the match already ended.
 */
export async function endCardMatch(
  tx: Tx,
  secrets: Secrets,
  room: RoomRow,
  now: Date,
  transition: (match: LoadedMatch) => Transition | null,
): Promise<DeadlineResult> {
  if (room.game_type !== 'card' || room.lifecycle !== 'RUNNING') return {};
  const match = await loadMatch(tx, room.id);
  if (!match || match.state.result) return {};
  let t: Transition | null;
  try {
    t = transition(match);
  } catch (error) {
    engineError(error);
  }
  if (!t || t.events.length === 0) return {};
  const events = await applyTransition(
    tx,
    secrets,
    room,
    match.state,
    match.meta,
    t,
    now,
    ordinals(match.state),
  );
  return { events, bumpState: true };
}

export function registerTieService(registry: DeadlineRegistry, secrets: Secrets) {
  registry.register(MATCH_LIMIT, (tx, room, _job, now) =>
    endCardMatch(tx, secrets, room, now, ({ state }) => requestFinish(state, 'time_limit')),
  );

  registry.register(FINISH_GRACE, (tx, room, _job, now) =>
    endCardMatch(tx, secrets, room, now, ({ state }: { state: MatchState }) =>
      state.finishPending ? expireFinishGrace(state) : null,
    ),
  );

  registry.register(HARD_LIMIT, async (tx, room, job, now) => {
    // The safety ceiling waits for an open end-game vote to resolve (rules §12).
    if (await deferWhileVoting(tx, room, job)) return {};
    return endCardMatch(tx, secrets, room, now, ({ state }) => finishMatch(state, 'time_limit'));
  });
}
