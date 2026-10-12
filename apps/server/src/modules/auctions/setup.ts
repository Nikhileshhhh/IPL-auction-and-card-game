import {
  formatRoomCode,
  normalizeRoomCode,
  type AuctionPlayer,
  type AuctionSettings,
  type AuctionSetupPhase,
} from '@stumps/contracts';
import { poolFeasibility, type AuctionRules, type PoolPlayer } from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import { one } from '../../db/rows';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { generateRoomCode } from '../../rooms/codes';
import type { RoomRow } from '../../rooms/room-tx';
import { hmac } from '../../security/crypto';
import { portraitPath } from '../media/service';
import { currentRuleset, rulesetById } from './rulesets';

/**
 * Auction room setup (ADR-024). Creating an auction room binds it to the
 * published ruleset of the current data pack and freezes that pool into the
 * room. Setup runs inside lifecycle LOBBY with rooms.phase:
 * FRANCHISE_SELECTION → RETENTION (retention format) → AUCTION_LOBBY.
 */

export async function setUpAuctionRoom(tx: Tx, roomId: string, settings: AuctionSettings) {
  const ruleset = await currentRuleset(tx);
  if (!ruleset) {
    throw new AppError('CONFIG_INVALID', 'No auction player pool has been published yet.');
  }
  const lowest = one(
    await tx.query<{ lowest: string | null; players: number }>(
      `SELECT min(base_price)::text AS lowest, count(*)::int AS players
         FROM app_private.auction_pool_entries WHERE ruleset_id = $1`,
      [ruleset.id],
    ),
  );
  if (!lowest.lowest) throw new AppError('POOL_INSUFFICIENT', 'The auction pool is empty.');
  const problems = poolFeasibility(
    ruleset.rules,
    Array.from({ length: settings.franchiseCount }, () => ({ retained: 0 })),
    lowest.players,
  );
  if (problems.length > 0) {
    throw new AppError('POOL_INSUFFICIENT', problems[0]?.message ?? 'The pool is too small.', {
      franchises: settings.franchiseCount,
      pool: lowest.players,
    });
  }
  await tx.query(
    `UPDATE app_private.rooms SET ruleset_id = $2, data_version_id = $3, phase = 'FRANCHISE_SELECTION'
      WHERE id = $1`,
    [roomId, ruleset.id, ruleset.dataVersionId],
  );
  await tx.query(
    `INSERT INTO app_private.auction_games (room_id, ruleset_id, rules_hash, format, lowest_base_price)
     VALUES ($1, $2, $3, $4, $5)`,
    [roomId, ruleset.id, ruleset.rulesHash, settings.format, lowest.lowest],
  );
  // Freeze the pool: the room keeps its own copy even if a new pool is published.
  await tx.query(
    `INSERT INTO app_private.auction_pool
       (room_id, player_id, base_price, previous_franchise_id, capped_status, overseas, role,
        current_salary, set_label, order_index)
     SELECT $1, player_id, base_price, previous_franchise_id, capped_status, overseas, role,
            current_salary, set_label, set_order
       FROM app_private.auction_pool_entries WHERE ruleset_id = $2`,
    [roomId, ruleset.id],
  );
}

export interface AuctionGameRow {
  room_id: string;
  ruleset_id: string;
  rules_hash: string;
  format: 'fresh' | 'retention';
  lowest_base_price: string;
}

export interface Setup {
  game: AuctionGameRow;
  rules: AuctionRules;
  dataKind: 'demo' | 'factual';
  phase: AuctionSetupPhase;
  settings: AuctionSettings;
}

export async function loadSetup(tx: Tx, room: RoomRow): Promise<Setup | null> {
  if (room.game_type !== 'auction') return null;
  const game = (
    await tx.query<AuctionGameRow>(
      `SELECT room_id, ruleset_id, rules_hash, format, lowest_base_price::text
         FROM app_private.auction_games WHERE room_id = $1`,
      [room.id],
    )
  ).rows[0];
  if (!game) return null;
  const ruleset = await rulesetById(tx, game.ruleset_id);
  if (!ruleset) throw new AppError('INTERNAL', 'The room’s ruleset is missing.');
  const phase = (['FRANCHISE_SELECTION', 'RETENTION', 'AUCTION_LOBBY'] as const).find(
    (p) => p === room.phase,
  );
  return {
    game,
    rules: ruleset.rules,
    dataKind: ruleset.dataKind,
    phase: phase ?? 'FRANCHISE_SELECTION',
    settings: room.settings as unknown as AuctionSettings,
  };
}

/** Load the setup of a room that must still be in its lobby (before the auction starts). */
export async function requireSetup(tx: Tx, room: RoomRow): Promise<Setup> {
  if (room.game_type !== 'auction') {
    throw new AppError('GAME_MISMATCH', 'This command belongs to the auction.');
  }
  if (room.lifecycle !== 'LOBBY') {
    throw new AppError('GAME_STARTED', 'The auction has already started.');
  }
  const setup = await loadSetup(tx, room);
  if (!setup) throw new AppError('STATE_CONFLICT', 'This room has no auction setup.');
  return setup;
}

export interface TeamRow {
  id: string;
  franchise_id: string;
  captain_member_id: string;
  initial_purse: string;
  remaining_purse: string;
  retention_charge: string;
}

export async function listTeams(tx: Tx, roomId: string): Promise<TeamRow[]> {
  const res = await tx.query<TeamRow>(
    `SELECT id, franchise_id, captain_member_id, initial_purse::text, remaining_purse::text,
            retention_charge::text
       FROM app_private.auction_franchises WHERE room_id = $1 ORDER BY created_at, id`,
    [roomId],
  );
  return res.rows;
}

