import type { SquadDTO } from '@stumps/contracts';
import { squadSummary } from '@stumps/game-engines';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import type { RoomRow } from '../../rooms/room-tx';
import { listTeams, loadSetup, poolPlayers } from './setup';

/**
 * A team's squad (S22, DB/realtime §10 SquadDTO): acquisitions with their cost,
 * purse, reserve and plain-language deficits. Public to the room; strategy is
 * never included.
 */
export async function squadOf(tx: Tx, room: RoomRow, teamId: string): Promise<SquadDTO> {
  const setup = await loadSetup(tx, room);
  const team = setup ? (await listTeams(tx, room.id)).find((t) => t.id === teamId) : undefined;
  if (!setup || !team) throw new AppError('NOT_FOUND', 'Team not found.');
  const rows = await tx.query<{
    player_id: string;
    kind: 'retention' | 'auction' | 'rtm';
    charged_price: string;
  }>(
    `SELECT player_id, kind, charged_price::text FROM app_private.auction_acquisitions
      WHERE room_id = $1 AND auction_franchise_id = $2 ORDER BY created_at, player_id`,
    [room.id, teamId],
  );
  const players = new Map(
    (await poolPlayers(tx, room, { playerIds: rows.rows.map((r) => r.player_id) })).map((p) => [
      p.playerId,
      p,
    ]),
  );
  const acquisitions = rows.rows.flatMap((r) => {
    const player = players.get(r.player_id);
    return player ? [{ player, kind: r.kind, costRupees: r.charged_price }] : [];
  });
  const summary = squadSummary(
    setup.rules,
    acquisitions.map((a) => ({ overseas: a.player.overseas })),
    BigInt(setup.game.lowest_base_price),
  );
  return {
    franchiseId: teamId,
    acquisitions,
    remainingPurseRupees: team.remaining_purse,
    reserveRupees: summary.reserve.toString(),
    overseasCount: summary.overseasCount,
    rosterCount: summary.rosterCount,
    deficits: summary.deficits,
  };
}
