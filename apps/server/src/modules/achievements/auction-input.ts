import { createHash } from 'node:crypto';
import {
  median,
  type EvalPlayer,
  type PoolValueReference,
  type SquadRules,
} from '@stumps/game-engines';
import type { Tx } from '../../db/transaction';
import type { RoomRow } from '../../rooms/room-tx';
import { rulesetById } from '../auctions/rulesets';

/**
 * Frozen inputs of the squad evaluation (rules §10): each franchise's squad
 * with the room's data-version ratings, the ruleset's squad limits and the
 * pool's price reference. The input hash pins a checkpoint to exactly these
 * inputs; a stale checkpoint is discarded and the evaluation restarts.
 */

const METRICS = [
  'batting',
  'bowling',
  'fielding',
  'powerplay_batting',
  'middle_batting',
  'death_batting',
  'powerplay_bowling',
  'death_bowling',
  'role_strength',
] as const;

export interface SquadInput {
  franchiseId: string;
  name: string;
  players: EvalPlayer[];
}

export interface EvaluationInput {
  rules: SquadRules;
  ref: PoolValueReference;
  squads: SquadInput[];
  rulesetName: string;
  hash: string;
}

export async function loadEvaluationInput(tx: Tx, room: RoomRow): Promise<EvaluationInput> {
  const game = (
    await tx.query<{ ruleset_id: string }>(
      'SELECT ruleset_id FROM app_private.auction_games WHERE room_id = $1',
      [room.id],
    )
  ).rows[0];
  const ruleset = game ? await rulesetById(tx, game.ruleset_id) : null;
  if (!ruleset) throw new Error('auction ruleset missing');
  const rules: SquadRules = {
    minSquad: ruleset.rules.squadMin,
    maxSquad: ruleset.rules.squadMax,
    overseasCap: ruleset.rules.overseasMax,
  };
  const teams = await tx.query<{ id: string; name: string }>(
    `SELECT af.id, f.name FROM app_private.auction_franchises af
       JOIN app_private.franchises f ON f.id = af.franchise_id
      WHERE af.room_id = $1 ORDER BY af.id`,
    [room.id],
  );
  const rows = await tx.query<{
    auction_franchise_id: string;
    player_id: string;
    kind: string;
    charged_price: string;
    allocation_price: string | null;
    role: EvalPlayer['role'];
    bowl_type: EvalPlayer['bowlType'];
    overseas: boolean;
    ratings: Record<string, number> | null;
  }>(
    `SELECT a.auction_franchise_id, a.player_id, a.kind, a.charged_price::text, a.allocation_price::text,
            p.role, p.bowl_type, p.overseas,
            (SELECT jsonb_object_agg(r.metric, r.points)
               FROM app_private.player_ratings r
              WHERE r.data_version_id = $2 AND r.player_id = a.player_id
                AND r.metric = ANY($3::text[])) AS ratings
       FROM app_private.auction_acquisitions a
       JOIN app_private.auction_pool p ON p.room_id = a.room_id AND p.player_id = a.player_id
      WHERE a.room_id = $1
      ORDER BY a.player_id`,
    [room.id, room.data_version_id, METRICS],
  );
  const toPlayer = (r: (typeof rows.rows)[number]): EvalPlayer => {
    const v = (m: (typeof METRICS)[number]) => Math.round(Number(r.ratings?.[m] ?? 0));
    return {
      id: r.player_id,
      role: r.role,
      bowlType: r.bowl_type,
      overseas: r.overseas,
      batting: v('batting'),
      bowling: v('bowling'),
      fielding: v('fielding'),
      powerplayBatting: v('powerplay_batting'),
      middleBatting: v('middle_batting'),
      deathBatting: v('death_batting'),
      powerplayBowling: v('powerplay_bowling'),
      deathBowling: v('death_bowling'),
      roleStrength: v('role_strength'),
      completeness: METRICS.filter((m) => r.ratings?.[m] !== undefined).length,
      // Retained players count at their allocated charge.
      cost: BigInt(
        r.kind === 'retention' && r.allocation_price ? r.allocation_price : r.charged_price,
      ),
    };
  };
  const squads = teams.rows.map((t) => ({
    franchiseId: t.id,
    name: t.name,
    players: rows.rows.filter((r) => r.auction_franchise_id === t.id).map(toPlayer),
  }));
  const pool = await tx.query<{ base_price: string; role_strength: number | null }>(
    `SELECT ap.base_price::text,
            (SELECT r.points FROM app_private.player_ratings r
              WHERE r.data_version_id = $2 AND r.player_id = ap.player_id AND r.metric = 'role_strength'
              LIMIT 1) AS role_strength
       FROM app_private.auction_pool ap WHERE ap.room_id = $1`,
    [room.id, room.data_version_id],
  );
  const ref: PoolValueReference = {
    medianBasePrice: median(pool.rows.map((p) => BigInt(p.base_price))),
    medianQuality: median(
      pool.rows.map((p) => BigInt(500 + Math.round(Number(p.role_strength ?? 0)))),
    ),
  };
  const canonical = JSON.stringify({ rules, ref, squads }, (_k, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  return {
    rules,
    ref,
    squads,
    rulesetName: ruleset.rules.name,
    hash: createHash('sha256').update(canonical).digest('hex'),
  };
}
