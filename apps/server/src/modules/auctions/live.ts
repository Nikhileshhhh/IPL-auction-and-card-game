import type { AuctionLiveSnapshot, LiveTeam, Nomination } from '@stumps/contracts';
import { biddingCeiling, bidRejection, nextBidAmount } from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import type { Tx } from '../../db/transaction';
import type { MemberRow } from '../../rooms/projection';
import type { RoomRow } from '../../rooms/room-tx';
import {
  MAX_PAUSES,
  bidTeam,
  loadLive,
  openLot,
  poolRows,
  rtmCardsOf,
  stillAvailable,
  type Live,
  type LotRow,
} from './live-store';
import { ruleSummary } from './projection';
import { poolPlayers, teamMembership, type TeamMemberRow } from './setup';
import { publicPurses } from './settlement';
import { contractMode } from './auto-bid';
import { shortlistEntries } from '../teams/strategy';

/**
 * Live auction projection (ADR-025). Everyone sees the lot, the public purses,
 * squad counts, RTM cards and the lot history. Only the viewer's own team gets
 * its exact next legal bid and, when it cannot bid, the reason. The seed is
 * disclosed only once the auction has ended.
 */

const openAuctionSeed = (secrets: Secrets, roomId: string, ciphertext: Buffer) =>
  secrets.encryptor.decrypt(ciphertext.toString('utf8'), `auction-seed:${roomId}`);

async function liveTeams(tx: Tx, live: Live): Promise<LiveTeam[]> {
  const defs = await tx.query<{
    team_id: string;
    franchise_id: string;
    name: string;
    short_name: string;
    primary_hex: string;
    secondary_hex: string;
    captain_name: string | null;
  }>(
    `SELECT af.id AS team_id, f.id AS franchise_id, f.name, f.short_name, f.primary_hex, f.secondary_hex,
            (SELECT p.display_name FROM app_private.room_members m
               JOIN app_private.profiles p ON p.user_id = m.user_id
              WHERE m.id = af.captain_member_id) AS captain_name
       FROM app_private.auction_franchises af
       JOIN app_private.franchises f ON f.id = af.franchise_id
      WHERE af.room_id = $1`,
    [live.room.id],
  );
  const byId = new Map(defs.rows.map((d) => [d.team_id, d]));
  return live.teams.flatMap((t) => {
    const d = byId.get(t.id);
    if (!d) return [];
    const ceiling = biddingCeiling(live.rules, bidTeam(t), live.lowestBase);
    return [
      {
        teamId: t.id,
        franchiseDefinitionId: d.franchise_id,
        name: d.name,
        shortName: d.short_name,
        primaryHex: d.primary_hex,
        secondaryHex: d.secondary_hex,
        captainName: d.captain_name ?? 'Captain',
        remainingPurseRupees: t.remaining_purse.toString(),
        rosterCount: t.squad.length,
        overseasCount: t.squad.filter((p) => p.overseas).length,
        rtmCards: rtmCardsOf(live, t),
        control: contractMode({ mode: t.control_mode, failoverMemberId: t.failover_member_id }),
        maxBidRupees: ceiling === null ? null : ceiling.toString(),
      },
    ];
  });
}

/** What the viewer's team may bid on the open lot, or why it may not. */
async function ownBid(
  tx: Tx,
  live: Live,
  lot: LotRow,
  mine: TeamMemberRow | null,
  now: Date,
): Promise<Pick<Nomination, 'ownLegalNextBidRupees' | 'ownRejectionReason'>> {
  if (!mine) return { ownLegalNextBidRupees: null, ownRejectionReason: 'NOT_ON_TEAM' };
  const own = live.teams.find((t) => t.id === mine.auction_franchise_id);
  if (own && own.control_mode !== 'manual')
    return { ownLegalNextBidRupees: null, ownRejectionReason: 'TEAM_NOT_MANUAL' };
  const failover = own?.failover_member_id === mine.member_id;
  if (mine.role !== 'captain' && !mine.can_bid && !failover)
    return { ownLegalNextBidRupees: null, ownRejectionReason: 'NO_BID_RIGHT' };
  if (lot.stage !== 'bidding' || !lot.deadline || now.getTime() >= lot.deadline.getTime())
    return { ownLegalNextBidRupees: null, ownRejectionReason: 'NOT_BIDDING' };
  const team = live.teams.find((t) => t.id === mine.auction_franchise_id);
  const pool = await poolRows(tx, live.room.id);
  const player = pool.find((p) => p.playerId === lot.player_id);
  if (!team || !player) return { ownLegalNextBidRupees: null, ownRejectionReason: 'NOT_ON_TEAM' };
  const next = nextBidAmount(
    live.rules,
    BigInt(lot.base_price),
    lot.high_bid ? BigInt(lot.high_bid) : null,
  );
  const rejection = bidRejection({
    rules: live.rules,
    team: bidTeam(team),
    player: { role: player.role, bowlType: player.bowlType, overseas: player.overseas },
    amount: next,
    leaderTeamId: lot.high_franchise_id,
    lowestBasePrice: live.lowestBase,
    available: stillAvailable(pool, player.playerId),
  });
  return rejection
    ? { ownLegalNextBidRupees: null, ownRejectionReason: rejection.code }
    : { ownLegalNextBidRupees: next.toString(), ownRejectionReason: null };
}

