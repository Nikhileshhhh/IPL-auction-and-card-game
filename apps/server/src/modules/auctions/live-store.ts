import type { AuctionSettings } from '@stumps/contracts';
import {
  rtmCards,
  type AuctionRules,
  type BidTeam,
  type CappedStatus,
  type RtmHolder,
  type XiPlayer,
} from '@stumps/game-engines';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import type { RoomRow } from '../../rooms/room-tx';
import { rulesetById } from './rulesets';

/**
 * Live auction state read under the room lock (ADR-025): the game row, every
 * team with its squad, the open lot and the players still on offer.
 */

export const JOBS = {
  bidding: 'auction.bidding_deadline',
  rtm: 'auction.rtm_deadline',
  nextLot: 'auction.next_lot',
  pause: 'auction.pause_expiry',
  hardLimit: 'auction.hard_limit',
} as const;

/** Seconds between a result and the next lot (the only moment the host may pause). */
export const LOT_GAP_SECONDS = 4;
export const PAUSE_SECONDS = 120;
export const MAX_PAUSES = 3;

export interface GameRow {
  room_id: string;
  ruleset_id: string;
  format: 'fresh' | 'retention';
  lowest_base_price: string;
  nomination_index: number;
  pool_pass: number;
  active_nomination_id: string | null;
  completed_nominations: number;
  paused_until: Date | null;
  pacing_deadline: Date | null;
  pause_count: number;
  lot_generation: string;
  seed_commitment: string | null;
  seed_ciphertext: Buffer | null;
  finished_reason: 'pool_complete' | 'no_buyers' | 'time_limit' | 'vote' | null;
}

export interface SquadEntry extends XiPlayer {
  playerId: string;
  kind: 'retention' | 'auction' | 'rtm';
  cappedStatus: CappedStatus;
}

export interface LiveTeamRow {
  id: string;
  franchise_id: string;
  captain_member_id: string;
  initial_purse: bigint;
  remaining_purse: bigint;
  control_mode: 'manual' | 'auto' | 'observe';
  failover_member_id: string | null;
  squad: SquadEntry[];
}

export interface LotRow {
  id: string;
  player_id: string;
  lot_number: number;
  pass: number;
  base_price: string;
  stage: 'bidding' | 'rtm_intent' | 'rtm_raise' | 'rtm_match' | 'settled';
  status: 'open' | 'sold' | 'unsold' | 'skipped' | 'cancelled';
  high_franchise_id: string | null;
  high_bid: string | null;
  bid_version: string;
  deadline: Date | null;
  timer_generation: string;
  rtm_franchise_id: string | null;
  rtm_final_bid: string | null;
}

export interface Live {
  room: RoomRow;
  game: GameRow;
  rules: AuctionRules;
  settings: AuctionSettings;
  teams: LiveTeamRow[];
  lowestBase: bigint;
}

export async function loadLive(tx: Tx, room: RoomRow): Promise<Live> {
  const game = (
    await tx.query<GameRow>(
      `SELECT room_id, ruleset_id, format, lowest_base_price::text, nomination_index, pool_pass,
              active_nomination_id, completed_nominations, paused_until, pacing_deadline, pause_count,
              lot_generation::text, seed_commitment, seed_ciphertext, finished_reason
         FROM app_private.auction_games WHERE room_id = $1`,
      [room.id],
    )
  ).rows[0];
  if (!game) throw new AppError('STATE_CONFLICT', 'This room has no auction.');
  const ruleset = await rulesetById(tx, game.ruleset_id);
  if (!ruleset) throw new AppError('INTERNAL', 'The room’s ruleset is missing.');
  const teams = await tx.query<{
    id: string;
    franchise_id: string;
    captain_member_id: string;
    initial_purse: string;
    remaining_purse: string;
    control_mode: LiveTeamRow['control_mode'];
    failover_member_id: string | null;
  }>(
    `SELECT id, franchise_id, captain_member_id, initial_purse::text, remaining_purse::text,
            control_mode, failover_member_id
       FROM app_private.auction_franchises WHERE room_id = $1 ORDER BY id`,
    [room.id],
  );
  const squads = await tx.query<{
    auction_franchise_id: string;
    player_id: string;
    kind: SquadEntry['kind'];
    role: SquadEntry['role'];
    bowl_type: SquadEntry['bowlType'];
    overseas: boolean;
    capped_status: CappedStatus;
  }>(
    `SELECT a.auction_franchise_id, a.player_id, a.kind, p.role, p.bowl_type, p.overseas, p.capped_status
       FROM app_private.auction_acquisitions a
       JOIN app_private.auction_pool p ON p.room_id = a.room_id AND p.player_id = a.player_id
      WHERE a.room_id = $1`,
    [room.id],
  );
  return {
    room,
    game,
    rules: ruleset.rules,
    settings: room.settings as unknown as AuctionSettings,
    lowestBase: BigInt(game.lowest_base_price),
    teams: teams.rows.map((t) => ({
      id: t.id,
      franchise_id: t.franchise_id,
      captain_member_id: t.captain_member_id,
      initial_purse: BigInt(t.initial_purse),
      remaining_purse: BigInt(t.remaining_purse),
      control_mode: t.control_mode,
      failover_member_id: t.failover_member_id,
      squad: squads.rows
        .filter((s) => s.auction_franchise_id === t.id)
        .map((s) => ({
          playerId: s.player_id,
          kind: s.kind,
          role: s.role,
          bowlType: s.bowl_type,
          overseas: s.overseas,
          cappedStatus: s.capped_status,
        })),
    })),
  };
}

