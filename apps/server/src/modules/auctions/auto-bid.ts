import { randomUUID } from 'node:crypto';
import type { AutoStrategyInput, ControlMode, EventType } from '@stumps/contracts';
import {
  autoBidDelayMs,
  autoDecision,
  autoRtmDecision,
  hasRtmCard,
  nextBidAmount,
  purchaseRejection,
  type AutoDecision,
  type AutoStrategy,
} from '@stumps/game-engines';
import type { Tx } from '../../db/transaction';
import type { DeadlineRegistry } from '../../jobs/deadlines';
import type { RoomRow } from '../../rooms/room-tx';
import type { EventDraft } from '../../rooms/streams';
import { placeBid, recordBid } from './bidding';
import {
  bidTeam,
  loadLive,
  openLot,
  poolRows,
  rtmHolder,
  stillAvailable,
  type Live,
  type LiveTeamRow,
  type LotRow,
  type PoolRow,
} from './live-store';
import { enterStage, scheduleJob, sell } from './settlement';

/**
 * Failover and safe automation (rules §9, ADR-027).
 *
 * Control belongs to each franchise, orthogonal to the room state:
 *   MANUAL   — people bid (captain and members with the bid right);
 *   FAILOVER — every authorised bidder is away, the connected co-captain holds control;
 *   AUTO     — nobody is left and the team saved an enabled strategy: the bot
 *              bids within those limits only;
 *   OBSERVE  — nobody is left and there is no strategy: nothing is bid.
 * The switch happens only after a 30-second grace with no authorised bidder
 * connected, bumps the franchise control epoch, and is undone only by an
 * explicit "Resume manual control" (team.auto.takeover).
 */

export const AUTO_JOBS = {
  bid: 'auction.auto_bid',
  rtm: 'auction.auto_rtm',
  absence: 'auction.team_absence',
} as const;

/** Presence grace before control moves (rules §1: 5 s heartbeat, 15 s stale, 30 s grace). */
export const ABSENCE_GRACE_MS = 30_000;

export interface TeamControl {
  mode: 'manual' | 'auto' | 'observe';
  epoch: string;
  failoverMemberId: string | null;
  reason: string | null;
  changedAt: Date | null;
}

export async function teamControl(tx: Tx, teamId: string): Promise<TeamControl> {
  const row = (
    await tx.query<{
      control_mode: TeamControl['mode'];
      control_epoch: string;
      failover_member_id: string | null;
      control_reason: string | null;
      control_changed_at: Date | null;
    }>(
      `SELECT control_mode, control_epoch::text, failover_member_id, control_reason, control_changed_at
         FROM app_private.auction_franchises WHERE id = $1`,
      [teamId],
    )
  ).rows[0];
  return {
    mode: row?.control_mode ?? 'manual',
    epoch: row?.control_epoch ?? '0',
    failoverMemberId: row?.failover_member_id ?? null,
    reason: row?.control_reason ?? null,
    changedAt: row?.control_changed_at ?? null,
  };
}

export function contractMode(c: Pick<TeamControl, 'mode' | 'failoverMemberId'>): ControlMode {
  if (c.mode === 'auto') return 'AUTO';
  if (c.mode === 'observe') return 'OBSERVE';
  return c.failoverMemberId ? 'FAILOVER' : 'MANUAL';
}

export async function setControl(
  tx: Tx,
  teamId: string,
  mode: TeamControl['mode'],
  failoverMemberId: string | null,
  reason: string,
  now: Date,
): Promise<string> {
  const res = await tx.query<{ control_epoch: string }>(
    `UPDATE app_private.auction_franchises
        SET control_mode = $2, failover_member_id = $3, control_reason = $4, control_changed_at = $5,
            control_epoch = control_epoch + 1
      WHERE id = $1 RETURNING control_epoch::text`,
    [teamId, mode, failoverMemberId, reason, now],
  );
  return res.rows[0]?.control_epoch ?? '0';
}

const teamAudience = (franchiseId: string): EventDraft['audience'] => ({
  kind: 'team',
  franchiseId,
});
const teamEvent = (teamId: string, type: EventType, payload: Record<string, unknown>) => ({
  audience: teamAudience(teamId),
  type,
  payload,
});

