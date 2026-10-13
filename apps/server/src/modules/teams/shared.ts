import type { CommandEnvelope, EventType } from '@stumps/contracts';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import type { MemberRow } from '../../rooms/projection';
import { runRoomCommand, type RoomRow } from '../../rooms/room-tx';
import type { EventDraft } from '../../rooms/streams';
import { teamMembership, type TeamMemberRow } from '../auctions/setup';
import type { RoomDeps } from '../rooms/service';

/**
 * Shared rules for team commands (ADR-026). Every capability is read from the
 * database under the room lock — never from a role string or the client — and
 * the room host has no team powers unless they are on the team themselves.
 */

export const teamAudience = (franchiseId: string): EventDraft['audience'] => ({
  kind: 'team',
  franchiseId,
});
export const memberAudience = (memberId: string): EventDraft['audience'] => ({
  kind: 'member',
  memberId,
});
export const draft = (
  audience: EventDraft['audience'],
  type: EventType,
  payload: Record<string, unknown>,
): EventDraft => ({ audience, type, payload });

/** Team work happens before and during the auction, never after it ends. */
export function requireTeamRoom(room: RoomRow) {
  if (room.game_type !== 'auction') {
    throw new AppError('GAME_MISMATCH', 'Teams belong to the auction.');
  }
  if (room.lifecycle !== 'LOBBY' && room.lifecycle !== 'RUNNING') {
    throw new AppError('STATE_CONFLICT', 'The auction has ended.', { lifecycle: room.lifecycle });
  }
}

/**
 * Re-check the tab's control epoch under the room lock: a takeover that lands
 * between the dispatcher's check and this handler still fences the old tab.
 */
export function requireCurrentControl(
  member: MemberRow,
  env: Pick<CommandEnvelope, 'controlEpoch'>,
) {
  if (member.control_epoch !== env.controlEpoch) {
    throw new AppError(
      'CONTROL_EPOCH_STALE',
      'Another tab is in control. Take control to act here.',
    );
  }
}

export async function requireTeamMember(
  tx: Tx,
  room: RoomRow,
  member: MemberRow,
): Promise<TeamMemberRow> {
  const mine = await teamMembership(tx, room.id, member.id);
  if (!mine) throw new AppError('FORBIDDEN', 'You are not in a team in this room.');
  return mine;
}

export async function requireCaptain(
  tx: Tx,
  room: RoomRow,
  member: MemberRow,
): Promise<TeamMemberRow> {
  const mine = await teamMembership(tx, room.id, member.id);
  if (!mine || mine.role !== 'captain') {
    throw new AppError('FORBIDDEN', 'Only the team captain can do this.');
  }
  return mine;
}

export const isCaptain = (m: TeamMemberRow) => m.role === 'captain';
export const canStrategy = (m: TeamMemberRow) => isCaptain(m) || m.can_strategy;
export const canManageLimits = (m: TeamMemberRow) => isCaptain(m) || m.can_manage_limits;

/** Approved after the auction started: observer/advisor only, no medal this game (rules §11). */
export const isLateJoiner = (room: RoomRow, eligibleAtStart: boolean) =>
  room.lifecycle !== 'LOBBY' && !eligibleAtStart;

/** Bump the franchise control epoch (fences an automated controller, phase 12). */
export async function bumpControlEpoch(tx: Tx, teamId: string): Promise<string> {
  const res = await tx.query<{ control_epoch: string }>(
    `UPDATE app_private.auction_franchises SET control_epoch = control_epoch + 1
      WHERE id = $1 RETURNING control_epoch::text`,
    [teamId],
  );
  return res.rows[0]?.control_epoch ?? '0';
}

export function runTeamCommand<T>(
  deps: RoomDeps,
  actorUserId: string,
  env: CommandEnvelope,
  payload: unknown,
  handler: Parameters<typeof runRoomCommand<T>>[2],
) {
  return runRoomCommand<T>(
    deps.pool,
    {
      roomId: env.roomId,
      actorKey: `user:${actorUserId}`,
      commandId: env.commandId,
      body: { type: env.type, payload },
    },
    handler,
    { settleDue: deps.settleDue, wake: deps.wake },
  );
}