export const bidTeam = (t: LiveTeamRow): BidTeam => ({
  teamId: t.id,
  remainingPurse: t.remaining_purse,
  squad: t.squad,
});

/** RTM card counts: retentions plus successful RTMs share the 6 / 5 / 2 caps. */
export function rtmHolder(live: Live, team: LiveTeamRow): RtmHolder {
  const count = (kind: SquadEntry['kind'], status: CappedStatus) =>
    team.squad.filter((p) => p.kind === kind && p.cappedStatus === status).length;
  return {
    format: live.game.format,
    retainedCapped: count('retention', 'capped'),
    retainedUncapped: count('retention', 'uncapped'),
    rtmUsedCapped: count('rtm', 'capped'),
    rtmUsedUncapped: count('rtm', 'uncapped'),
  };
}

export function rtmCardsOf(live: Live, team: LiveTeamRow) {
  const h = rtmHolder(live, team);
  return rtmCards(
    live.rules,
    h.format,
    h.retainedCapped,
    h.retainedUncapped,
    h.rtmUsedCapped,
    h.rtmUsedUncapped,
  );
}

export const LOT_COLUMNS = `id, player_id, lot_number, pass, base_price::text, stage, status, high_franchise_id,
  high_bid::text, bid_version::text, deadline, timer_generation::text, rtm_franchise_id, rtm_final_bid::text`;

export async function openLot(tx: Tx, roomId: string): Promise<LotRow | null> {
  const res = await tx.query<LotRow>(
    `SELECT ${LOT_COLUMNS} FROM app_private.auction_nominations WHERE room_id = $1 AND status = 'open'`,
    [roomId],
  );
  return res.rows[0] ?? null;
}

export async function lotById(tx: Tx, roomId: string, id: string): Promise<LotRow | null> {
  const res = await tx.query<LotRow>(
    `SELECT ${LOT_COLUMNS} FROM app_private.auction_nominations WHERE room_id = $1 AND id = $2`,
    [roomId, id],
  );
  return res.rows[0] ?? null;
}

export interface PoolRow extends XiPlayer {
  playerId: string;
  basePrice: bigint;
  cappedStatus: CappedStatus;
  previousFranchiseId: string | null;
  status: 'available' | 'retained' | 'sold' | 'unsold' | 'skipped';
  pass: number;
  orderIndex: number;
  skipped: boolean;
}

export async function poolRows(tx: Tx, roomId: string): Promise<PoolRow[]> {
  const res = await tx.query<{
    player_id: string;
    base_price: string;
    capped_status: CappedStatus;
    previous_franchise_id: string | null;
    status: PoolRow['status'];
    pass: number;
    order_index: number;
    skipped: boolean;
    role: XiPlayer['role'];
    bowl_type: XiPlayer['bowlType'];
    overseas: boolean;
  }>(
    `SELECT player_id, base_price::text, capped_status, previous_franchise_id, status, pass, order_index,
            skipped, role, bowl_type, overseas
       FROM app_private.auction_pool WHERE room_id = $1 ORDER BY order_index`,
    [roomId],
  );
  return res.rows.map((r) => ({
    playerId: r.player_id,
    basePrice: BigInt(r.base_price),
    cappedStatus: r.capped_status,
    previousFranchiseId: r.previous_franchise_id,
    status: r.status,
    pass: r.pass,
    orderIndex: r.order_index,
    skipped: r.skipped,
    role: r.role,
    bowlType: r.bowl_type,
    overseas: r.overseas,
  }));
}

/**
 * Players still on offer after the given one (for the legal-XI check): those
 * yet to come up, and first-pass unsold players who return in the second pass.
 */
export const stillAvailable = (pool: readonly PoolRow[], exceptPlayerId: string) =>
  pool.filter(
    (p) =>
      (p.status === 'available' || (p.status === 'unsold' && p.pass === 1)) &&
      p.playerId !== exceptPlayerId,
  );
