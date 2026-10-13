import {
  ShortlistRemovePayload,
  ShortlistUpsertPayload,
  ShortlistVotePayload,
  type ShortlistEntry,
  type ShortlistView,
} from '@stumps/contracts';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { requireMembership } from '../../rooms/projection';
import type { RoomRow } from '../../rooms/room-tx';
import type { CommandDispatcher } from '../commands/dispatcher';
import { poolPlayers, teamMembership } from '../auctions/setup';
import {
  canManageLimits,
  canStrategy,
  draft,
  requireCurrentControl,
  requireTeamMember,
  requireTeamRoom,
  runTeamCommand,
  teamAudience,
} from './shared';

/**
 * The private shortlist (rules §9, S23, ADR-026): targets with a priority, a
 * note and an optional private ceiling, plus advisory ±1 votes. It is visible
 * to the team's own approved members only, and it never authorizes or debits
 * anything — every bid still goes through the live bid controls.
 */

export async function shortlistEntries(tx: Tx, teamId: string): Promise<ShortlistEntry[]> {
  const res = await tx.query<{
    player_id: string;
    priority: number;
    private_note: string | null;
    max_price: string | null;
    proposer: string | null;
    up: number;
    down: number;
  }>(
    `SELECT s.player_id, s.priority, s.private_note, s.max_price::text,
            (SELECT p.display_name FROM app_private.room_members m
               JOIN app_private.profiles p ON p.user_id = m.user_id WHERE m.id = s.proposed_by) AS proposer,
            (SELECT count(*)::int FROM app_private.shortlist_votes v
              WHERE v.auction_franchise_id = s.auction_franchise_id AND v.player_id = s.player_id AND v.value = 1) AS up,
            (SELECT count(*)::int FROM app_private.shortlist_votes v
              WHERE v.auction_franchise_id = s.auction_franchise_id AND v.player_id = s.player_id AND v.value = -1) AS down
       FROM app_private.team_shortlists s
      WHERE s.auction_franchise_id = $1
      ORDER BY s.priority DESC, s.updated_at, s.player_id`,
    [teamId],
  );
  return res.rows.map((r) => ({
    playerId: r.player_id,
    priority: r.priority,
    note: r.private_note,
    maxPriceRupees: r.max_price,
    proposedBy: r.proposer,
    tally: { up: r.up, down: r.down },
  }));
}

async function tallyOf(tx: Tx, teamId: string, playerId: string) {
  const res = await tx.query<{ up: number; down: number }>(
    `SELECT count(*) FILTER (WHERE value = 1)::int AS up, count(*) FILTER (WHERE value = -1)::int AS down
       FROM app_private.shortlist_votes WHERE auction_franchise_id = $1 AND player_id = $2`,
    [teamId, playerId],
  );
  return res.rows[0] ?? { up: 0, down: 0 };
}

/** The shortlist view for one of the team's own members (others never see it). */
export async function shortlistView(
  tx: Tx,
  room: RoomRow,
  memberId: string,
  teamId: string,
): Promise<ShortlistView> {
  const mine = await teamMembership(tx, room.id, memberId);
  // Another team's plans are concealed exactly like a team that does not exist.
  if (!mine || mine.auction_franchise_id !== teamId) {
    throw new AppError('NOT_FOUND', 'Team not found.');
  }
  const entries = await shortlistEntries(tx, teamId);
  const votes = await tx.query<{ player_id: string; value: number }>(
    `SELECT player_id, value FROM app_private.shortlist_votes
      WHERE auction_franchise_id = $1 AND member_id = $2`,
    [teamId, memberId],
  );
  const myVotes = new Map(votes.rows.map((v) => [v.player_id, v.value]));
  const status = await tx.query<{
    player_id: string;
    status: ShortlistView['pool'][number]['status'];
  }>('SELECT player_id, status FROM app_private.auction_pool WHERE room_id = $1', [room.id]);
  const statusOf = new Map(status.rows.map((r) => [r.player_id, r.status]));
  const pool = (await poolPlayers(tx, room)).map((p) => ({
    ...p,
    status: statusOf.get(p.playerId) ?? 'available',
  }));
  return {
    teamId,
    entries: entries.map((e) => ({ ...e, myVote: myVotes.get(e.playerId) ?? 0 })),
    pool,
    canEdit: canStrategy(mine),
    canSetLimits: canManageLimits(mine),
  };
}