export interface TeamMemberRow {
  auction_franchise_id: string;
  member_id: string;
  role: 'captain' | 'cocaptain' | 'bidder' | 'advisor';
  can_bid: boolean;
  can_invite: boolean;
  can_strategy: boolean;
  can_retain_propose: boolean;
  can_rtm: boolean;
  can_manage_limits: boolean;
}

/** The viewer's team membership in this room, if any. */
export async function teamMembership(
  tx: Tx,
  roomId: string,
  memberId: string,
): Promise<TeamMemberRow | null> {
  const res = await tx.query<TeamMemberRow>(
    `SELECT auction_franchise_id, member_id, role, can_bid, can_invite, can_strategy,
            can_retain_propose, can_rtm, can_manage_limits
       FROM app_private.franchise_members WHERE room_id = $1 AND member_id = $2`,
    [roomId, memberId],
  );
  return res.rows[0] ?? null;
}

/** Franchises that may be claimed: those whose players make up the frozen pool. */
export async function claimableFranchises(tx: Tx, roomId: string) {
  const res = await tx.query<{
    id: string;
    name: string;
    short_name: string;
    primary_hex: string;
    secondary_hex: string;
    previous_squad: number;
  }>(
    `SELECT f.id, f.name, f.short_name, f.primary_hex, f.secondary_hex, count(p.player_id)::int AS previous_squad
       FROM app_private.franchises f
       JOIN app_private.auction_pool p ON p.previous_franchise_id = f.id AND p.room_id = $1
      GROUP BY f.id ORDER BY f.name`,
    [roomId],
  );
  return res.rows;
}

// ------------------------------------------------------------- join codes
/** Team join codes use the room-code alphabet; only a keyed digest is indexed. */
export const teamCodeHash = (secrets: Secrets, code: string) =>
  hmac(secrets.lookupKey, 'team-code', normalizeRoomCode(code));

export function newTeamCode(secrets: Secrets, teamId: string) {
  const code = generateRoomCode();
  return {
    code: formatRoomCode(code),
    hash: teamCodeHash(secrets, code),
    sealed: Buffer.from(secrets.encryptor.encrypt(code, `team-code:${teamId}`)),
  };
}

export function openTeamCode(secrets: Secrets, teamId: string, sealed: Buffer): string {
  return formatRoomCode(secrets.encryptor.decrypt(sealed.toString('utf8'), `team-code:${teamId}`));
}

// ---------------------------------------------------------------- players
interface PlayerRow {
  player_id: string;
  name: string;
  role: AuctionPlayer['role'];
  country: string | null;
  overseas: boolean;
  capped_status: AuctionPlayer['cappedStatus'];
  base_price: string;
  price_source: AuctionPlayer['priceSource'] | null;
  current_salary: string | null;
  previous_franchise_id: string | null;
  set_label: string;
  portrait: string | null;
  alt: string | null;
}

/** Pool players with portraits (ADR-017), in auction order. */
export async function poolPlayers(
  tx: Tx,
  room: RoomRow,
  filter: { previousFranchiseId?: string; playerIds?: readonly string[] } = {},
): Promise<AuctionPlayer[]> {
  const res = await tx.query<PlayerRow>(
    `SELECT ap.player_id, p.canonical_name AS name, ap.role, p.country_code AS country, ap.overseas,
            ap.capped_status, ap.base_price::text, e.price_source, ap.current_salary::text,
            ap.previous_franchise_id, ap.set_label, a.id AS portrait, a.alt_text AS alt
       FROM app_private.auction_pool ap
       JOIN app_private.players p ON p.id = ap.player_id
       JOIN app_private.auction_games g ON g.room_id = ap.room_id
       LEFT JOIN app_private.auction_pool_entries e ON e.ruleset_id = g.ruleset_id AND e.player_id = ap.player_id
       LEFT JOIN app_private.player_seasons ps ON ps.player_id = ap.player_id AND ps.data_version_id = $2
       LEFT JOIN app_private.media_assets a ON a.id = ps.portrait_asset_id AND a.rights_status = 'approved'
      WHERE ap.room_id = $1
        AND ($3::uuid IS NULL OR ap.previous_franchise_id = $3)
        AND ($4::uuid[] IS NULL OR ap.player_id = ANY($4::uuid[]))
      ORDER BY ap.order_index`,
    [room.id, room.data_version_id, filter.previousFranchiseId ?? null, filter.playerIds ?? null],
  );
  return res.rows.map((r) => ({
    playerId: r.player_id,
    name: r.name,
    role: r.role,
    country: r.country,
    overseas: r.overseas,
    cappedStatus: r.capped_status,
    basePriceRupees: r.base_price,
    priceSource: r.price_source ?? 'registered',
    currentSalaryRupees: r.current_salary,
    previousFranchiseId: r.previous_franchise_id,
    setLabel: r.set_label,
    portraitUrl: r.portrait ? portraitPath(r.portrait) : '/original-assets/silhouette.svg',
    portraitAlt: r.alt ?? `Photo of ${r.name}`,
  }));
}

/** The engine's view of the frozen pool. */
export async function enginePool(tx: Tx, roomId: string): Promise<Map<string, PoolPlayer>> {
  const res = await tx.query<{
    player_id: string;
    base_price: string;
    capped_status: PoolPlayer['cappedStatus'];
    overseas: boolean;
    previous_franchise_id: string | null;
  }>(
    `SELECT player_id, base_price::text, capped_status, overseas, previous_franchise_id
       FROM app_private.auction_pool WHERE room_id = $1`,
    [roomId],
  );
  return new Map(
    res.rows.map((r) => [
      r.player_id,
      {
        playerId: r.player_id,
        basePrice: BigInt(r.base_price),
        cappedStatus: r.capped_status,
        overseas: r.overseas,
        previousFranchiseId: r.previous_franchise_id,
      },
    ]),
  );
}
