import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { attachGateway } from '../../apps/server/src/realtime/gateway';
import { OutboxDispatcher } from '../../apps/server/src/realtime/dispatcher';
import { evictFromRoom, registerRoomSockets } from '../../apps/server/src/realtime/rooms-socket';
import { TEST_ORIGIN, type BffClient, type TestApi } from './api';

export interface Realtime {
  io: Server;
  port: number;
  outbox: OutboxDispatcher;
  instanceId: string;
  open(client: BffClient): Promise<Socket>;
  close(): Promise<void>;
}

/** Real Socket.IO gateway + room handlers + outbox on a listening test API. */
export async function startRealtime(api: TestApi): Promise<Realtime> {
  const io = attachGateway(api.app.server, {
    allowedOrigins: [TEST_ORIGIN],
    pool: api.pool,
    bus: api.deps.bus,
  });
  const outbox = new OutboxDispatcher(api.pool, io);
  const instanceId = randomUUID();
  api.deps.rooms.bind({
    wake: outbox.wake,
    onMemberRemoved: (roomId, memberId) => evictFromRoom(io, roomId, memberId),
    onRoomClosed: (roomId) => evictFromRoom(io, roomId),
  });
  registerRoomSockets(io, {
    pool: api.pool,
    secrets: api.secrets,
    rooms: api.deps.rooms.deps,
    commands: api.deps.rooms.commands,
    instanceId,
  });
  outbox.start(50);
  await api.app.listen({ port: 0, host: '127.0.0.1' });
  const port = (api.app.server.address() as AddressInfo).port;
  const sockets: Socket[] = [];

  return {
    io,
    port,
    outbox,
    instanceId,
    async open(client) {
      const res = await client.request<{ ticket: string }>('POST', '/v1/socket-tickets');
      if (res.status !== 200) throw new Error(`ticket failed ${JSON.stringify(res.body)}`);
      const socket = connect(`http://127.0.0.1:${port}`, {
        path: '/socket.io',
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { origin: TEST_ORIGIN },
        auth: { ticket: res.body.data?.ticket },
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve());
        socket.on('connect_error', reject);
      });
      return socket;
    },
    async close() {
      outbox.stop();
      for (const s of sockets) s.close();
      await io.close();
    },
  };
}

/** Emit with an ack and resolve the envelope. */
export function emitAck<T = unknown>(
  socket: Socket,
  event: string,
  payload: unknown,
): Promise<{ ok: boolean; data?: T; error?: { code: string; details?: Record<string, unknown> } }> {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

/** Collect `room.event` envelopes as they arrive. */
export function collectEvents(socket: Socket) {
  const events: {
    type: string;
    streamId: string;
    seq: string;
    payload: Record<string, unknown>;
  }[] = [];
  socket.on('room.event', (e: (typeof events)[number]) => events.push(e));
  return events;
}

export async function waitFor(check: () => boolean, timeoutMs = 5_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}
