import type { Secrets } from '../../config/secrets';
import type { DeadlineRegistry } from '../../jobs/deadlines';
import type { GameProjector } from '../../rooms/projection';
import type { StarterRegistry } from '../../rooms/starters';
import type { CommandDispatcher } from '../commands/dispatcher';
import { registerAutoDeadlines } from './auto-bid';
import { registerAutoCommands } from './auto-control';
import { registerLiveAuctionCommands } from './command';
import { registerAuctionCommands } from './commands';
import { registerAuctionDeadlines } from './deadlines';
import { liveSnapshot } from './live';
import { auctionProjector } from './projection';
import { auctionStarter } from './starter';

/**
 * Auction module. Setup (phase 09: franchise claims, join requests,
 * retentions) and the live auction (phase 10: lots, bids, RTM, passes,
 * pauses) and failover/automation (phase 12). The setup snapshot serves the
 * lobby; the live one the auction.
 */
export function registerAuctionModule(
  registries: {
    starters: StarterRegistry;
    deadlines: DeadlineRegistry;
    commands: CommandDispatcher;
  },
  secrets: Secrets,
): GameProjector {
  registerAuctionCommands(registries.commands, secrets);
  registerLiveAuctionCommands(registries.commands);
  registerAuctionDeadlines(registries.deadlines);
  registerAutoCommands(registries.commands);
  registerAutoDeadlines(registries.deadlines);
  registries.starters.register('auction', auctionStarter(secrets));
  const setup = auctionProjector(secrets);
  return (tx, room, member) =>
    room.lifecycle === 'LOBBY' ? setup(tx, room, member) : liveSnapshot(tx, secrets, room, member);
}

export { setUpAuctionRoom } from './setup';
export { autoView } from './auto-control';
export { armAbsenceCheck } from './auto-bid';
