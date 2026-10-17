import type { AuctionPlayerDetail } from '@stumps/contracts';
import { displayRating } from '@stumps/game-engines';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import type { RoomRow } from '../../rooms/room-tx';
import { playerStatistics, versionSource } from '../cricket-data/read';
import { poolPlayers } from './setup';

/**
 * S21 auction player detail: the public player, the room's frozen data
 * version (ratings, raw totals, source) and where the player stands in this
 * room's pool. Nothing private (no team strategy, no shortlist of anyone).
 */
export async function auctionPlayerDetail(
  tx: Tx,
  room: RoomRow,
  playerId: string,
): Promise<AuctionPlayerDetail> {
  if (room.game_type !== 'auction' || !room.data_version_id) {
    throw new AppError('NOT_FOUND', 'Player not found.');
  }
  const [player] = await poolPlayers(tx, room, { playerIds: [playerId] });
  if (!player) throw new AppError('NOT_FOUND', 'Player not found.');
  const pool = await tx.query<{
    status: AuctionPlayerDetail['poolStatus'];
    owner: string | null;
    label: string;
  }>(
    `SELECT ap.status, aq.auction_franchise_id AS owner, v.label
       FROM app_private.auction_pool ap
       JOIN app_private.data_versions v ON v.id = $3
       LEFT JOIN app_private.auction_acquisitions aq
              ON aq.room_id = ap.room_id AND aq.player_id = ap.player_id
      WHERE ap.room_id = $1 AND ap.player_id = $2`,
    [room.id, playerId, room.data_version_id],
  );
  const row = pool.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Player not found.');
  const ratings = await tx.query<{ metric: string; points: number }>(
    `SELECT metric, points FROM app_private.player_ratings
      WHERE data_version_id = $1 AND player_id = $2 ORDER BY metric`,
    [room.data_version_id, playerId],
  );
  const stats = await playerStatistics(tx, room.data_version_id, playerId, row.label);
  return {
    player,
    poolStatus: row.status,
    ownerTeamId: row.owner,
    ratings: Object.fromEntries(ratings.rows.map((r) => [r.metric, displayRating(r.points)])),
    raw: stats.raw,
    dataLabel: row.label,
    source: await versionSource(tx, room.data_version_id),
  };
}
