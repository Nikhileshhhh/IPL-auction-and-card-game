'use client';

import { io, type Socket } from 'socket.io-client';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ApiError, PermittedSnapshotDTO } from '@stumps/contracts';
import { api, type ClientResult } from '@/lib/api-client';
import { PUBLIC_SOCKET_URL } from '@/lib/env.public';
import { applyEvent, fromSnapshot, type RoomEvent, type RoomState } from './events';

export type LinkStatus =
  'connecting' | 'live' | 'reconnecting' | 'removed' | 'closed' | 'unavailable';

export interface RoomStoreState {
  status: LinkStatus;
  room: RoomState | null;
  /** Load failure for the initial snapshot (e.g. not a member → NOT_FOUND). */
  loadError: ApiError | null;
  socketId: string | null;
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };

const PING_MS = 10_000;

/**
 * One room's live link: Socket.IO for pushes and presence, HTTP for snapshot,
 * replay and mutations. The browser state is only ever the last confirmed
 * server state; gaps trigger replay or a fresh snapshot, never a guess.
 */
export class RoomConnection {
  readonly store: StoreApi<RoomStoreState>;
  private socket: Socket | undefined;
  private ping: ReturnType<typeof setInterval> | undefined;
  private refetchTimer: ReturnType<typeof setTimeout> | undefined;
  private resyncing = false;
  private queue: RoomEvent[] = [];
  private stopped = false;

  constructor(readonly roomId: string) {
    this.store = createStore<RoomStoreState>(() => ({
      status: 'connecting',
      room: null,
      loadError: null,
      socketId: null,
    }));
  }

