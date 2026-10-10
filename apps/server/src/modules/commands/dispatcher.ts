import {
  CommandEnvelopeSchema,
  isAllowlistedCommand,
  type CommandEnvelope,
} from '@stumps/contracts';
import { z } from 'zod';
import { AppError } from '../../http/app-error';
import { acceptHostTransfer, type MemberContext, type RoomDeps } from '../rooms/service';

export interface CommandActor extends MemberContext {
  /** Socket that sent the command, when it came over the realtime channel. */
  socketId?: string;
}

type Handler = (deps: RoomDeps, actor: CommandActor, envelope: CommandEnvelope) => Promise<unknown>;

const HostAcceptPayload = z.object({ handoverId: z.uuid() }).strict();

/**
 * Explicit allowlist of client commands (DB/realtime §8.2). Method names are
 * never reflected; internal actions (deal, award, sell…) have no entry and
 * are UNKNOWN_COMMAND. Engines register their handlers as their phases land.
 */
export class CommandDispatcher {
  private readonly handlers = new Map<string, Handler>();

  constructor() {
    this.register('room.host.accept', async (deps, actor, env) => {
      const payload = HostAcceptPayload.parse(env.payload);
      return acceptHostTransfer(deps, actor, env.roomId, payload.handoverId, env.commandId);
    });
  }

  register(type: string, handler: Handler) {
    if (!isAllowlistedCommand(type)) throw new Error(`${type} is not an allowlisted command`);
    this.handlers.set(type, handler);
  }

  async dispatch(deps: RoomDeps, actor: CommandActor, raw: unknown): Promise<unknown> {
    const parsed = CommandEnvelopeSchema.safeParse(raw);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'Command is malformed.');
    const envelope = parsed.data;
    const handler = isAllowlistedCommand(envelope.type)
      ? this.handlers.get(envelope.type)
      : undefined;
    if (!handler) throw new AppError('UNKNOWN_COMMAND', 'This action is not available.');
    // Control fencing: commands from an outdated tab/epoch are refused (E25).
    const member = await deps.pool.query<{ control_epoch: string; is_controller: boolean | null }>(
      `SELECT m.control_epoch::text,
              (SELECT c.is_controller FROM app_private.room_connections c WHERE c.member_id = m.id AND c.socket_id = $3) AS is_controller
         FROM app_private.room_members m WHERE m.room_id = $1 AND m.user_id = $2`,
      [envelope.roomId, actor.userId, actor.socketId ?? ''],
    );
    const row = member.rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'Room not found.');
    if (row.control_epoch !== envelope.controlEpoch) {
      throw new AppError(
        'CONTROL_EPOCH_STALE',
        'Another tab is in control. Take control to act here.',
      );
    }
    if (actor.socketId && row.is_controller === false) {
      throw new AppError('CONTROL_EPOCH_STALE', 'This tab is read-only. Take control to act here.');
    }
    try {
      return await handler(deps, actor, envelope);
    } catch (error) {
      if (error instanceof z.ZodError)
        throw new AppError('VALIDATION_FAILED', 'Command payload is malformed.');
      throw error;
    }
  }
}