function allowedActions(
  room: RoomRow,
  member: MemberRow,
  live: Live,
  lot: LotRow | null,
  mine: TeamMemberRow | null,
  own: Pick<Nomination, 'ownLegalNextBidRupees'> | null,
): string[] {
  if (room.lifecycle !== 'RUNNING') return [];
  const actions: string[] = [];
  // A player without a team may still ask to join one (late joiner: advisor, no medal).
  if (!mine && member.role === 'player') actions.push('team.requestJoin');
  const myTeamId = mine?.auction_franchise_id ?? null;
  const myTeam = live.teams.find((t) => t.id === myTeamId);
  const failover = myTeam !== undefined && myTeam.failover_member_id === mine?.member_id;
  const manual = myTeam?.control_mode === 'manual';
  const rtmRight = mine !== null && manual && (mine.role === 'captain' || mine.can_rtm || failover);
  const bidRight = mine !== null && manual && (mine.role === 'captain' || mine.can_bid || failover);
  // Resume manual control: the captain, co-captain, a bidder or the failover holder.
  if (
    mine !== null &&
    myTeam &&
    (myTeam.control_mode !== 'manual' || myTeam.failover_member_id !== null) &&
    (mine.role === 'captain' || mine.role === 'cocaptain' || mine.can_bid || failover)
  )
    actions.push('team.auto.takeover');
  if (lot) {
    if (lot.stage === 'bidding' && own?.ownLegalNextBidRupees) actions.push('auction.bid');
    if (lot.stage === 'rtm_intent' && rtmRight && myTeamId === lot.rtm_franchise_id)
      actions.push('auction.rtm.intent');
    if (lot.stage === 'rtm_raise' && bidRight && myTeamId === lot.high_franchise_id)
      actions.push('auction.rtm.finalOffer');
    if (lot.stage === 'rtm_match' && rtmRight && myTeamId === lot.rtm_franchise_id)
      actions.push('auction.rtm.match');
  }
  if (room.host_user_id === member.user_id) {
    if (live.game.paused_until) actions.push('auction.resume');
    else if (!lot && live.game.pause_count < MAX_PAUSES) actions.push('auction.pause');
    if (lot && lot.stage === 'bidding' && !lot.high_bid) actions.push('auction.skip');
  }
  return actions;
}

