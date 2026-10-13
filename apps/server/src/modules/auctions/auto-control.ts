import {
  AutoConfigurePayload,
  AutoTakeoverPayload,
  type AutoView,
  type StrategyDTO,
} from '@stumps/contracts';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { requireMembership } from '../../rooms/projection';
import type { RoomRow } from '../../rooms/room-tx';
import type { CommandDispatcher } from '../commands/dispatcher';
import {
  canManageLimits,
  requireCurrentControl,
  requireTeamMember,
  requireTeamRoom,
  runTeamCommand,
  teamAudience,
} from '../teams/shared';
import { teamMembership, type TeamMemberRow } from './setup';
import {
  AUTO_JOBS,
  contractMode,
  loadStrategy,
  setControl,
  teamControl,
  type StoredStrategy,
  type TeamControl,
} from './auto-bid';

/**
 * Configuring automated bidding and resuming manual control (ADR-027).
 * Limits are private to the team and edited only by the captain or a member
 * allowed to manage limits, with an optimistic version. Once the auction
 * runs, limits change only while people hold control — never while the team
 * is automatic or observing ("no silent limit increase while absent").
 */

const canResume = (m: TeamMemberRow, control: TeamControl) =>
  m.role === 'captain' ||
  m.role === 'cocaptain' ||
  m.can_bid ||
  control.failoverMemberId === m.member_id;

function strategyDTO(teamId: string, s: StoredStrategy, control: TeamControl): StrategyDTO {
  return {
    franchiseId: teamId,
    version: s.version,
    enabled: s.enabled,
    targetLimits: s.raw.targetLimits,
    roleLimits: s.raw.roleLimits,
    priorityOrder: s.raw.targetLimits.map((t) => t.playerId),
    totalAutoCapRupees: s.raw.totalAutoCapRupees,
    spentAutoRupees: s.spentAuto.toString(),
    maxAutoPurchases: s.raw.maxAutoPurchases,
    purchasesAuto: s.purchasesAuto,
    minReserveRupees: s.raw.minReserveRupees,
    allowRTM: s.raw.allowRTM,
    rtmCeilingRupees: s.raw.rtmCeilingRupees,
    controlEpoch: control.epoch,
  };
}

/** S26: the team's automated limits, control state, decisions and automated purchases. */
export async function autoView(
  tx: Tx,
  room: RoomRow,
  memberId: string,
  teamId: string,
): Promise<AutoView> {
  const mine = await teamMembership(tx, room.id, memberId);
  // Another team's limits are concealed exactly like a team that does not exist.
  if (room.game_type !== 'auction' || !mine || mine.auction_franchise_id !== teamId) {
    throw new AppError('NOT_FOUND', 'Team not found.');
  }
  const control = await teamControl(tx, teamId);
  const stored = await loadStrategy(tx, teamId);
  const purse = (
    await tx.query<{ remaining_purse: string }>(
      'SELECT remaining_purse::text FROM app_private.auction_franchises WHERE id = $1',
      [teamId],
    )
  ).rows[0]?.remaining_purse;
  const decisions = await tx.query<{ payload: Record<string, unknown>; occurred_at: Date }>(
    `SELECT e.payload, e.created_at AS occurred_at FROM app_private.room_events e
       JOIN app_private.room_streams s ON s.id = e.stream_id
      WHERE e.room_id = $1 AND s.audience_kind = 'team' AND s.audience_id = $2
        AND e.type = 'team.autoDecision'
      ORDER BY e.seq DESC LIMIT 30`,
    [room.id, teamId],
  );
  const bought = await tx.query<{
    player_id: string;
    name: string;
    charged_price: string;
    lot_number: number;
  }>(
    `SELECT a.player_id, p.canonical_name AS name, a.charged_price::text, n.lot_number
       FROM app_private.auction_acquisitions a
       JOIN app_private.auction_nominations n ON n.id = a.nomination_id
       JOIN app_private.players p ON p.id = a.player_id
      WHERE a.auction_franchise_id = $1
        AND (SELECT b.actor_type FROM app_private.auction_bids b
              WHERE b.nomination_id = a.nomination_id AND b.auction_franchise_id = a.auction_franchise_id
              ORDER BY b.bid_version DESC LIMIT 1) = 'auto'
      ORDER BY n.lot_number`,
    [teamId],
  );
  const open = room.lifecycle === 'LOBBY' || room.lifecycle === 'RUNNING';
  return {
    teamId,
    strategy: stored ? strategyDTO(teamId, stored, control) : null,
    control: {
      mode: contractMode(control),
      epoch: control.epoch,
      reasonCode: control.reason,
      changedAt: control.changedAt ? control.changedAt.toISOString() : null,
      failoverMemberId: control.failoverMemberId,
    },
    remainingPurseRupees: purse ?? '0',
    lifecycle: room.lifecycle,
    canConfigure: open && canManageLimits(mine) && control.mode === 'manual',
    canTakeover:
      room.lifecycle === 'RUNNING' &&
      canResume(mine, control) &&
      (control.mode !== 'manual' || control.failoverMemberId !== null),
    decisions: decisions.rows.map((d) => {
      const { mode: _m, epoch: _e, ...rest } = d.payload as Record<string, unknown>;
      return { ...(rest as AutoView['decisions'][number]), at: d.occurred_at.toISOString() };
    }),
    autoPurchases: bought.rows.map((b) => ({
      playerId: b.player_id,
      playerName: b.name,
      priceRupees: b.charged_price,
      lotNumber: b.lot_number,
    })),
  };
}

