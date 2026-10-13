import { randomUUID } from 'node:crypto';
import { RevealAcknowledgedPayload, SelectCategoryPayload } from '@stumps/contracts';
import { selectCategory, type MatchState, type Transition } from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import { withTransaction } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { requireMembership } from '../../rooms/projection';
import { requireNotRecovering, runRoomCommand, type RoomRow } from '../../rooms/room-tx';
import type { CommandDispatcher } from '../commands/dispatcher';
import { applyTransition, engineError } from './apply';
import { loadMatch } from './store';

function requireRunningCard(room: RoomRow) {
  if (room.game_type !== 'card') throw new AppError('GAME_MISMATCH', 'This is not a card room.');
  if (room.lifecycle !== 'RUNNING')
    throw new AppError('STATE_CONFLICT', 'The match is not running.', {
      lifecycle: room.lifecycle,
    });
}

/** Deck position of each card in a state (contribution history). */
export function ordinals(state: MatchState): (instanceId: string) => number {
  const at = new Map(state.seats.flatMap((s) => s.deck.map((id, i) => [id, i] as const)));
  return (id) => at.get(id) ?? 0;
}

/**
 * Card commands (DB/realtime §8.2). `card.selectCategory` is the only card
 * write: the selector's category for the open comparison, decided by the
 * pure reducer under the room lock. Validation order: membership → running
 * match → comparison/selector (engine) → expected state version.
 */
export function registerCardCommands(commands: CommandDispatcher, secrets: Secrets) {
  commands.register('card.selectCategory', async (deps, actor, env) => {
    const payload = SelectCategoryPayload.parse(env.payload);
    return runRoomCommand(
      deps.pool,
      {
        roomId: env.roomId,
        actorKey: `user:${actor.userId}`,
        commandId: env.commandId,
        body: { type: env.type, expectedVersion: env.expectedVersion, payload },
      },
      async ({ tx, room, now }) => {
        const member = await requireMembership(tx, room.id, actor.userId);
        requireRunningCard(room);
        requireNotRecovering(room, now);
        const match = await loadMatch(tx, room.id);
        if (!match) throw new AppError('STATE_CONFLICT', 'The match has not been dealt.');
        let t: Transition;
        try {
          t = selectCategory(
            match.state,
            { actor: member.id, comparisonId: payload.comparisonId, metric: payload.metric },
            randomUUID,
          );
        } catch (error) {
          engineError(error);
        }
        // Every gameplay transition closes the open comparison, so a matching
        // comparison with a different version means the client skipped events.
        if (env.expectedVersion !== room.state_version) {
          throw new AppError('VERSION_CONFLICT', 'Your view is out of date. Refreshing.', {
            stateVersion: room.state_version,
          });
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
        return {
          reply: {
            comparisonId: payload.comparisonId,
            stateVersion: (BigInt(room.state_version) + 1n).toString(),
          },
          bumpState: true,
          touch: true,
          events,
        };
      },
      { settleDue: deps.settleDue, wake: deps.wake },
    );
  });

  /** Cosmetic: the client finished a reveal animation. No state is written. */
  commands.register('card.revealAcknowledged', async (deps, actor, env) => {
    RevealAcknowledgedPayload.parse(env.payload);
    return withTransaction(
      deps.pool,
      async (tx) => {
        await requireMembership(tx, env.roomId, actor.userId);
        return { accepted: true as const };
      },
      { readOnly: true },
    );
  });
}
