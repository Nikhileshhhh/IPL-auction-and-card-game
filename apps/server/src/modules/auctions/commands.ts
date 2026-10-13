import { randomUUID } from 'node:crypto';
import {
  ClaimFranchisePayload,
  CloseFranchiseSelectionPayload,
  RetentionLockPayload,
  RetentionProposePayload,
  type EventType,
} from '@stumps/contracts';
import { checkRetention, type RetentionPick } from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { requireMembership, type MemberRow } from '../../rooms/projection';
import { runRoomCommand, type RoomRow } from '../../rooms/room-tx';
import { streamFor, type EventDraft } from '../../rooms/streams';
import type { CommandDispatcher } from '../commands/dispatcher';
import type { RoomDeps } from '../rooms/service';
import {
  claimableFranchises,
  enginePool,
  listTeams,
  newTeamCode,
  requireSetup,
  teamMembership,
  type Setup,
  type TeamMemberRow,
} from './setup';

/**
 * Auction setup commands (DB/realtime §8.2, ADR-024). Join requests and team
 * permissions live in the teams module (ADR-026). Every write runs under
 * the room lock with an idempotency receipt; the captain is always assigned by
 * the server, a member belongs to at most one team, and the host has no team
 * powers. Validation order: membership → setup phase → team rights → rules.
 */

const event = (
  audience: EventDraft['audience'],
  type: EventType,
  payload: Record<string, unknown>,
): EventDraft => ({ audience, type, payload });

function requirePhase(setup: Setup, phase: Setup['phase'], message: string) {
  if (setup.phase !== phase) {
    throw new AppError('STATE_CONFLICT', message, { phase: setup.phase });
  }
}

function requirePlayer(member: MemberRow) {
  if (member.role === 'spectator') {
    throw new AppError('FORBIDDEN', 'Spectators cannot join a team.');
  }
}

async function requireCaptain(tx: Tx, room: RoomRow, member: MemberRow): Promise<TeamMemberRow> {
  const mine = await teamMembership(tx, room.id, member.id);
  if (!mine || mine.role !== 'captain') {
    throw new AppError('FORBIDDEN', 'Only the team captain can do this.');
  }
  return mine;
}

const team = (franchiseId: string): EventDraft['audience'] => ({ kind: 'team', franchiseId });

function run<T>(
  deps: RoomDeps,
  actorUserId: string,
  env: { roomId: string; commandId: string; type: string; expectedVersion: string },
  payload: unknown,
  handler: Parameters<typeof runRoomCommand<T>>[2],
) {
  return runRoomCommand<T>(
    deps.pool,
    {
      roomId: env.roomId,
      actorKey: `user:${actorUserId}`,
      commandId: env.commandId,
      body: { type: env.type, expectedVersion: env.expectedVersion, payload },
    },
    handler,
    { settleDue: deps.settleDue, wake: deps.wake },
  );
}