export async function liveSnapshot(
  tx: Tx,
  secrets: Secrets,
  room: RoomRow,
  member: MemberRow,
): Promise<AuctionLiveSnapshot> {
  const now = (await tx.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]
    ?.now as Date;
  const live = await loadLive(tx, room);
  const mine = await teamMembership(tx, room.id, member.id);
  const lot = room.lifecycle === 'RUNNING' ? await openLot(tx, room.id) : null;

  let nomination: Nomination | null = null;
  let own: Pick<Nomination, 'ownLegalNextBidRupees' | 'ownRejectionReason'> | null = null;
  if (lot) {
    const [player] = await poolPlayers(tx, room, { playerIds: [lot.player_id] });
    own = await ownBid(tx, live, lot, mine, now);
    if (player) {
      nomination = {
        id: lot.id,
        lotNumber: lot.lot_number,
        pass: lot.pass,
        player,
        stage: lot.stage,
        status: lot.status,
        basePriceRupees: lot.base_price,
        highBidRupees: lot.high_bid,
        highFranchiseId: lot.high_franchise_id,
        bidVersion: lot.bid_version,
        deadline: lot.deadline ? lot.deadline.toISOString() : null,
        rtmFranchiseId: lot.rtm_franchise_id,
        rtmFinalBidRupees: lot.rtm_final_bid,
        publicFranchisePursesAndCounts: await publicPurses(tx, room.id),
        ...own,
        myTarget: null,
      };
      if (mine) {
        const entry = (await shortlistEntries(tx, mine.auction_franchise_id)).find(
          (e) => e.playerId === lot.player_id,
        );
        if (entry) {
          nomination.myTarget = {
            priority: entry.priority,
            maxPriceRupees: entry.maxPriceRupees,
            note: entry.note,
            tally: entry.tally,
          };
        }
      }
    }
  }

  const progress = (
    await tx.query<{ total: number; sold: number; unsold: number; remaining: number }>(
      `SELECT count(*) FILTER (WHERE status <> 'retained')::int AS total,
              count(*) FILTER (WHERE status = 'sold')::int AS sold,
              count(*) FILTER (WHERE status = 'unsold')::int AS unsold,
              count(*) FILTER (WHERE status = 'available')::int AS remaining
         FROM app_private.auction_pool WHERE room_id = $1`,
      [room.id],
    )
  ).rows[0] ?? { total: 0, sold: 0, unsold: 0, remaining: 0 };

  const history = await tx.query<{
    id: string;
    lot_number: number;
    pass: number;
    player_id: string;
    name: string;
    status: 'sold' | 'unsold' | 'skipped' | 'cancelled';
    kind: 'auction' | 'rtm' | null;
    sold_to: string | null;
    sold_price: string | null;
  }>(
    `SELECT n.id, n.lot_number, n.pass, n.player_id, p.canonical_name AS name, n.status,
            a.kind, n.sold_to, n.sold_price::text
       FROM app_private.auction_nominations n
       JOIN app_private.players p ON p.id = n.player_id
       LEFT JOIN app_private.auction_acquisitions a ON a.nomination_id = n.id
      WHERE n.room_id = $1 AND n.status <> 'open'
      ORDER BY n.lot_number DESC, n.id LIMIT 30`,
    [room.id],
  );

  const bids = lot
    ? (
        await tx.query<{
          auction_franchise_id: string;
          amount: string;
          kind: 'normal' | 'rtm_raise' | 'rtm_match';
          bid_version: string;
          accepted_at: Date;
        }>(
          `SELECT auction_franchise_id, amount::text, kind, bid_version::text, accepted_at
             FROM app_private.auction_bids WHERE nomination_id = $1
            ORDER BY bid_version DESC LIMIT 20`,
          [lot.id],
        )
      ).rows
    : [];

  const finished = room.lifecycle !== 'RUNNING';
  return {
    kind: 'auction-live',
    status: finished ? 'finished' : 'running',
    finishedReason: live.game.finished_reason,
    rules: ruleSummary(live.rules),
    pass: live.game.pool_pass,
    poolProgress: progress,
    lot: nomination,
    nextLotAt:
      !lot && !finished && !live.game.paused_until && live.game.pacing_deadline
        ? live.game.pacing_deadline.toISOString()
        : null,
    pausedUntil: live.game.paused_until ? live.game.paused_until.toISOString() : null,
    pausesLeft: Math.max(0, MAX_PAUSES - live.game.pause_count),
    teams: await liveTeams(tx, live),
    myTeamId: mine?.auction_franchise_id ?? null,
    myCapabilities: {
      bid: mine !== null && (mine.role === 'captain' || mine.can_bid),
      rtm: mine !== null && (mine.role === 'captain' || mine.can_rtm),
    },
    history: history.rows.map((h) => ({
      nominationId: h.id,
      lotNumber: h.lot_number,
      pass: h.pass,
      playerId: h.player_id,
      name: h.name,
      outcome: h.status === 'sold' ? (h.kind === 'rtm' ? 'rtm' : 'sold') : h.status,
      teamId: h.sold_to,
      priceRupees: h.sold_price,
    })),
    lotBids: bids.map((b) => ({
      teamId: b.auction_franchise_id,
      amountRupees: b.amount,
      kind: b.kind,
      bidVersion: b.bid_version,
      at: b.accepted_at.toISOString(),
    })),
    myAllowedActions: allowedActions(room, member, live, lot, mine, own),
    seedCommitment: live.game.seed_commitment ?? '',
    auditSeed:
      finished && live.game.seed_ciphertext
        ? openAuctionSeed(secrets, room.id, live.game.seed_ciphertext)
        : null,
  };
}
