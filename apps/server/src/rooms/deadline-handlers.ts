import { AppError } from '../http/app-error';
import type { DeadlineRegistry } from '../jobs/deadlines';
import { HOST_ABSENCE_MS, LOBBY_INACTIVITY_MS } from '../modules/rooms/service';
import { deleteOrEnqueue } from '../modules/cleanup';
import { deferWhileVoting } from '../modules/voting/clocks';
import { listMembers } from './projection';

export interface RoomJobHooks {
  onRoomClosed?: (roomId: string) => void;
}

export function registerRoomDeadlines(registry: DeadlineRegistry, hooks: RoomJobHooks = {}) {
  /** Lobby abandonment: 30 minutes without member actions or 2 hours absolute. */
  registry.register('room.lobby_expiry', async (tx, room, _job, now) => {
    if (room.lifecycle !== 'LOBBY') return {};
    const inactiveSince = room.last_activity_at.getTime() + LOBBY_INACTIVITY_MS;
    if (now.getTime() >= inactiveSince || now >= room.expires_at) {
      // A lobby has no achievements to preserve; Storage objects, if any, are
      // removed first by the recoverable cleanup task (ADR-030).
      if ((await deleteOrEnqueue(tx, room.id, 'lobby', now)) === 'queued') return {};
      return { roomDeleted: true, afterCommit: [() => hooks.onRoomClosed?.(room.id)] };
    }
    await tx.query(
      `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
       VALUES ($1, 'room.lobby_expiry', NULL, 0, $2)
       ON CONFLICT (room_id, kind, subject_id, generation) DO UPDATE SET due_at = EXCLUDED.due_at`,
      [room.id, new Date(Math.min(inactiveSince, room.expires_at.getTime()))],
    );
    return {};
  });

  /**
   * Host absent ≥60 s → earliest-joined connected player (UUID tie-break).
   * Nobody connected → keep the pointer and look again later (DB/realtime §5.2).
   */
  registry.register('room.host_absent', async (tx, room, job, now) => {
    if (room.lifecycle !== 'LOBBY' && room.lifecycle !== 'RUNNING') return {};
    const members = await listMembers(tx, room.id);
    const host = members.find((m) => m.user_id === room.host_user_id);
    if (!host || host.id !== job.subject_id || host.online) return {};
    // A host transfer waits for an open end-game vote; the vote resolves on its own (E53).
    if (await deferWhileVoting(tx, room, job)) return {};
    const successor = [...members]
      .filter((m) => m.id !== host.id && m.role === 'player' && m.online)
      .sort((a, b) => a.joined_at.getTime() - b.joined_at.getTime() || (a.id < b.id ? -1 : 1))[0];
    if (!successor) {
      await tx.query(
        `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
         VALUES ($1, 'room.host_absent', $2, 0, $3)
         ON CONFLICT (room_id, kind, subject_id, generation) DO UPDATE SET due_at = EXCLUDED.due_at`,
        [room.id, host.id, new Date(now.getTime() + HOST_ABSENCE_MS)],
      );
      return {};
    }
    await tx.query('UPDATE app_private.rooms SET host_user_id = $2 WHERE id = $1', [
      room.id,
      successor.user_id,
    ]);
    return {
      events: [
        {
          audience: { kind: 'public' },
          type: 'room.hostTransferred',
          payload: {
            configVersion: room.config_version,
            hostId: successor.id,
            reason: 'host_absent',
          },
        },
      ],
    };
  });

  registry.register('room.handover_expiry', async (tx, room, job) => {
    if (!job.subject_id) throw new AppError('INTERNAL', 'handover job without subject');
    await tx.query(
      `UPDATE app_private.host_handovers SET status = 'expired' WHERE id = $1 AND room_id = $2 AND status = 'pending'`,
      [job.subject_id, room.id],
    );
    return {};
  });
}
