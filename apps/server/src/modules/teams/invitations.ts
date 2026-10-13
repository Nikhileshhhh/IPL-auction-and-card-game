import {
  ADVISOR_CAPABILITIES,
  DecideJoinPayload,
  InviteRotatePayload,
  RequestJoinPayload,
  type TeamCapabilities,
  type TeamRole,
} from '@stumps/contracts';
import type { Secrets } from '../../config/secrets';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { requireMembership, type MemberRow } from '../../rooms/projection';
import type { RoomRow } from '../../rooms/room-tx';
import { streamFor, type EventDraft } from '../../rooms/streams';
import type { CommandDispatcher } from '../commands/dispatcher';
import { newTeamCode, teamCodeHash, teamMembership } from '../auctions/setup';
import {
  draft,
  memberAudience,
  requireCaptain,
  requireCurrentControl,
  requireTeamRoom,
  runTeamCommand,
  teamAudience,
} from './shared';

/**
 * Team invitations (rules §9, ADR-026). A team code identifies a pending join
 * request, never membership: the captain approves each request, except for
 * accepted friends the captain has put on the auto-join list. Rotating the
 * code revokes pending code requests. A member approved after the auction
 * started is a late joiner: advisor only, no medal for this game.
 */

async function teamSize(tx: Tx, teamId: string): Promise<number> {
  const res = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM app_private.franchise_members WHERE auction_franchise_id = $1',
    [teamId],
  );
  return res.rows[0]?.n ?? 0;
}

const limitOf = (room: RoomRow) => Number(room.settings.collaboratorsPerFranchise ?? 4);

/** Accepted friends of a user, among the given user IDs. */
export async function acceptedFriends(
  tx: Tx,
  userId: string,
  candidates: readonly string[],
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const res = await tx.query<{ friend: string }>(
    `SELECT CASE WHEN low_user_id = $1 THEN high_user_id ELSE low_user_id END AS friend
       FROM app_private.friendships
      WHERE status = 'accepted' AND (low_user_id = $1 OR high_user_id = $1)
        AND (CASE WHEN low_user_id = $1 THEN high_user_id ELSE low_user_id END) = ANY($2::uuid[])`,
    [userId, candidates],
  );
  return new Set(res.rows.map((r) => r.friend));
}

/** Add an approved member; late joiners are advisors who cannot win this game's medal. */
async function admit(
  tx: Tx,
  room: RoomRow,
  teamId: string,
  memberId: string,
  role: Exclude<TeamRole, 'captain'>,
  caps: TeamCapabilities,
) {
  const late = room.lifecycle !== 'LOBBY';
  const finalRole = late ? 'advisor' : role;
  const c = late ? ADVISOR_CAPABILITIES : caps;
  await tx.query(
    `INSERT INTO app_private.franchise_members
       (room_id, auction_franchise_id, member_id, role, can_bid, can_invite, can_strategy,
        can_retain_propose, can_rtm, can_manage_limits, eligible_at_start)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false)`,
    [
      room.id,
      teamId,
      memberId,
      finalRole,
      c.bid,
      c.invite,
      c.strategy,
      c.retainPropose,
      c.rtm,
      c.manageLimits,
    ],
  );
  // One team per member: their other pending requests lapse.
  await tx.query(
    `UPDATE app_private.franchise_join_requests
        SET status = 'rejected', decided_at = now(), decided_by = NULL
      WHERE room_id = $1 AND member_id = $2 AND status = 'pending'`,
    [room.id, memberId],
  );
  return finalRole;
}

async function memberEpoch(tx: Tx, memberId: string) {
  const res = await tx.query<{ control_epoch: string; left: boolean }>(
    `SELECT control_epoch::text, left_at IS NOT NULL AS left FROM app_private.room_members WHERE id = $1`,
    [memberId],
  );
  return res.rows[0] ?? { control_epoch: '0', left: true };
}

function requirePlayer(member: MemberRow) {
  if (member.role === 'spectator') {
    throw new AppError('FORBIDDEN', 'Spectators cannot join a team.');
  }
}