// ----------------------------------------------------------------- strategy
export function parseStrategy(raw: AutoStrategyInput, enabled: boolean): AutoStrategy {
  return {
    enabled,
    targets: raw.targetLimits.map((t) => ({
      playerId: t.playerId,
      ceiling: BigInt(t.ceilingRupees),
    })),
    roleLimits: Object.fromEntries(
      Object.entries(raw.roleLimits).map(([role, v]) => [role, BigInt(v as string)]),
    ),
    totalAutoCap: BigInt(raw.totalAutoCapRupees),
    maxAutoPurchases: raw.maxAutoPurchases,
    minReserve: BigInt(raw.minReserveRupees),
    allowRtm: raw.allowRTM,
    rtmCeiling: raw.rtmCeilingRupees === null ? null : BigInt(raw.rtmCeilingRupees),
  };
}

export interface StoredStrategy {
  version: string;
  enabled: boolean;
  raw: AutoStrategyInput;
  strategy: AutoStrategy;
  spentAuto: bigint;
  purchasesAuto: number;
}

export async function loadStrategy(tx: Tx, teamId: string): Promise<StoredStrategy | null> {
  const row = (
    await tx.query<{
      version: string;
      enabled: boolean;
      strategy: AutoStrategyInput;
      spent_auto: string;
      purchases_auto: number;
    }>(
      `SELECT version::text, enabled, strategy, spent_auto::text, purchases_auto
         FROM app_private.auto_strategies WHERE auction_franchise_id = $1`,
      [teamId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    version: row.version,
    enabled: row.enabled,
    raw: row.strategy,
    strategy: parseStrategy(row.strategy, row.enabled),
    spentAuto: BigInt(row.spent_auto),
    purchasesAuto: row.purchases_auto,
  };
}

/** A sale won by an automated bid counts against the automated cap and purchases. */
export async function creditAutoSale(tx: Tx, lotId: string, teamId: string, price: bigint) {
  const last = (
    await tx.query<{ actor_type: string }>(
      `SELECT actor_type FROM app_private.auction_bids
        WHERE nomination_id = $1 AND auction_franchise_id = $2 ORDER BY bid_version DESC LIMIT 1`,
      [lotId, teamId],
    )
  ).rows[0];
  if (last?.actor_type !== 'auto') return;
  await tx.query(
    `UPDATE app_private.auto_strategies
        SET spent_auto = spent_auto + $2, purchases_auto = purchases_auto + 1
      WHERE auction_franchise_id = $1`,
    [teamId, price.toString()],
  );
}

// -------------------------------------------------------------- scheduling
/** Seat order for the rotating bot delay: teams by id (fixed for the room). */
const seatOf = (live: { teams: readonly { id: string }[] }, teamId: string) =>
  live.teams.findIndex((t) => t.id === teamId);

async function autoTeams(tx: Tx, roomId: string): Promise<string[]> {
  const res = await tx.query<{ id: string }>(
    `SELECT id FROM app_private.auction_franchises WHERE room_id = $1 AND control_mode = 'auto' ORDER BY id`,
    [roomId],
  );
  return res.rows.map((r) => r.id);
}

/**
 * At most one attempt per team per lot version: the job key is (team, bid
 * version), so a later bid makes the older attempt stale and a repeat
 * schedule only moves the same row.
 */
export async function scheduleAutoBids(
  tx: Tx,
  room: RoomRow,
  lot: LotRow,
  now: Date,
): Promise<EventDraft[]> {
  if (lot.stage !== 'bidding') return [];
  const teams = await autoTeams(tx, room.id);
  if (teams.length === 0) return [];
  const all = await tx.query<{ id: string }>(
    'SELECT id FROM app_private.auction_franchises WHERE room_id = $1 ORDER BY id',
    [room.id],
  );
  const order = { teams: all.rows };
  for (const teamId of teams) {
    if (teamId === lot.high_franchise_id) continue;
    const delay = autoBidDelayMs(lot.lot_number, seatOf(order, teamId), all.rows.length);
    await scheduleJob(
      tx,
      room.id,
      AUTO_JOBS.bid,
      teamId,
      lot.bid_version,
      new Date(now.getTime() + delay),
    );
  }
  return [];
}

/** An RTM stage waiting on a team under automatic control gets one automated answer. */
export async function scheduleAutoRtm(
  tx: Tx,
  room: RoomRow,
  lot: Pick<LotRow, 'lot_number'>,
  actingTeamId: string,
  timerGeneration: string,
  now: Date,
) {
  const control = await teamControl(tx, actingTeamId);
  if (control.mode !== 'auto') return;
  const delay = autoBidDelayMs(lot.lot_number, 0, 1);
  await scheduleJob(
    tx,
    room.id,
    AUTO_JOBS.rtm,
    actingTeamId,
    timerGeneration,
    new Date(now.getTime() + delay),
  );
}

// --------------------------------------------------------------- decisions
async function playerName(tx: Tx, playerId: string) {
  const res = await tx.query<{ name: string }>(
    'SELECT canonical_name AS name FROM app_private.players WHERE id = $1',
    [playerId],
  );
  return res.rows[0]?.name ?? 'Player';
}

function decisionEvent(
  teamId: string,
  control: TeamControl,
  lot: LotRow,
  name: string,
  action: 'BID' | 'PASS' | 'RTM_INVOKE' | 'RTM_DECLINE' | 'MATCH' | 'NO_MATCH' | 'HOLD',
  decision: Pick<AutoDecision, 'reason' | 'ceiling'>,
  amount: bigint | null,
): EventDraft {
  return teamEvent(teamId, 'team.autoDecision', {
    mode: 'AUTO',
    epoch: control.epoch,
    reasonCode: decision.reason,
    decision: {
      action,
      nominationId: lot.id,
      lotNumber: lot.lot_number,
      playerName: name,
      amountRupees: amount?.toString() ?? null,
    },
    ceiling: decision.ceiling?.toString() ?? null,
  });
}

function autoInput(
  live: Live,
  team: LiveTeamRow,
  pool: PoolRow[],
  player: PoolRow,
  stored: StoredStrategy | null,
  amount: bigint,
  leader: string | null,
) {
  return {
    rules: live.rules,
    strategy: stored?.strategy ?? null,
    counters: { spentAuto: stored?.spentAuto ?? 0n, purchasesAuto: stored?.purchasesAuto ?? 0 },
    team: { ...bidTeam(team), roles: team.squad.map((s) => s.role) },
    player: {
      playerId: player.playerId,
      role: player.role,
      bowlType: player.bowlType,
      overseas: player.overseas,
    },
    amount,
    leaderTeamId: leader,
    lowestBasePrice: live.lowestBase,
    available: stillAvailable(pool, player.playerId),
  };
}

const running = (room: RoomRow, now: Date) =>
  room.game_type === 'auction' &&
  room.lifecycle === 'RUNNING' &&
  !(room.recovery_until && room.recovery_until.getTime() > now.getTime());

export function registerAutoDeadlines(deadlines: DeadlineRegistry) {
  // One automated bid attempt for a team at one lot version.
  deadlines.register(AUTO_JOBS.bid, async (tx, room, job, now) => {
    if (!running(room, now) || !job.subject_id) return {};
    const teamId = job.subject_id;
    const lot = await openLot(tx, room.id);
    if (
      !lot ||
      lot.stage !== 'bidding' ||
      lot.bid_version !== job.generation ||
      !lot.deadline ||
      now.getTime() >= lot.deadline.getTime()
    )
      return {};
    const control = await teamControl(tx, teamId);
    if (control.mode !== 'auto') return {};
    const live = await loadLive(tx, room);
    const team = live.teams.find((t) => t.id === teamId);
    const pool = await poolRows(tx, room.id);
    const player = pool.find((p) => p.playerId === lot.player_id);
    if (!team || !player) return {};
    const stored = await loadStrategy(tx, teamId);
    const next = nextBidAmount(
      live.rules,
      BigInt(lot.base_price),
      lot.high_bid ? BigInt(lot.high_bid) : null,
    );
    const decision = autoDecision(
      autoInput(live, team, pool, player, stored, next, lot.high_franchise_id),
    );
    const name = await playerName(tx, lot.player_id);
    const events: EventDraft[] = [
      decisionEvent(teamId, control, lot, name, decision.bid ? 'BID' : 'PASS', decision, next),
    ];
    if (decision.bid) {
      const placed = await placeBid(
        tx,
        room,
        lot,
        teamId,
        { type: 'auto', memberId: null },
        next,
        randomUUID(),
        now,
      );
      events.push(...placed.events, ...(await scheduleAutoBids(tx, room, placed.lot, now)));
    }
    return { events, bumpState: true };
  });

  // One automated answer at an RTM stage that waits on an automatic team.
  deadlines.register(AUTO_JOBS.rtm, async (tx, room, job, now) => {
    if (!running(room, now) || !job.subject_id) return {};
    const teamId = job.subject_id;
    const lot = await openLot(tx, room.id);
    if (
      !lot ||
      lot.stage === 'bidding' ||
      lot.timer_generation !== job.generation ||
      !lot.deadline ||
      now.getTime() >= lot.deadline.getTime()
    )
      return {};
    const control = await teamControl(tx, teamId);
    if (control.mode !== 'auto') return {};
    const live = await loadLive(tx, room);
    const team = live.teams.find((t) => t.id === teamId);
    const pool = await poolRows(tx, room.id);
    const player = pool.find((p) => p.playerId === lot.player_id);
    const high = lot.high_franchise_id;
    if (!team || !player || !high) return {};
    const stored = await loadStrategy(tx, teamId);
    const name = await playerName(tx, lot.player_id);
    const standing = BigInt(lot.high_bid ?? '0');
    const events: EventDraft[] = [];

    if (lot.stage === 'rtm_intent' && lot.rtm_franchise_id === teamId) {
      const d = autoRtmDecision(autoInput(live, team, pool, player, stored, standing, null));
      const usable = d.bid && hasRtmCard(live.rules, rtmHolder(live, team), player.cappedStatus);
      events.push(
        decisionEvent(
          teamId,
          control,
          lot,
          name,
          usable ? 'RTM_INVOKE' : 'RTM_DECLINE',
          d,
          standing,
        ),
      );
      events.push(
        ...(usable
          ? await enterStage(tx, live, lot, 'rtm_raise', high, standing, now)
          : await sell(tx, room, lot, high, standing, 'auction', now)),
      );
    } else if (lot.stage === 'rtm_raise' && high === teamId) {
      // A bot never raises its own final offer: it holds at the standing bid.
      events.push(
        decisionEvent(
          teamId,
          control,
          lot,
          name,
          'HOLD',
          { reason: 'BID', ceiling: null },
          standing,
        ),
      );
      events.push(
        ...(await enterStage(
          tx,
          live,
          lot,
          'rtm_match',
          lot.rtm_franchise_id ?? high,
          standing,
          now,
          {
            finalBid: standing,
          },
        )),
      );
    } else if (lot.stage === 'rtm_match' && lot.rtm_franchise_id === teamId) {
      const final = BigInt(lot.rtm_final_bid ?? lot.high_bid ?? '0');
      const d = autoRtmDecision(autoInput(live, team, pool, player, stored, final, null));
      const ok =
        d.bid &&
        hasRtmCard(live.rules, rtmHolder(live, team), player.cappedStatus) &&
        purchaseRejection({
          rules: live.rules,
          team: bidTeam(team),
          player: { role: player.role, bowlType: player.bowlType, overseas: player.overseas },
          amount: final,
          lowestBasePrice: live.lowestBase,
          available: stillAvailable(pool, player.playerId),
        }) === null;
      events.push(decisionEvent(teamId, control, lot, name, ok ? 'MATCH' : 'NO_MATCH', d, final));
      if (ok) {
        const version = await recordBid(
          tx,
          room,
          lot,
          teamId,
          { type: 'auto', memberId: null },
          final,
          'rtm_match',
          randomUUID(),
          now,
        );
        await tx.query(
          'UPDATE app_private.auction_nominations SET bid_version = $2 WHERE id = $1',
          [lot.id, version],
        );
        events.push(...(await sell(tx, room, lot, teamId, final, 'rtm', now)));
      } else {
        events.push(...(await sell(tx, room, lot, high, final, 'auction', now)));
      }
    } else {
      return {};
    }
    return { events, bumpState: true };
  });

  // Every authorised bidder has been away through the grace: fail over, automate or observe.
  deadlines.register(AUTO_JOBS.absence, async (tx, room, job, now) => {
    if (room.game_type !== 'auction' || room.lifecycle !== 'RUNNING' || !job.subject_id) return {};
    const events = await evaluateTeamControl(tx, room, job.subject_id, now);
    return events.length ? { events, bumpState: true } : {};
  });
}

/** Members of a team with their rights and whether any of their tabs is live now. */
async function teamPresence(tx: Tx, teamId: string, now: Date) {
  const res = await tx.query<{
    member_id: string;
    role: string;
    can_bid: boolean;
    connected: boolean;
  }>(
    `SELECT fm.member_id, fm.role, fm.can_bid,
            EXISTS (SELECT 1 FROM app_private.room_connections c
                     WHERE c.member_id = fm.member_id AND c.expires_at > $2) AS connected
       FROM app_private.franchise_members fm
       JOIN app_private.room_members m ON m.id = fm.member_id
      WHERE fm.auction_franchise_id = $1 AND m.left_at IS NULL`,
    [teamId, now],
  );
  return res.rows;
}

/**
 * Decide who controls a team once its bidders may have gone (rules §9): any
 * connected authorised bidder keeps it manual; otherwise a connected
 * co-captain takes over; otherwise the saved strategy (AUTO) or nothing (OBSERVE).
 */
export async function evaluateTeamControl(
  tx: Tx,
  room: RoomRow,
  teamId: string,
  now: Date,
): Promise<EventDraft[]> {
  const control = await teamControl(tx, teamId);
  if (control.mode !== 'manual') return [];
  const people = await teamPresence(tx, teamId, now);
  const bidderHere = people.some((p) => p.connected && (p.role === 'captain' || p.can_bid));
  if (bidderHere) return [];
  if (
    control.failoverMemberId &&
    people.some((p) => p.connected && p.member_id === control.failoverMemberId)
  )
    return [];
  const cocaptain = people.find((p) => p.connected && p.role === 'cocaptain');
  const changed = (mode: ControlMode, epoch: string, reasonCode: string) =>
    teamEvent(teamId, 'team.controlChanged', { mode, epoch, reasonCode });
  if (cocaptain) {
    const epoch = await setControl(
      tx,
      teamId,
      'manual',
      cocaptain.member_id,
      'BIDDERS_ABSENT',
      now,
    );
    return [changed('FAILOVER', epoch, 'BIDDERS_ABSENT')];
  }
  const stored = await loadStrategy(tx, teamId);
  if (stored?.enabled) {
    const epoch = await setControl(tx, teamId, 'auto', null, 'ALL_BIDDERS_ABSENT', now);
    const lot = await openLot(tx, room.id);
    if (lot) await scheduleAutoBids(tx, room, lot, now);
    return [changed('AUTO', epoch, 'ALL_BIDDERS_ABSENT')];
  }
  const epoch = await setControl(tx, teamId, 'observe', null, 'NO_STRATEGY', now);
  return [changed('OBSERVE', epoch, 'NO_STRATEGY')];
}

/** Arm the absence check for a member's team when they go offline in a running auction. */
export async function armAbsenceCheck(tx: Tx, room: RoomRow, memberId: string, now: Date) {
  if (room.game_type !== 'auction' || room.lifecycle !== 'RUNNING') return;
  const team = (
    await tx.query<{ auction_franchise_id: string }>(
      'SELECT auction_franchise_id FROM app_private.franchise_members WHERE member_id = $1',
      [memberId],
    )
  ).rows[0];
  if (!team) return;
  await scheduleJob(
    tx,
    room.id,
    AUTO_JOBS.absence,
    team.auction_franchise_id,
    0,
    new Date(now.getTime() + ABSENCE_GRACE_MS),
  );
}