export function registerAuctionCommands(commands: CommandDispatcher, secrets: Secrets) {
  commands.register('auction.claimFranchise', async (deps, actor, env) => {
    const payload = ClaimFranchisePayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      const setup = await requireSetup(tx, room);
      requirePhase(setup, 'FRANCHISE_SELECTION', 'Franchise selection has closed.');
      requirePlayer(member);
      if (await teamMembership(tx, room.id, member.id)) {
        throw new AppError('STATE_CONFLICT', 'You are already in a team.', {
          reason: 'ALREADY_ON_TEAM',
        });
      }
      const franchise = (await claimableFranchises(tx, room.id)).find(
        (f) => f.id === payload.franchiseDefinitionId,
      );
      if (!franchise) throw new AppError('NOT_FOUND', 'That franchise is not in this auction.');
      const teams = await listTeams(tx, room.id);
      if (teams.some((t) => t.franchise_id === franchise.id)) {
        throw new AppError('FRANCHISE_TAKEN', `${franchise.name} has already been claimed.`);
      }
      if (teams.length >= setup.settings.franchiseCount) {
        throw new AppError('FRANCHISE_TAKEN', 'Every team place in this room is taken.', {
          reason: 'TEAM_LIMIT',
          limit: setup.settings.franchiseCount,
        });
      }
      const teamId = randomUUID();
      const purse = setup.rules.purse.toString();
      await tx.query(
        `INSERT INTO app_private.auction_franchises
           (id, room_id, franchise_id, captain_member_id, initial_purse, remaining_purse)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [teamId, room.id, franchise.id, member.id, purse],
      );
      await tx.query(
        `INSERT INTO app_private.franchise_members
           (room_id, auction_franchise_id, member_id, role, can_bid, can_invite, can_strategy,
            can_retain_propose, can_rtm, can_manage_limits)
         VALUES ($1, $2, $3, 'captain', true, true, true, true, true, true)`,
        [room.id, teamId, member.id],
      );
      const code = newTeamCode(secrets, teamId);
      await tx.query(
        `INSERT INTO app_private.franchise_invites (room_id, auction_franchise_id, code_hash, code_ciphertext)
         VALUES ($1, $2, $3, $4)`,
        [room.id, teamId, code.hash, code.sealed],
      );
      // A member who claims a team withdraws any request to join another.
      await tx.query(
        `DELETE FROM app_private.franchise_join_requests
          WHERE room_id = $1 AND member_id = $2 AND status = 'pending'`,
        [room.id, member.id],
      );
      const stream = await streamFor(tx, room.id, team(teamId));
      return {
        reply: { franchiseId: teamId },
        events: [
          event({ kind: 'public' }, 'team.created', {
            franchiseId: teamId,
            franchiseDefinitionId: franchise.id,
            captainMemberId: member.id,
          }),
        ],
        bumpState: true,
        touch: true,
        afterCommit: [() => deps.onStreamGranted?.(room.id, member.id, stream)],
      };
    });
  });

  commands.register('auction.franchiseSelection.close', async (deps, actor, env) => {
    const payload = CloseFranchiseSelectionPayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room }) => {
      await requireMembership(tx, room.id, actor.userId);
      const setup = await requireSetup(tx, room);
      if (room.host_user_id !== actor.userId) {
        throw new AppError('FORBIDDEN', 'Only the host can close franchise selection.');
      }
      requirePhase(setup, 'FRANCHISE_SELECTION', 'Franchise selection is already closed.');
      const teams = await listTeams(tx, room.id);
      if (teams.length < 2) {
        throw new AppError('STATE_CONFLICT', 'At least two teams must be claimed first.', {
          teams: teams.length,
        });
      }
      const phase = setup.game.format === 'retention' ? 'RETENTION' : 'AUCTION_LOBBY';
      await tx.query('UPDATE app_private.rooms SET phase = $2 WHERE id = $1', [room.id, phase]);
      return {
        reply: { phase },
        events: [event({ kind: 'public' }, 'auction.setupPhaseChanged', { phase })],
        bumpState: true,
        touch: true,
      };
    });
  });

  commands.register('auction.retention.propose', async (deps, actor, env) => {
    const payload = RetentionProposePayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      const setup = await requireSetup(tx, room);
      requirePhase(setup, 'RETENTION', 'Retentions are not open.');
      const mine = await teamMembership(tx, room.id, member.id);
      if (!mine || (mine.role !== 'captain' && !mine.can_retain_propose)) {
        throw new AppError(
          'FORBIDDEN',
          'Only the captain or a delegated teammate can propose retentions.',
        );
      }
      const teams = await listTeams(tx, room.id);
      const myTeam = teams.find((t) => t.id === mine.auction_franchise_id);
      if (!myTeam) throw new AppError('INTERNAL', 'Team not found.');
      const picks: RetentionPick[] = payload.playersAndAllocations.map((p) => ({
        playerId: p.playerId,
        salary: BigInt(p.salaryRupees),
      }));
      const check = checkRetention(
        {
          rules: setup.rules,
          format: setup.game.format,
          franchiseId: myTeam.franchise_id,
          pool: await enginePool(tx, room.id),
          lowestBasePrice: BigInt(setup.game.lowest_base_price),
        },
        picks,
      );
      if (!check.ok) {
        throw new AppError(
          'RETENTION_INVALID',
          check.problems[0]?.message ?? 'Invalid retentions.',
          {
            problems: check.problems,
          },
        );
      }
      const saved = (
        await tx.query<{ id: string; version: string }>(
          `INSERT INTO app_private.retention_packages
             (room_id, auction_franchise_id, proposed_by, players_and_allocations, total_charge)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (auction_franchise_id) DO UPDATE
             SET version = retention_packages.version + 1, proposed_by = EXCLUDED.proposed_by,
                 players_and_allocations = EXCLUDED.players_and_allocations,
                 total_charge = EXCLUDED.total_charge
             WHERE retention_packages.status = 'draft'
           RETURNING id, version::text`,
          [
            room.id,
            myTeam.id,
            member.id,
            JSON.stringify(
              picks.map((p) => ({ playerId: p.playerId, salary: p.salary.toString() })),
            ),
            check.cost.total.toString(),
          ],
        )
      ).rows[0];
      if (!saved) throw new AppError('STATE_CONFLICT', 'Your retentions are already locked.');
      return {
        reply: { packageVersion: saved.version },
        events: [
          event(team(myTeam.id), 'team.retentionProposed', {
            packageId: saved.id,
            version: saved.version,
            playersAndAllocations: check.cost.lines.map((l) => ({
              playerId: l.playerId,
              salaryRupees: l.salary.toString(),
              slabFloorRupees: l.slabFloor.toString(),
              allocatedRupees: l.allocated.toString(),
              capped: l.capped,
              overseas: l.overseas,
            })),
            totalCharge: check.cost.total.toString(),
          }),
        ],
        bumpState: true,
        touch: true,
      };
    });
  });

  commands.register('auction.retention.lock', async (deps, actor, env) => {
    const payload = RetentionLockPayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      const setup = await requireSetup(tx, room);
      requirePhase(setup, 'RETENTION', 'Retentions are not open.');
      const mine = await requireCaptain(tx, room, member);
      const pkg = (
        await tx.query<{
          id: string;
          version: string;
          status: string;
          players_and_allocations: { playerId: string; salary: string }[];
        }>(
          `SELECT id, version::text, status, players_and_allocations
             FROM app_private.retention_packages WHERE auction_franchise_id = $1`,
          [mine.auction_franchise_id],
        )
      ).rows[0];
      if (!pkg || pkg.id !== payload.packageId) {
        throw new AppError('NOT_FOUND', 'Retention package not found.');
      }
      if (pkg.status === 'locked')
        throw new AppError('STATE_CONFLICT', 'Retentions are already locked.');
      if (pkg.version !== payload.version) {
        throw new AppError('VERSION_CONFLICT', 'The package changed; review the latest version.', {
          version: pkg.version,
        });
      }
      const teams = await listTeams(tx, room.id);
      const myTeam = teams.find((t) => t.id === mine.auction_franchise_id);
      if (!myTeam) throw new AppError('INTERNAL', 'Team not found.');
      const check = checkRetention(
        {
          rules: setup.rules,
          format: setup.game.format,
          franchiseId: myTeam.franchise_id,
          pool: await enginePool(tx, room.id),
          lowestBasePrice: BigInt(setup.game.lowest_base_price),
        },
        pkg.players_and_allocations.map((p) => ({
          playerId: p.playerId,
          salary: BigInt(p.salary),
        })),
      );
      if (!check.ok) {
        const purse = check.problems.some((p) => p.code === 'PURSE_INVALID');
        throw new AppError(
          purse ? 'PURSE_INVALID' : 'RETENTION_INVALID',
          check.problems[0]?.message ?? 'Invalid retentions.',
          {
            problems: check.problems,
          },
        );
      }
      for (const line of check.cost.lines) {
        await tx.query(
          `INSERT INTO app_private.auction_acquisitions
             (room_id, player_id, auction_franchise_id, kind, charged_price, allocation_price)
           VALUES ($1, $2, $3, 'retention', $4, $4)`,
          [room.id, line.playerId, myTeam.id, line.allocated.toString()],
        );
      }
      await tx.query(
        `UPDATE app_private.auction_pool SET status = 'retained'
          WHERE room_id = $1 AND player_id = ANY($2::uuid[])`,
        [room.id, check.cost.lines.map((l) => l.playerId)],
      );
      await tx.query(
        `UPDATE app_private.auction_franchises SET retention_charge = $2, remaining_purse = initial_purse - $2
          WHERE id = $1`,
        [myTeam.id, check.cost.total.toString()],
      );
      await tx.query(
        `UPDATE app_private.retention_packages SET status = 'locked', locked_at = now() WHERE id = $1`,
        [pkg.id],
      );
      const events: EventDraft[] = [
        event({ kind: 'public' }, 'auction.retentionLocked', {
          franchiseId: myTeam.id,
          retainedPlayerIds: check.cost.lines.map((l) => l.playerId),
          retentionCharge: check.cost.total.toString(),
          remainingPurse: check.remainingPurse.toString(),
        }),
      ];
      // A change to a team's squad resets that team's readiness (rules §8).
      const unready = await tx.query<{ id: string }>(
        `UPDATE app_private.room_members m SET ready = false
           FROM app_private.franchise_members fm
          WHERE fm.member_id = m.id AND fm.auction_franchise_id = $1 AND m.ready
          RETURNING m.id`,
        [myTeam.id],
      );
      for (const r of unready.rows) {
        events.push(
          event({ kind: 'public' }, 'room.readinessChanged', {
            configVersion: room.config_version,
            memberId: r.id,
            ready: false,
          }),
        );
      }
      const open = await tx.query(
        `SELECT 1 FROM app_private.auction_franchises f
          WHERE f.room_id = $1 AND NOT EXISTS (
            SELECT 1 FROM app_private.retention_packages p
             WHERE p.auction_franchise_id = f.id AND p.status = 'locked')`,
        [room.id],
      );
      if (open.rowCount === 0) {
        await tx.query(`UPDATE app_private.rooms SET phase = 'AUCTION_LOBBY' WHERE id = $1`, [
          room.id,
        ]);
        events.push(
          event({ kind: 'public' }, 'auction.setupPhaseChanged', { phase: 'AUCTION_LOBBY' }),
        );
      }
      return {
        reply: {
          retained: check.cost.lines.map((l) => l.playerId),
          cost: check.cost.total.toString(),
          purse: check.remainingPurse.toString(),
        },
        events,
        bumpState: true,
        touch: true,
      };
    });
  });
}
