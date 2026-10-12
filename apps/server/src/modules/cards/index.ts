import type { Secrets } from '../../config/secrets';
import type { DeadlineRegistry } from '../../jobs/deadlines';
import type { GameProjector } from '../../rooms/projection';
import type { StarterRegistry } from '../../rooms/starters';
import type { CommandDispatcher } from '../commands/dispatcher';
import { registerCardCommands } from './commands';
import { registerCardDeadlines } from './deadlines';
import { cardProjector } from './projection';
import { cardStarter } from './starter';
import { registerTieService } from './tie-service';

/** Wire the authoritative card engine into the room runtime (phases 07–08). */
export function registerCardModule(
  registries: {
    starters: StarterRegistry;
    deadlines: DeadlineRegistry;
    commands: CommandDispatcher;
  },
  secrets: Secrets,
): GameProjector {
  registries.starters.register('card', cardStarter(secrets));
  registerCardDeadlines(registries.deadlines, secrets);
  registerTieService(registries.deadlines, secrets);
  registerCardCommands(registries.commands, secrets);
  return cardProjector(secrets);
}
