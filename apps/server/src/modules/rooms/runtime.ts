import type pg from 'pg';
import type { Secrets } from '../../config/secrets';
import { DeadlineRegistry, dueSettler } from '../../jobs/deadlines';
import { registerRoomDeadlines } from '../../rooms/deadline-handlers';
import { StarterRegistry } from '../../rooms/starters';
import type { GameProjector } from '../../rooms/projection';
import { registerAuctionModule } from '../auctions';
import { registerCardModule } from '../cards';
import { registerTeamModule } from '../teams';
import { registerChatModule } from '../chat';
import { CommandDispatcher } from '../commands/dispatcher';
import type { RoomDeps } from './service';

/**
 * Room infrastructure shared by HTTP routes, sockets and workers. The outbox
 * wake and socket hooks are late-bound because Socket.IO attaches after the
 * HTTP app is built; until then they are no-ops (the dispatcher also polls).
 */
export interface RoomRuntime {
  deps: RoomDeps;
  deadlines: DeadlineRegistry;
  starters: StarterRegistry;
  commands: CommandDispatcher;
  gameProjector?: GameProjector;
  bind(hooks: {
    wake?: () => void;
    onMemberRemoved?: (roomId: string, memberId: string) => void;
    onRoomClosed?: (roomId: string) => void;
    onStreamGranted?: (roomId: string, memberId: string, streamId: string) => void;
  }): void;
}

export function createRoomRuntime(pool: pg.Pool, secrets: Secrets): RoomRuntime {
  const deadlines = new DeadlineRegistry();
  const starters = new StarterRegistry();
  const commands = new CommandDispatcher();
  let wake: () => void = () => undefined;
  let onMemberRemoved: (roomId: string, memberId: string) => void = () => undefined;
  let onRoomClosed: (roomId: string) => void = () => undefined;
  let onStreamGranted: (roomId: string, memberId: string, streamId: string) => void = () =>
    undefined;

  const deps: RoomDeps = {
    pool,
    secrets,
    starters,
    settleDue: dueSettler(deadlines),
    wake: () => wake(),
    onMemberRemoved: (roomId, memberId) => onMemberRemoved(roomId, memberId),
    onRoomClosed: (roomId) => onRoomClosed(roomId),
    onStreamGranted: (roomId, memberId, streamId) => onStreamGranted(roomId, memberId, streamId),
  };
  registerRoomDeadlines(deadlines, { onRoomClosed: (roomId) => onRoomClosed(roomId) });
  const cardProjector = registerCardModule({ starters, deadlines, commands }, secrets);
  const auctionProjector = registerAuctionModule({ starters, deadlines, commands }, secrets);
  registerTeamModule({ commands }, secrets);
  registerChatModule({ commands });
  // One projector per game type: the snapshot's `game` belongs to the room's game.
  const gameProjector: GameProjector = (tx, room, member) =>
    room.game_type === 'auction'
      ? auctionProjector(tx, room, member)
      : cardProjector(tx, room, member);

  return {
    deps,
    deadlines,
    starters,
    commands,
    gameProjector,
    bind(hooks) {
      if (hooks.wake) wake = hooks.wake;
      if (hooks.onMemberRemoved) onMemberRemoved = hooks.onMemberRemoved;
      if (hooks.onRoomClosed) onRoomClosed = hooks.onRoomClosed;
      if (hooks.onStreamGranted) onStreamGranted = hooks.onStreamGranted;
    },
  };
}