  start() {
    this.stopped = false;
    void this.loadSnapshot();
    const socket = io(PUBLIC_SOCKET_URL, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      // A fresh one-use ticket for every (re)connection attempt; never in the URL.
      auth: (cb) => {
        void api<{ ticket: string }>('/socket-tickets', { method: 'POST' }).then((res) =>
          cb(res.ok ? { ticket: res.data.ticket } : {}),
        );
      },
    });
    this.socket = socket;
    socket.on('connect', () => void this.subscribe());
    socket.on('disconnect', () => {
      if (!this.stopped && this.isActive()) this.patch({ status: 'reconnecting', socketId: null });
    });
    socket.on('connect_error', () => {
      if (this.isActive()) this.patch({ status: 'reconnecting' });
    });
    socket.on('room.event', (event: RoomEvent) => this.onEvent(event));
    socket.on('room.removed', () => this.end('removed'));
    socket.on('room.closed', () => this.end('closed'));
    socket.on('auth.revoked', (p: { reverifyUrl?: string }) => {
      window.location.assign(p.reverifyUrl === '/access' ? '/access' : '/auth');
    });
    this.ping = setInterval(() => {
      if (socket.connected) socket.emit('presence.ping', {}, () => undefined);
    }, PING_MS);
  }

  stop() {
    this.stopped = true;
    if (this.ping) clearInterval(this.ping);
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.socket?.close();
  }

  private isActive() {
    const s = this.store.getState().status;
    return s !== 'removed' && s !== 'closed' && s !== 'unavailable';
  }

  private patch(partial: Partial<RoomStoreState>) {
    this.store.setState(partial);
  }

  private end(status: 'removed' | 'closed') {
    this.patch({ status });
    this.socket?.close();
  }

  private emit<T>(event: string, payload: unknown): Promise<Envelope<T>> {
    return new Promise((resolve) => {
      const socket = this.socket;
      if (!socket?.connected) {
        resolve({
          ok: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Reconnecting…', retryable: true },
        });
        return;
      }
      socket.timeout(10_000).emit(event, payload, (err: Error | null, res: Envelope<T>) =>
        resolve(
          err
            ? {
                ok: false,
                error: {
                  code: 'SERVICE_UNAVAILABLE',
                  message: 'No answer from the server.',
                  retryable: true,
                },
              }
            : res,
        ),
      );
    });
  }

  private async subscribe() {
    const res = await this.emit<PermittedSnapshotDTO>('room.subscribe', { roomId: this.roomId });
    if (res.ok) {
      this.patch({
        status: 'live',
        room: fromSnapshot(res.data),
        loadError: null,
        socketId: this.socket?.id ?? null,
      });
      return;
    }
    if (res.error.code === 'NOT_FOUND' || res.error.code === 'ROOM_GONE') {
      this.patch({ status: 'unavailable', loadError: res.error });
      this.socket?.close();
    }
  }

  /** HTTP snapshot (initial paint and resync). Keeps this tab's controller flag. */
  private async loadSnapshot() {
    const res = await api<PermittedSnapshotDTO>(`/rooms/${this.roomId}/snapshot`);
    if (!res.ok) {
      if (res.status === 404 || res.status === 410)
        this.patch({ status: 'unavailable', loadError: res.error });
      return;
    }
    const current = this.store.getState().room;
    const snapshot = current
      ? { ...res.data, me: { ...res.data.me, isController: current.snapshot.me.isController } }
      : res.data;
    this.patch({ room: fromSnapshot(snapshot) });
  }

  private scheduleRefetch() {
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.refetchTimer = setTimeout(() => void this.loadSnapshot(), 150);
  }

  private onEvent(event: RoomEvent) {
    if (this.resyncing) {
      this.queue.push(event);
      return;
    }
    const room = this.store.getState().room;
    if (!room) return;
    const result = applyEvent(room, event, this.socket?.id);
    if (result.kind === 'duplicate') return;
    if (result.kind === 'gap') {
      this.queue.push(event);
      void this.resync(result.streamId, result.afterSeq);
      return;
    }
    this.patch({ room: result.state });
    if (result.refetch) this.scheduleRefetch();
  }

  /** Replay missed events for one stream; too far behind → fresh snapshot. */
  private async resync(streamId: string, afterSeq: string) {
    this.resyncing = true;
    try {
      const res = await api<{ events: RoomEvent[]; snapshotRequired: boolean }>(
        `/rooms/${this.roomId}/events?streamId=${streamId}&afterSeq=${afterSeq}`,
      );
      if (!res.ok || res.data.snapshotRequired) {
        await this.loadSnapshot();
      } else {
        this.resyncing = false;
        for (const event of res.data.events) this.onEvent(event);
      }
    } finally {
      this.resyncing = false;
      const queued = this.queue.splice(0);
      for (const event of queued) this.onEvent(event);
    }
  }

  // ---------------------------------------------------------------- actions

  private stateVersion() {
    return this.store.getState().room?.snapshot.room.stateVersion ?? '0';
  }

  mutate<T>(
    path: string,
    body: unknown = {},
    method: 'POST' | 'PATCH' = 'POST',
  ): Promise<ClientResult<T>> {
    return api<T>(`/rooms/${this.roomId}${path}`, { method, body });
  }

  /** Allowlisted game command: socket when live, identical HTTP fallback otherwise. */
  async command<T>(type: string, payload: Record<string, unknown>): Promise<Envelope<T>> {
    const room = this.store.getState().room;
    const envelope = {
      type,
      commandId: crypto.randomUUID(),
      roomId: this.roomId,
      expectedVersion: this.stateVersion(),
      controlEpoch: room?.snapshot.me.controlEpoch ?? '0',
      payload,
    };
    if (this.socket?.connected) return this.emit<T>('game.command', envelope);
    const res = await api<T>(`/rooms/${this.roomId}/commands`, { method: 'POST', body: envelope });
    return res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error };
  }

  /** Explicit fenced takeover: this tab becomes the controller (E25). */
  async takeControl(): Promise<Envelope<{ newEpoch: string }>> {
    const room = this.store.getState().room;
    const res = await this.emit<{ newEpoch: string }>('room.control.take', {
      roomId: this.roomId,
      currentEpoch: room?.snapshot.me.controlEpoch ?? '0',
      commandId: crypto.randomUUID(),
    });
    const latest = this.store.getState().room;
    if (res.ok && latest) {
      this.patch({
        room: {
          ...latest,
          snapshot: {
            ...latest.snapshot,
            me: { ...latest.snapshot.me, controlEpoch: res.data.newEpoch, isController: true },
          },
        },
      });
    }
    return res;
  }

  refresh() {
    void this.loadSnapshot();
  }
}