export function registerAutoCommands(commands: CommandDispatcher) {
  commands.register('team.auto.configure', async (deps, actor, env) => {
    const payload = AutoConfigurePayload.parse(env.payload);
    return runTeamCommand(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireTeamRoom(room);
      requireCurrentControl(member, env);
      const mine = await requireTeamMember(tx, room, member);
      if (!canManageLimits(mine)) {
        throw new AppError(
          'FORBIDDEN',
          'Only the captain or a limits manager sets automated limits.',
        );
      }
      const teamId = mine.auction_franchise_id;
      const control = await teamControl(tx, teamId);
      if (control.mode !== 'manual') {
        throw new AppError(
          'RULE_VIOLATION',
          'Resume manual control before changing automated limits.',
          { reason: 'TAKE_OVER_FIRST' },
        );
      }
      const stored = await loadStrategy(tx, teamId);
      const current = stored?.version ?? '0';
      if (payload.version !== current) {
        throw new AppError('VERSION_CONFLICT', 'The limits changed; review the latest version.', {
          version: current,
        });
      }
      const s = payload.strategy;
      const ids = s.targetLimits.map((t) => t.playerId);
      if (new Set(ids).size !== ids.length) {
        throw new AppError('VALIDATION_FAILED', 'A target is listed twice.');
      }
      if (ids.length) {
        const found = await tx.query(
          `SELECT 1 FROM app_private.auction_pool
            WHERE room_id = $1 AND player_id = ANY($2::uuid[]) AND status <> 'retained'`,
          [room.id, ids],
        );
        if (found.rowCount !== ids.length) {
          throw new AppError('NOT_FOUND', 'A target is not in this auction.');
        }
      }
      if (s.allowRTM && s.rtmCeilingRupees === null) {
        throw new AppError('VALIDATION_FAILED', 'Set a right-to-match ceiling to allow it.');
      }
      const version = (
        await tx.query<{ version: string }>(
          `INSERT INTO app_private.auto_strategies
             (room_id, auction_franchise_id, version, enabled, strategy, updated_by, updated_at)
           VALUES ($1, $2, 1, $3, $4, $5, $6)
           ON CONFLICT (auction_franchise_id) DO UPDATE
             SET version = auto_strategies.version + 1, enabled = EXCLUDED.enabled,
                 strategy = EXCLUDED.strategy, updated_by = EXCLUDED.updated_by,
                 updated_at = EXCLUDED.updated_at
           RETURNING version::text`,
          [room.id, teamId, s.enabled, JSON.stringify(s), member.id, now],
        )
      ).rows[0]?.version as string;
      return {
        reply: { strategyVersion: version },
        events: [
          {
            audience: teamAudience(teamId),
            type: 'team.autoConfigured',
            payload: { strategyVersion: version, enabled: s.enabled },
          },
        ],
        bumpState: true,
        touch: true,
      };
    });
  });

  commands.register('team.auto.takeover', async (deps, actor, env) => {
    const payload = AutoTakeoverPayload.parse(env.payload);
    return runTeamCommand(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      if (room.game_type !== 'auction' || room.lifecycle !== 'RUNNING') {
        throw new AppError('STATE_CONFLICT', 'The auction is not running.');
      }
      requireCurrentControl(member, env);
      const mine = await requireTeamMember(tx, room, member);
      const teamId = mine.auction_franchise_id;
      const control = await teamControl(tx, teamId);
      if (!canResume(mine, control)) {
        throw new AppError(
          'FORBIDDEN',
          'Only the captain, co-captain or a bidder can take control.',
        );
      }
      // Fenced: a decision made on an older picture of control is refused.
      if (payload.currentEpoch !== control.epoch) {
        throw new AppError('CONTROL_EPOCH_STALE', 'Control changed; check the latest state.', {
          epoch: control.epoch,
        });
      }
      if (control.mode === 'manual' && control.failoverMemberId === null) {
        throw new AppError('STATE_CONFLICT', 'Your team is already on manual control.', {
          reason: 'ALREADY_MANUAL',
        });
      }
      const epoch = await setControl(tx, teamId, 'manual', null, 'RESUMED', now);
      // Pending automated attempts for this team are cancelled; committed bids and purchases stay.
      await tx.query(
        `DELETE FROM app_private.deadline_jobs
          WHERE room_id = $1 AND subject_id = $2 AND kind IN ($3, $4, $5)`,
        [room.id, teamId, AUTO_JOBS.bid, AUTO_JOBS.rtm, AUTO_JOBS.absence],
      );
      return {
        reply: { manual: true, newEpoch: epoch },
        events: [
          {
            audience: teamAudience(teamId),
            type: 'team.controlChanged',
            payload: { mode: 'MANUAL', epoch, reasonCode: 'RESUMED' },
          },
        ],
        bumpState: true,
        touch: true,
      };
    });
  });
}
