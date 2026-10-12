import type { AuctionSetupSnapshot, MyTeam, PublicTeam, RuleSummary } from '@stumps/contracts';
import { checkRetention, type AuctionRules } from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import type { Tx } from '../../db/transaction';
import type { GameProjector, MemberRow } from '../../rooms/projection';
import type { RoomRow } from '../../rooms/room-tx';
import {
  claimableFranchises,
  enginePool,
  listTeams,
  loadSetup,
  openTeamCode,
  poolPlayers,
  teamMembership,
  type Setup,
} from './setup';

/**
 * Auction setup projection (ADR-024). Everyone in the room sees the public
 * purse projection: each team's captain, member count, retention charge,
 * remaining purse and squad counts. Only a team's own members see its join
 * requests, draft retentions and eligible previous squad; the join code is
 * shown to the captain and to inviters.
 */

export function ruleSummary(rules: AuctionRules): RuleSummary {
  return {
    name: rules.name,
    label: rules.label,
    season: rules.season,
    purseRupees: rules.purse.toString(),
    squadMin: rules.squadMin,
    squadMax: rules.squadMax,
    overseasMax: rules.overseasMax,
    overseasInXI: rules.overseasInXI,
    retentionMax: rules.retention.max,
    retentionCappedMax: rules.retention.cappedMax,
    retentionUncappedMax: rules.retention.uncappedMax,
    cappedSlabsRupees: rules.retention.cappedSlabs.map(String),
    uncappedFloorRupees: rules.retention.uncappedFloor.toString(),
    basePriceBandsRupees: rules.basePriceBands.map(String),
    uncappedAfterYears: rules.uncappedAfterYears,
    provenance: { ...rules.provenance },
    sources: rules.sources.map((s) => ({ ...s })),
  };
}

async function publicTeams(tx: Tx, room: RoomRow): Promise<PublicTeam[]> {
  const franchises = await claimableFranchises(tx, room.id);
  const teams = await listTeams(tx, room.id);
  const stats = await tx.query<{
    team_id: string;
    members: number;
    ready: boolean;
    captain_name: string | null;
    roster: number;
    overseas: number;
    pkg: 'draft' | 'locked' | null;
  }>(
    `SELECT f.id AS team_id,
            (SELECT count(*)::int FROM app_private.franchise_members fm WHERE fm.auction_franchise_id = f.id) AS members,
            coalesce((SELECT bool_and(m.ready) FROM app_private.franchise_members fm
                        JOIN app_private.room_members m ON m.id = fm.member_id
                       WHERE fm.auction_franchise_id = f.id AND m.left_at IS NULL), false) AS ready,
            (SELECT p.display_name FROM app_private.room_members m
               JOIN app_private.profiles p ON p.user_id = m.user_id WHERE m.id = f.captain_member_id) AS captain_name,
            (SELECT count(*)::int FROM app_private.auction_acquisitions a WHERE a.auction_franchise_id = f.id) AS roster,
            (SELECT count(*)::int FROM app_private.auction_acquisitions a
               JOIN app_private.auction_pool ap ON ap.room_id = a.room_id AND ap.player_id = a.player_id
              WHERE a.auction_franchise_id = f.id AND ap.overseas) AS overseas,
            (SELECT status FROM app_private.retention_packages r WHERE r.auction_franchise_id = f.id) AS pkg
       FROM app_private.auction_franchises f WHERE f.room_id = $1`,
    [room.id],
  );
  const byTeam = new Map(stats.rows.map((r) => [r.team_id, r]));
  return franchises.map((f) => {
    const t = teams.find((x) => x.franchise_id === f.id);
    const s = t ? byTeam.get(t.id) : undefined;
    return {
      franchiseDefinitionId: f.id,
      name: f.name,
      shortName: f.short_name,
      primaryHex: f.primary_hex,
      secondaryHex: f.secondary_hex,
      teamId: t?.id ?? null,
      captain: t
        ? { memberId: t.captain_member_id, displayName: s?.captain_name ?? 'Captain' }
        : null,
      memberCount: s?.members ?? 0,
      retention: s?.pkg ?? 'none',
      retainedCount: s?.pkg === 'locked' ? s.roster : 0,
      retentionChargeRupees: t?.retention_charge ?? '0',
      initialPurseRupees: t?.initial_purse ?? '0',
      remainingPurseRupees: t?.remaining_purse ?? '0',
      rosterCount: s?.roster ?? 0,
      overseasCount: s?.overseas ?? 0,
      previousSquadCount: f.previous_squad,
      ready: s?.ready ?? false,
    };
  });
}

