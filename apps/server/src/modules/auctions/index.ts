import type { Secrets } from '../../config/secrets';
import type { GameProjector } from '../../rooms/projection';
import type { CommandDispatcher } from '../commands/dispatcher';
import { registerAuctionCommands } from './commands';
import { auctionProjector } from './projection';

/**
 * Auction module (phase 09: setup). Franchise claims, team join requests and
 * retentions; the auction starter (bidding) arrives in phase 10.
 */
export function registerAuctionModule(
  registries: { commands: CommandDispatcher },
  secrets: Secrets,
): GameProjector {
  registerAuctionCommands(registries.commands, secrets);
  return auctionProjector(secrets);
}

export { setUpAuctionRoom } from './setup';
