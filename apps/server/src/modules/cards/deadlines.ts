import { randomUUID } from 'node:crypto';
import { timeoutSelection, type Transition } from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import type { DeadlineRegistry } from '../../jobs/deadlines';
import { applyTransition, engineError } from './apply';
import { ordinals } from './commands';
import { SELECTION_TIMEOUT, loadMatch } from './store';

/**
 * Card deadlines. Each handler re-validates its target under the room lock
 * and no-ops when stale (ADR-007): a selection timeout only applies to the
 * same open comparison and timer generation it was scheduled for.
 */
export function registerCardDeadlines(registry: DeadlineRegistry, secrets: Secrets) {
  registry.register(SELECTION_TIMEOUT, async (tx, room, job, now) => {
    if (room.game_type !== 'card' || room.lifecycle !== 'RUNNING') return {};
    const match = await loadMatch(tx, room.id);
    const open = match?.state.comparison;
    if (!match || !open || open.id !== job.subject_id) return {};
    if (match.meta.timerGeneration !== job.generation) return {};
    let t: Transition;
    try {
      t = timeoutSelection(match.state, { comparisonId: open.id }, randomUUID);
    } catch (error) {
      engineError(error);
    }
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
  });
}