async function myTeam(
  tx: Tx,
  secrets: Secrets,
  room: RoomRow,
  setup: Setup,
  member: MemberRow,
): Promise<MyTeam | null> {
  const mine = await teamMembership(tx, room.id, member.id);
  if (!mine) return null;
  const teamId = mine.auction_franchise_id;
  const team = (await listTeams(tx, room.id)).find((t) => t.id === teamId);
  if (!team) return null;
  const members = await tx.query<{ member_id: string; display_name: string; role: MyTeam['role'] }>(
    `SELECT fm.member_id, p.display_name, fm.role
       FROM app_private.franchise_members fm
       JOIN app_private.room_members m ON m.id = fm.member_id
       JOIN app_private.profiles p ON p.user_id = m.user_id
      WHERE fm.auction_franchise_id = $1
      ORDER BY (fm.role = 'captain') DESC, fm.approved_at, fm.member_id`,
    [teamId],
  );
  const isCaptain = mine.role === 'captain';
  const requests = isCaptain
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
    await tx.query<{ code_ciphertext: Buffer }>(
      'SELECT code_ciphertext FROM app_private.franchise_invites WHERE auction_franchise_id = $1',
      [teamId],
    )
  ).rows[0];
  const pkg = (
    await tx.query<{
      id: string;
      version: string;
      status: 'draft' | 'locked';
      players_and_allocations: { playerId: string; salary: string }[];
    }>(
      `SELECT id, version::text, status, players_and_allocations
         FROM app_private.retention_packages WHERE auction_franchise_id = $1`,
      [teamId],
    )
  ).rows[0];
  let packageView: MyTeam['package'] = null;
  if (pkg) {
    const check = checkRetention(
      {
        rules: setup.rules,
        format: setup.game.format,
        franchiseId: team.franchise_id,
        pool: await enginePool(tx, room.id),
        lowestBasePrice: BigInt(setup.game.lowest_base_price),
      },
      pkg.players_and_allocations.map((p) => ({ playerId: p.playerId, salary: BigInt(p.salary) })),
    );
    packageView = {
      packageId: pkg.id,
      version: pkg.version,
      status: pkg.status,
      lines: check.cost.lines.map((l) => ({
        playerId: l.playerId,
        salaryRupees: l.salary.toString(),
        slabFloorRupees: l.slabFloor.toString(),
        allocatedRupees: l.allocated.toString(),
        capped: l.capped,
        overseas: l.overseas,
      })),
      cappedFloorsRupees: check.cost.cappedFloors.toString(),
      cappedNegotiatedRupees: check.cost.cappedNegotiated.toString(),
      totalChargeRupees: check.cost.total.toString(),
      remainingPurseRupees: check.remainingPurse.toString(),
      rtmCards: check.rtm,
    };
  }
  return {
    teamId,
    franchiseDefinitionId: team.franchise_id,
    role: mine.role,
    capabilities: {
      bid: mine.can_bid,
      invite: mine.can_invite,
      strategy: mine.can_strategy,
      retainPropose: mine.can_retain_propose,
      rtm: mine.can_rtm,
      manageLimits: mine.can_manage_limits,
    },
    joinCode:
      invite && (isCaptain || mine.can_invite)
        ? openTeamCode(secrets, teamId, invite.code_ciphertext)
        : null,
    members: members.rows.map((m) => ({
      memberId: m.member_id,
      displayName: m.display_name,
      role: m.role,
    })),
    requests: requests.map((r) => ({
      requestId: r.id,
      memberId: r.member_id,
      displayName: r.display_name,
    })),
    package: packageView,
    eligible:
      setup.game.format === 'retention'
        ? await poolPlayers(tx, room, { previousFranchiseId: team.franchise_id })
        : [],
  };
}

function allowedActions(
  room: RoomRow,
  setup: Setup,
  member: MemberRow,
  mine: MyTeam | null,
  hasRequest: boolean,
): string[] {
  const actions: string[] = [];
  if (setup.phase === 'FRANCHISE_SELECTION') {
    if (!mine && member.role === 'player') actions.push('auction.claimFranchise');
    if (room.host_user_id === member.user_id) actions.push('auction.franchiseSelection.close');
  }
  if (!mine && !hasRequest && member.role === 'player') actions.push('team.requestJoin');
  if (mine?.role === 'captain' && mine.requests.length > 0) actions.push('team.decideJoin');
  if (setup.phase === 'RETENTION' && mine && mine.package?.status !== 'locked') {
    if (mine.role === 'captain' || mine.capabilities.retainPropose) {
      actions.push('auction.retention.propose');
    }
    if (mine.role === 'captain' && mine.package) actions.push('auction.retention.lock');
  }
  return actions;
}

export function auctionProjector(secrets: Secrets): GameProjector {
  return async (tx, room, member): Promise<AuctionSetupSnapshot | null> => {
    const setup = await loadSetup(tx, room);
    if (!setup || room.lifecycle !== 'LOBBY') return null;
    const mine = await myTeam(tx, secrets, room, setup, member);
    const request = mine
      ? null
      : (
          await tx.query<{ id: string; franchise_id: string }>(
            `SELECT r.id, f.franchise_id FROM app_private.franchise_join_requests r
               JOIN app_private.auction_franchises f ON f.id = r.auction_franchise_id
              WHERE r.room_id = $1 AND r.member_id = $2 AND r.status = 'pending'`,
            [room.id, member.id],
          )
        ).rows[0];
    const pool = (
      await tx.query<{ total: number; available: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'available')::int AS available
           FROM app_private.auction_pool WHERE room_id = $1`,
        [room.id],
      )
    ).rows[0];
    return {
      kind: 'auction-setup',
      phase: setup.phase,
      format: setup.game.format,
      rules: ruleSummary(setup.rules),
      rulesHash: setup.game.rules_hash,
      dataKind: setup.dataKind,
      franchiseLimit: setup.settings.franchiseCount,
      collaboratorLimit: setup.settings.collaboratorsPerFranchise,
      teams: await publicTeams(tx, room),
      pool: {
        total: pool?.total ?? 0,
        available: pool?.available ?? 0,
        lowestBasePriceRupees: setup.game.lowest_base_price,
      },
      myTeam: mine,
      myRequest: request
        ? { requestId: request.id, franchiseDefinitionId: request.franchise_id }
        : null,
      myAllowedActions: allowedActions(room, setup, member, mine, Boolean(request)),
    };
  };
}
