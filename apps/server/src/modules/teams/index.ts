import type { Secrets } from '../../config/secrets';
import type { CommandDispatcher } from '../commands/dispatcher';
import { registerHandoverCommands } from './handover';
import { registerInvitationCommands } from './invitations';
import { registerPermissionCommands } from './permissions';
import { registerStrategyCommands } from './strategy';

/**
 * Teams module (phase 11, ADR-026): join requests and code rotation,
 * capability delegation, captain handover by consent, and the private
 * shortlist. The host has no team powers; every right is read from the
 * database under the room lock.
 */
export function registerTeamModule(registries: { commands: CommandDispatcher }, secrets: Secrets) {
  registerInvitationCommands(registries.commands, secrets);
  registerPermissionCommands(registries.commands);
  registerHandoverCommands(registries.commands);
  registerStrategyCommands(registries.commands);
}

export { shortlistView } from './strategy';
export { teamView } from './view';
