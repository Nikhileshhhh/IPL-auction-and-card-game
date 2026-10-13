import { CaptainAcceptPayload, CaptainProposePayload } from '@stumps/contracts';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { requireMembership } from '../../rooms/projection';
import type { CommandDispatcher } from '../commands/dispatcher';
import {
  bumpControlEpoch,
  draft,
  isLateJoiner,
  requireCaptain,
  requireCurrentControl,
  requireTeamMember,
  requireTeamRoom,
  runTeamCommand,
  teamAudience,
} from './shared';

/**
 * Captain handover by explicit consent (DB/realtime §5.2, ADR-026). The
 * captain proposes, the named teammate accepts within 60 seconds. The swap
 * happens in one room transaction: the old captain becomes co-captain, the
 * target becomes captain with every capability, then the franchise pointer
 * moves; the deferred captain check and the one-captain index guarantee a
 * single captain. The franchise control epoch is bumped.
 */

export const HANDOVER_SECONDS = 60;

/** Lapse any handover whose minute has passed (checked on the DB clock). */
export async function expireHandovers(tx: Tx, teamId: string, now: Date) {
  await tx.query(
    `UPDATE app_private.team_handovers SET status = 'expired', decided_at = $2
      WHERE auction_franchise_id = $1 AND status = 'pending' AND expires_at <= $2`,
    [teamId, now],
  );
}

export function registerHandoverCommands(commands: CommandDispatcher) {
  commands.register('team.captain.propose', async (deps, actor, env) => {
    const payload = CaptainProposePayload.parse(env.payload);
    return runTeamCommand(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireTeamRoom(room);
      requireCurrentControl(member, env);
      const mine = await requireCaptain(tx, room, member);
      const teamId = mine.auction_franchise_id;
      if (payload.memberId === member.id) {
        throw new AppError('STATE_CONFLICT', 'You are already the captain.');
      }
      const target = (
        await tx.query<{ eligible_at_start: boolean; left: boolean }>(
          `SELECT fm.eligible_at_start, m.left_at IS NOT NULL AS left
             FROM app_private.franchise_members fm JOIN app_private.room_members m ON m.id = fm.member_id
            WHERE fm.auction_franchise_id = $1 AND fm.member_id = $2`,
          [teamId, payload.memberId],
        )
      ).rows[0];
      if (!target || target.left)
        throw new AppError('NOT_FOUND', 'That person is not in your team.');
      if (isLateJoiner(room, target.eligible_at_start)) {
        throw new AppError('STATE_CONFLICT', 'Someone who joined after the start cannot captain.', {
          reason: 'LATE_JOINER',
        });
      }
      await expireHandovers(tx, teamId, now);
      // A new proposal replaces the captain's previous one.
      await tx.query(
        `UPDATE app_private.team_handovers SET status = 'cancelled', decided_at = $2
          WHERE auction_franchise_id = $1 AND status = 'pending'`,
        [teamId, now],
      );
      const expiresAt = new Date(now.getTime() + HANDOVER_SECONDS * 1000);
      const id = (
        await tx.query<{ id: string }>(
          `INSERT INTO app_private.team_handovers
             (room_id, auction_franchise_id, from_member_id, to_member_id, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [room.id, teamId, member.id, payload.memberId, expiresAt, now],
        )
      ).rows[0]?.id as string;
      const pendingHandover = {
        handoverId: id,
        fromMemberId: member.id,
        toMemberId: payload.memberId,
        expiresAt: expiresAt.toISOString(),
      };
      return {
        reply: { pendingHandover },
        events: [draft(teamAudience(teamId), 'team.captainProposed', pendingHandover)],
        bumpState: true,
        touch: true,
      };
    });
  });

  commands.register('team.captain.accept', async (deps, actor, env) => {
    const payload = CaptainAcceptPayload.parse(env.payload);
    return runTeamCommand(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireTeamRoom(room);
      requireCurrentControl(member, env);
      const mine = await requireTeamMember(tx, room, member);
      const teamId = mine.auction_franchise_id;
      const handover = (
        await tx.query<{
          from_member_id: string;
          to_member_id: string;
          status: string;
          expires_at: Date;
        }>(
          `SELECT from_member_id, to_member_id, status, expires_at FROM app_private.team_handovers
            WHERE id = $1 AND auction_franchise_id = $2`,
          [payload.handoverId, teamId],
        )
      ).rows[0];
      if (!handover || handover.to_member_id !== member.id) {
        throw new AppError('NOT_FOUND', 'There is no captaincy offer for you.');
      }
      if (handover.status !== 'pending' || handover.expires_at.getTime() <= now.getTime()) {
        await expireHandovers(tx, teamId, now);
        throw new AppError('STATE_CONFLICT', 'This captaincy offer is no longer open.', {
          reason: 'HANDOVER_CLOSED',
        });
      }
      const captain = (
        await tx.query<{ captain_member_id: string }>(
          'SELECT captain_member_id FROM app_private.auction_franchises WHERE id = $1',
          [teamId],
        )
      ).rows[0];
      if (captain?.captain_member_id !== handover.from_member_id) {
        throw new AppError('STATE_CONFLICT', 'The captain has changed since this offer.', {
          reason: 'HANDOVER_CLOSED',
        });
      }
      // Order keeps the one-captain and one-co-captain indexes valid row by row:
      // the target steps out of any co-captaincy, any other co-captain becomes a
      // bidder, the old captain becomes co-captain, then the target is captain.
      await tx.query(
        `UPDATE app_private.franchise_members SET role = 'bidder'
          WHERE auction_franchise_id = $1 AND role = 'cocaptain'`,
        [teamId],
      );
      await tx.query(
        `UPDATE app_private.franchise_members
            SET role = 'cocaptain', capability_version = capability_version + 1
          WHERE auction_franchise_id = $1 AND member_id = $2`,
        [teamId, handover.from_member_id],
      );
      await tx.query(
        `UPDATE app_private.franchise_members
            SET role = 'captain', can_bid = true, can_invite = true, can_strategy = true,
                can_retain_propose = true, can_rtm = true, can_manage_limits = true,
                capability_version = capability_version + 1
          WHERE auction_franchise_id = $1 AND member_id = $2`,
        [teamId, member.id],
      );
      await tx.query(
        'UPDATE app_private.auction_franchises SET captain_member_id = $2 WHERE id = $1',
        [teamId, member.id],
      );
      await tx.query(
        `UPDATE app_private.team_handovers SET status = 'accepted', decided_at = $2 WHERE id = $1`,
        [payload.handoverId, now],
      );
      const epoch = await bumpControlEpoch(tx, teamId);
      return {
        reply: { captainId: member.id, epoch },
        events: [
          draft(teamAudience(teamId), 'team.captainChanged', {
            memberId: member.id,
            role: 'captain',
            approved: true,
            epoch,
          }),
          draft(teamAudience(teamId), 'team.captainChanged', {
            memberId: handover.from_member_id,
            role: 'cocaptain',
            approved: true,
            epoch,
          }),
        ],
        bumpState: true,
        touch: true,
      };
    });
  });
}