export function registerStrategyCommands(commands: CommandDispatcher) {
  commands.register('team.shortlist.upsert', async (deps, actor, env) => {
    const payload = ShortlistUpsertPayload.parse(env.payload);
    return runTeamCommand(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireTeamRoom(room);
      requireCurrentControl(member, env);
      const mine = await requireTeamMember(tx, room, member);
      if (!canStrategy(mine)) {
        throw new AppError('FORBIDDEN', 'Your captain has not given you the shortlist right.');
      }
      if (payload.maxPrice !== undefined && !canManageLimits(mine)) {
        throw new AppError('FORBIDDEN', 'Only members allowed to manage limits can set a ceiling.');
      }
      const teamId = mine.auction_franchise_id;
      const inPool = await tx.query(
        `SELECT 1 FROM app_private.auction_pool
          WHERE room_id = $1 AND player_id = $2 AND status <> 'retained'`,
        [room.id, payload.playerId],
      );
      if (!inPool.rowCount) throw new AppError('NOT_FOUND', 'That player is not in this auction.');
      const note = payload.note === undefined ? null : payload.note || null;
      await tx.query(
        `INSERT INTO app_private.team_shortlists
           (room_id, auction_franchise_id, player_id, priority, private_note, max_price, proposed_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (auction_franchise_id, player_id) DO UPDATE
           SET priority = EXCLUDED.priority,
               private_note = CASE WHEN $9 THEN EXCLUDED.private_note ELSE team_shortlists.private_note END,
               max_price = CASE WHEN $10 THEN EXCLUDED.max_price ELSE team_shortlists.max_price END,
               updated_at = EXCLUDED.updated_at`,
        [
          room.id,
          teamId,
          payload.playerId,
          payload.priority,
          note,
          payload.maxPrice ?? null,
          member.id,
          now,
          payload.note !== undefined,
          payload.maxPrice !== undefined,
        ],
      );
      const entries = await shortlistEntries(tx, teamId);
      const entry = entries.find((e) => e.playerId === payload.playerId) as ShortlistEntry;
      return {
        reply: { entry },
        events: [draft(teamAudience(teamId), 'team.shortlistChanged', { entries })],
        bumpState: true,
        touch: true,
      };
    });
  });

  commands.register('team.shortlist.remove', async (deps, actor, env) => {
    const payload = ShortlistRemovePayload.parse(env.payload);
    return runTeamCommand(deps, actor.userId, env, payload, async ({ tx, room }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireTeamRoom(room);
      requireCurrentControl(member, env);
      const mine = await requireTeamMember(tx, room, member);
      if (!canStrategy(mine)) {
        throw new AppError('FORBIDDEN', 'Your captain has not given you the shortlist right.');
      }
      const teamId = mine.auction_franchise_id;
      const removed = await tx.query(
        'DELETE FROM app_private.team_shortlists WHERE auction_franchise_id = $1 AND player_id = $2',
        [teamId, payload.playerId],
      );
      if (!removed.rowCount)
        throw new AppError('NOT_FOUND', 'That player is not on your shortlist.');
      return {
        reply: { removed: true },
        events: [
          draft(teamAudience(teamId), 'team.shortlistChanged', {
            entries: await shortlistEntries(tx, teamId),
          }),
        ],
        bumpState: true,
        touch: true,
      };
    });
  });

  commands.register('team.shortlist.vote', async (deps, actor, env) => {
    const payload = ShortlistVotePayload.parse(env.payload);
    return runTeamCommand(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireTeamRoom(room);
      requireCurrentControl(member, env);
      // Every team member may recommend, advisors and late joiners included.
      const mine = await requireTeamMember(tx, room, member);
      const teamId = mine.auction_franchise_id;
      const listed = await tx.query(
        'SELECT 1 FROM app_private.team_shortlists WHERE auction_franchise_id = $1 AND player_id = $2',
        [teamId, payload.playerId],
      );
      if (!listed.rowCount)
        throw new AppError('NOT_FOUND', 'That player is not on your shortlist.');
      if (payload.value === 0) {
        await tx.query(
          `DELETE FROM app_private.shortlist_votes
            WHERE auction_franchise_id = $1 AND player_id = $2 AND member_id = $3`,
          [teamId, payload.playerId, member.id],
        );
      } else {
        await tx.query(
          `INSERT INTO app_private.shortlist_votes (room_id, auction_franchise_id, player_id, member_id, value, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (auction_franchise_id, player_id, member_id) DO UPDATE
             SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
          [room.id, teamId, payload.playerId, member.id, payload.value, now],
        );
      }
      return {
        reply: { recorded: true },
        events: [
          draft(teamAudience(teamId), 'team.shortlistVoteChanged', {
            playerId: payload.playerId,
            tally: await tallyOf(tx, teamId, payload.playerId),
          }),
        ],
        bumpState: true,
        touch: true,
      };
    });
  });
}
