import type { CommandDispatcher } from '../commands/dispatcher';
import { registerChatCommands } from './commands';

/** Chat module (phase 13, ADR-028): temporary room and team channels. */
export function registerChatModule(registries: { commands: CommandDispatcher }) {
  registerChatCommands(registries.commands);
}

export { channelView } from './channels';
