import type { TeamCapabilities, TeamRole, TeamView } from '@stumps/contracts';
import type { Secrets } from '../../config/secrets';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import type { MemberRow } from '../../rooms/projection';
import type { RoomRow } from '../../rooms/room-tx';
import { openTeamCode, teamMembership } from '../auctions/setup';
import { isLateJoiner } from './shared';

/**
 * The viewer's own team (S17): members with their roles and capabilities,
 * medal eligibility, join requests and the join code (captain / inviters),
 * the friend auto-join list (captain) and any open captaincy offer. Only an
 * approved member of the team can read it; everyone else gets 404.
 */

interface CapRow {
  can_bid: boolean;
  can_invite: boolean;
  can_strategy: boolean;
  can_retain_propose: boolean;
  can_rtm: boolean;
  can_manage_limits: boolean;
}
const capsOf = (r: CapRow): TeamCapabilities => ({
  bid: r.can_bid,
  invite: r.can_invite,
  strategy: r.can_strategy,
  retainPropose: r.can_retain_propose,
  rtm: r.can_rtm,
  manageLimits: r.can_manage_limits,
});

export async function teamView(
  tx: Tx,
  secrets: Secrets,
  room: RoomRow,
  viewer: MemberRow,
  now: Date,
): Promise<TeamView> {
  const mine = await teamMembership(tx, room.id, viewer.id);
  if (room.game_type !== 'auction' || !mine) {
    throw new AppError('NOT_FOUND', 'You are not in a team in this room.');
  }
  const teamId = mine.auction_franchise_id;
  const team = (
    await tx.query<{
      franchise_id: string;
      name: string;
      short_name: string;
      primary_hex: string;
      secondary_hex: string;
      control_epoch: string;
    }>(
      `SELECT af.franchise_id, f.name, f.short_name, f.primary_hex, f.secondary_hex, af.control_epoch::text
         FROM app_private.auction_franchises af JOIN app_private.franchises f ON f.id = af.franchise_id
        WHERE af.id = $1`,
      [teamId],
    )
  ).rows[0];
  if (!team) throw new AppError('NOT_FOUND', 'Team not found.');
  const members = await tx.query<
    CapRow & {
      member_id: string;
      display_name: string;
      role: TeamRole;
      eligible_at_start: boolean;
      online: boolean;
    }
  >(
    `SELECT fm.member_id, p.display_name, fm.role, fm.can_bid, fm.can_invite, fm.can_strategy,
            fm.can_retain_propose, fm.can_rtm, fm.can_manage_limits, fm.eligible_at_start,
            EXISTS (SELECT 1 FROM app_private.room_connections c
                     WHERE c.member_id = fm.member_id AND c.expires_at > now()) AS online
       FROM app_private.franchise_members fm
       JOIN app_private.room_members m ON m.id = fm.member_id
       JOIN app_private.profiles p ON p.user_id = m.user_id
      WHERE fm.auction_franchise_id = $1
      ORDER BY (fm.role = 'captain') DESC, (fm.role = 'cocaptain') DESC, fm.approved_at, fm.member_id`,
    [teamId],
  );
  const captain = mine.role === 'captain';
  const requests = captain
    ? (
        await tx.query<{ id: string; member_id: string; display_name: string }>(
          `SELECT r.id, r.member_id, p.display_name
             FROM app_private.franchise_join_requests r
             JOIN app_private.room_members m ON m.id = r.member_id
             JOIN app_private.profiles p ON p.user_id = m.user_id
            WHERE r.auction_franchise_id = $1 AND r.status = 'pending' AND m.left_at IS NULL
            ORDER BY r.created_at, r.id`,
          [teamId],
        )
      ).rows
    : [];
  const invite = (
    await tx.query<{ code_ciphertext: Buffer; auto_join_user_ids: string[] }>(
      `SELECT code_ciphertext, auto_join_user_ids FROM app_private.franchise_invites
        WHERE auction_franchise_id = $1`,
      [teamId],
    )
  ).rows[0];
  let autoJoin: TeamView['autoJoin'] = null;
  if (captain) {
    // The captain's accepted friends: the only people auto-join may admit.
    const friends = await tx.query<{ user_id: string; display_name: string }>(
      `SELECT p.user_id, p.display_name FROM app_private.friendships f
         JOIN app_private.profiles p
           ON p.user_id = CASE WHEN f.low_user_id = $1 THEN f.high_user_id ELSE f.low_user_id END
        WHERE f.status = 'accepted' AND (f.low_user_id = $1 OR f.high_user_id = $1)
        ORDER BY p.display_name, p.user_id`,
      [viewer.user_id],
    );
    const enabled = new Set(invite?.auto_join_user_ids ?? []);
    autoJoin = friends.rows.map((f) => ({
      userId: f.user_id,
      displayName: f.display_name,
      enabled: enabled.has(f.user_id),
    }));
  }
  const handover = (
    await tx.query<{ id: string; from_member_id: string; to_member_id: string; expires_at: Date }>(
      `SELECT id, from_member_id, to_member_id, expires_at FROM app_private.team_handovers
        WHERE auction_franchise_id = $1 AND status = 'pending' AND expires_at > $2`,
      [teamId, now],
    )
  ).rows[0];
  const open = room.lifecycle === 'LOBBY' || room.lifecycle === 'RUNNING';
  const actions: string[] = [];
  if (open) {
    if (captain) {
      actions.push('team.permissions', 'team.captain.propose', 'team.invite.rotate');
      if (requests.length > 0) actions.push('team.decideJoin');
    }
    if (handover && handover.to_member_id === viewer.id) actions.push('team.captain.accept');
    if (captain || mine.can_strategy)
      actions.push('team.shortlist.upsert', 'team.shortlist.remove');
    actions.push('team.shortlist.vote');
  }
  return {
    teamId,
    franchiseDefinitionId: team.franchise_id,
    name: team.name,
    shortName: team.short_name,
    primaryHex: team.primary_hex,
    secondaryHex: team.secondary_hex,
    lifecycle: room.lifecycle,
    myMemberId: viewer.id,
    myRole: mine.role,
    myCapabilities: capsOf(mine),
    controlEpoch: team.control_epoch,
    members: members.rows.map((m) => ({
      memberId: m.member_id,
      displayName: m.display_name,
      role: m.role,
      capabilities: capsOf(m),
      eligibleAtStart: room.lifecycle === 'LOBBY' ? true : m.eligible_at_start,
      lateJoiner: isLateJoiner(room, m.eligible_at_start),
      online: m.online,
    })),
    requests: requests.map((r) => ({
      requestId: r.id,
      memberId: r.member_id,
      displayName: r.display_name,
    })),
    joinCode:
      invite && (captain || mine.can_invite)
        ? openTeamCode(secrets, teamId, invite.code_ciphertext)
        : null,
    autoJoin,
    pendingHandover: handover
      ? {
          handoverId: handover.id,
          fromMemberId: handover.from_member_id,
          toMemberId: handover.to_member_id,
          expiresAt: handover.expires_at.toISOString(),
        }
      : null,
    collaboratorLimit: Number(room.settings.collaboratorsPerFranchise ?? 4),
    myAllowedActions: actions,
  };
}
