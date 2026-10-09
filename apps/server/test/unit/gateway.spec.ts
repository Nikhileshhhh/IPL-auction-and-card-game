import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { Server } from 'socket.io';
import { attachGateway } from '../../src/realtime/gateway';

let http: HttpServer | undefined;
let gateway: Server | undefined;
let client: Socket | undefined;

async function start() {
  const server = createServer();
  http = server;
  gateway = attachGateway(server, { allowedOrigins: ['http://play.test'] });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

function attempt(port: number, origin: string, auth: Record<string, unknown> = {}) {
  const socket = connect(`http://127.0.0.1:${port}`, {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { origin },
    auth,
  });
  client = socket;
  return new Promise<string>((resolve) => {
    socket.on('connect', () => resolve('connected'));
    socket.on('connect_error', (error) => resolve(error.message));
  });
}

afterEach(async () => {
  client?.close();
  await gateway?.close();
  await new Promise<void>((resolve) => (http?.listening ? http.close(() => resolve()) : resolve()));
});

describe('realtime gateway', () => {
  it('refuses every handshake without a valid one-use ticket (tickets arrive in phase 03)', async () => {
    const port = await start();
    expect(await attempt(port, 'http://play.test', { ticket: 'forged' })).toBe('TICKET_INVALID');
  });

  it('refuses handshakes from origins outside the exact allowlist', async () => {
    const port = await start();
    const result = await attempt(port, 'http://evil.test');
    expect(result).not.toBe('connected');
    expect(result).not.toBe('TICKET_INVALID');
  });
});