export function registerInvitationCommands(commands: CommandDispatcher, secrets: Secrets) {
  commands.register('team.requestJoin', async (deps, actor, env) => {
    const payload = RequestJoinPayload.parse(env.payload);
    return runTeamCommand(deps, actor.userId, env, payload, async ({ tx, room }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireTeamRoom(room);
      requirePlayer(member);
      if (await teamMembership(tx, room.id, member.id)) {
        throw new AppError('STATE_CONFLICT', 'You are already in a team.', {
          reason: 'ALREADY_ON_TEAM',
        });
      }
      const invite = (
        await tx.query<{ auction_franchise_id: string; auto_join_user_ids: string[] }>(
          `SELECT auction_franchise_id, auto_join_user_ids FROM app_private.franchise_invites
            WHERE room_id = $1 AND code_hash = $2 AND (expires_at IS NULL OR expires_at > now())`,
          [room.id, teamCodeHash(secrets, payload.franchiseCode)],
        )
      ).rows[0];
      // A code identifies a pending request, never membership (rules §9).
      if (!invite) throw new AppError('NOT_FOUND', 'No team in this room uses that code.');
      const teamId = invite.auction_franchise_id;
      if ((await teamSize(tx, teamId)) >= limitOf(room)) {
        throw new AppError('TEAM_FULL', 'This team has no free places.', {
          limit: limitOf(room),
        });
      }
      const request = (
        await tx.query<{ id: string }>(
          `INSERT INTO app_private.franchise_join_requests (room_id, auction_franchise_id, member_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (auction_franchise_id, member_id) DO UPDATE
             SET status = 'pending', created_at = now(), decided_at = NULL, decided_by = NULL
           RETURNING id`,
          [room.id, teamId, member.id],
        )
      ).rows[0];
      if (!request) throw new AppError('INTERNAL', 'The request was not recorded.');

      // Auto-join only for the captain's accepted friends on the list (still friends now).
      const captain = (
        await tx.query<{ user_id: string }>(
          `SELECT m.user_id FROM app_private.auction_franchises f
             JOIN app_private.room_members m ON m.id = f.captain_member_id WHERE f.id = $1`,
          [teamId],
        )
      ).rows[0];
      const auto =
        captain !== undefined &&
        invite.auto_join_user_ids.includes(member.user_id) &&
        (await acceptedFriends(tx, captain.user_id, [member.user_id])).has(member.user_id);
      if (auto) {
        const role = await admit(tx, room, teamId, member.id, 'advisor', ADVISOR_CAPABILITIES);
        await tx.query(
          `UPDATE app_private.franchise_join_requests
              SET status = 'approved', decided_at = now(), decided_by = NULL WHERE id = $1`,
          [request.id],
        );
        const stream = await streamFor(tx, room.id, teamAudience(teamId));
        const changed = { memberId: member.id, role, approved: true, epoch: member.control_epoch };
        return {
          reply: { requestId: request.id, pending: false },
          events: [
            draft(teamAudience(teamId), 'team.membershipChanged', changed),
            draft(memberAudience(member.id), 'team.membershipChanged', changed),
          ],
          bumpState: true,
          touch: true,
          afterCommit: [() => deps.onStreamGranted?.(room.id, member.id, stream)],
        };
      }
      return {
        reply: { requestId: request.id, pending: true },
        events: [
          draft(teamAudience(teamId), 'team.joinRequested', {
            requestId: request.id,
            memberId: member.id,
            displayName: member.display_name,
          }),
          draft(memberAudience(member.id), 'team.membershipChanged', {
            memberId: member.id,
            role: null,
            approved: false,
            epoch: member.control_epoch,
          }),
        ],
        bumpState: true,
        touch: true,
      };
    });
  });

  commands.register('team.decideJoin', async (deps, actor, env) => {
    const payload = DecideJoinPayload.parse(env.payload);
    type Reply = { decision: 'approved' | 'rejected' };
    return runTeamCommand<Reply>(deps, actor.userId, env, payload, async ({ tx, room }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireTeamRoom(room);
      requireCurrentControl(member, env);
      const mine = await requireCaptain(tx, room, member);
      const teamId = mine.auction_franchise_id;
      const request = (
        await tx.query<{ id: string; member_id: string; status: string }>(
          `SELECT id, member_id, status FROM app_private.franchise_join_requests
            WHERE id = $1 AND room_id = $2 AND auction_franchise_id = $3`,
          [payload.requestId, room.id, teamId],
        )
      ).rows[0];
      if (!request) throw new AppError('NOT_FOUND', 'Join request not found.');
      if (request.status !== 'pending') {
        throw new AppError('STATE_CONFLICT', 'This request has already been decided.', {
          status: request.status,
        });
      }
      const requester = await memberEpoch(tx, request.member_id);
      const decide = (status: 'approved' | 'rejected') =>
        tx.query(
          `UPDATE app_private.franchise_join_requests
              SET status = $2, decided_at = now(), decided_by = $3 WHERE id = $1`,
          [request.id, status, member.id],
        );
      if (!payload.approve) {
        await decide('rejected');
        return {
          reply: { decision: 'rejected' },
          events: [
            draft(memberAudience(request.member_id), 'team.membershipChanged', {
              memberId: request.member_id,
              role: null,
              approved: false,
              epoch: requester.control_epoch,
            }),
          ],
          bumpState: true,
          touch: true,
        };
      }
      if (requester.left) {
        await decide('rejected');
        throw new AppError('STATE_CONFLICT', 'That player has left the room.');
      }
      if (await teamMembership(tx, room.id, request.member_id)) {
        await decide('rejected');
        throw new AppError('STATE_CONFLICT', 'That player has already joined a team.', {
          reason: 'ALREADY_ON_TEAM',
        });
      }
      if ((await teamSize(tx, teamId)) >= limitOf(room)) {
        throw new AppError('TEAM_FULL', 'This team has no free places.', {
          limit: limitOf(room),
        });
      }
      const role = await admit(
        tx,
        room,
        teamId,
        request.member_id,
        payload.role,
        payload.capabilities,
      );
      await decide('approved');
      const stream = await streamFor(tx, room.id, teamAudience(teamId));
      const changed = {
        memberId: request.member_id,
        role,
        approved: true,
        epoch: requester.control_epoch,
      };
      return {
        reply: { decision: 'approved' },
        events: [
          draft(teamAudience(teamId), 'team.membershipChanged', changed),
          draft(memberAudience(request.member_id), 'team.membershipChanged', changed),
        ],
        bumpState: true,
        touch: true,
        afterCommit: [() => deps.onStreamGranted?.(room.id, request.member_id, stream)],
      };
    });
  });

  commands.register('team.invite.rotate', async (deps, actor, env) => {
    const payload = InviteRotatePayload.parse(env.payload);
    return runTeamCommand(deps, actor.userId, env, payload, async ({ tx, room }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireTeamRoom(room);
      requireCurrentControl(member, env);
      const mine = await requireCaptain(tx, room, member);
      const teamId = mine.auction_franchise_id;
      const current = (
        await tx.query<{ auto_join_user_ids: string[] }>(
          'SELECT auto_join_user_ids FROM app_private.franchise_invites WHERE auction_franchise_id = $1',
          [teamId],
        )
      ).rows[0];
      let autoJoin = current?.auto_join_user_ids ?? [];
      if (payload.autoJoinUserIds) {
        const wanted = [...new Set(payload.autoJoinUserIds)];
        const friends = await acceptedFriends(tx, member.user_id, wanted);
        const strangers = wanted.filter((id) => !friends.has(id));
        if (strangers.length > 0) {
          throw new AppError('VALIDATION_FAILED', 'Auto-join is only for your accepted friends.', {
            reason: 'NOT_FRIENDS',
          });
        }
        autoJoin = wanted;
      }
      const code = newTeamCode(secrets, teamId);
      await tx.query(
        `INSERT INTO app_private.franchise_invites
           (room_id, auction_franchise_id, code_hash, code_ciphertext, auto_join_user_ids)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (auction_franchise_id) DO UPDATE
           SET code_hash = EXCLUDED.code_hash, code_ciphertext = EXCLUDED.code_ciphertext,
               auto_join_user_ids = EXCLUDED.auto_join_user_ids, created_at = now(), expires_at = NULL`,
        [room.id, teamId, code.hash, code.sealed, autoJoin],
      );
      // A new code revokes pending code-based requests (rules §9).
      const revoked = await tx.query<{ member_id: string }>(
        `UPDATE app_private.franchise_join_requests
            SET status = 'rejected', decided_at = now(), decided_by = $2
          WHERE auction_franchise_id = $1 AND status = 'pending' RETURNING member_id`,
        [teamId, member.id],
      );
      const events: EventDraft[] = [
        draft(teamAudience(teamId), 'team.inviteChanged', {
          expiresAt: null,
          autoJoinUserIds: autoJoin,
        }),
      ];
      for (const r of revoked.rows) {
        events.push(
          draft(memberAudience(r.member_id), 'team.membershipChanged', {
            memberId: r.member_id,
            role: null,
            approved: false,
            epoch: (await memberEpoch(tx, r.member_id)).control_epoch,
          }),
        );
      }
      return { reply: { newCode: code.code }, events, bumpState: true, touch: true };
    });
  });
}
