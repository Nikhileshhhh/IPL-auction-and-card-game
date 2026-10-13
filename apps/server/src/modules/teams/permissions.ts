import { TeamPermissionsPayload } from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import { requireMembership } from '../../rooms/projection';
import type { CommandDispatcher } from '../commands/dispatcher';
import {
  bumpControlEpoch,
  draft,
  isLateJoiner,
  requireCaptain,
  requireCurrentControl,
  requireTeamRoom,
  runTeamCommand,
  teamAudience,
} from './shared';

/**
 * Capability delegation (rules §9, ADR-026). Only the captain edits a
 * teammate's role and capabilities; a second captain is impossible (captaincy
 * moves only by consent, see handover.ts); one co-captain per team; a late
 * joiner stays an observer/advisor. Every change bumps the member's
 * capability version and the franchise control epoch. A bid already queued
 * by a member whose right was just revoked is refused, because capabilities
 * are read under the room lock when the bid is handled.
 */
export function registerPermissionCommands(commands: CommandDispatcher) {
  commands.register('team.permissions', async (deps, actor, env) => {
    const payload = TeamPermissionsPayload.parse(env.payload);
    return runTeamCommand(deps, actor.userId, env, payload, async ({ tx, room }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireTeamRoom(room);
      requireCurrentControl(member, env);
      const mine = await requireCaptain(tx, room, member);
      const teamId = mine.auction_franchise_id;
      const target = (
        await tx.query<{ role: string; eligible_at_start: boolean }>(
          `SELECT role, eligible_at_start FROM app_private.franchise_members
            WHERE auction_franchise_id = $1 AND member_id = $2`,
          [teamId, payload.memberId],
        )
      ).rows[0];
      if (!target) throw new AppError('NOT_FOUND', 'That person is not in your team.');
      if (target.role === 'captain') {
        throw new AppError('STATE_CONFLICT', 'Hand over the captaincy to change your own role.', {
          reason: 'CAPTAIN_ROLE',
        });
      }
      const c = payload.capabilities;
      if (isLateJoiner(room, target.eligible_at_start)) {
        const elevated =
          payload.role !== 'advisor' ||
          c.bid ||
          c.rtm ||
          c.invite ||
          c.retainPropose ||
          c.manageLimits;
        if (elevated) {
          throw new AppError(
            'RULE_VIOLATION',
            'Someone who joined after the start can only observe and advise.',
            { reason: 'LATE_JOINER' },
          );
        }
      }
      if (payload.role === 'cocaptain') {
        const other = await tx.query(
          `SELECT 1 FROM app_private.franchise_members
            WHERE auction_franchise_id = $1 AND role = 'cocaptain' AND member_id <> $2`,
          [teamId, payload.memberId],
        );
        if (other.rowCount) {
          throw new AppError('STATE_CONFLICT', 'Your team already has a co-captain.', {
            reason: 'COCAPTAIN_TAKEN',
          });
        }
      }
      const version = (
        await tx.query<{ capability_version: string }>(
          `UPDATE app_private.franchise_members
              SET role = $3, can_bid = $4, can_invite = $5, can_strategy = $6,
                  can_retain_propose = $7, can_rtm = $8, can_manage_limits = $9,
                  capability_version = capability_version + 1
            WHERE auction_franchise_id = $1 AND member_id = $2
            RETURNING capability_version::text`,
          [
            teamId,
            payload.memberId,
            payload.role,
            c.bid,
            c.invite,
            c.strategy,
            c.retainPropose,
            c.rtm,
            c.manageLimits,
          ],
        )
      ).rows[0]?.capability_version;
      await bumpControlEpoch(tx, teamId);
      return {
        reply: { version: version ?? '0' },
        events: [
          draft(teamAudience(teamId), 'team.permissionsChanged', {
            memberId: payload.memberId,
            role: payload.role,
            capabilities: c,
            version: version ?? '0',
          }),
        ],
        bumpState: true,
        touch: true,
      };
    });
  });
}
