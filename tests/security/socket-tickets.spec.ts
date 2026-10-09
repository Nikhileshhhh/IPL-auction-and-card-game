import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { Server } from 'socket.io';
import { attachGateway } from '../../apps/server/src/realtime/gateway';
import {
  ACCESS_CODE,
  TEST_ORIGIN,
  createTestApi,
  onboardMember,
  type TestApi,
} from '../support/api';

let api: TestApi;
let gateway: Server;
let port: number;
const sockets: Socket[] = [];

beforeAll(async () => {
  api = await createTestApi('stumps_sec_tickets');
  await api.setAccessCode(ACCESS_CODE);
  gateway = attachGateway(api.app.server, {
    allowedOrigins: [TEST_ORIGIN],
    pool: api.pool,
    bus: api.deps.bus,
  });
  await api.app.listen({ port: 0, host: '127.0.0.1' });
  port = (api.app.server.address() as AddressInfo).port;
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await gateway?.close();
  await api?.close();
});

function open(ticket: string, origin = TEST_ORIGIN) {
  const socket = connect(`http://127.0.0.1:${port}`, {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { origin },
    auth: { ticket },
  });
  sockets.push(socket);
  return new Promise<{ result: string; socket: Socket }>((resolve) => {
    socket.on('connect', () => resolve({ result: 'connected', socket }));
    socket.on('connect_error', (e) => resolve({ result: e.message, socket }));
  });
}

async function ticketFor(username: string) {
  const member = await onboardMember(api, username);
  const res = await member.client.request<{ ticket: string; expiresAt: string }>(
    'POST',
    '/v1/socket-tickets',
  );
  expect(res.status).toBe(200);
  return { member, ticket: res.body.data!.ticket, expiresAt: res.body.data!.expiresAt };
}

describe('one-use socket tickets', () => {
  it('a ticket connects once; a stolen copy cannot be reused', async () => {
    const { ticket, expiresAt } = await ticketFor('ticket_user');
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(30_000);
    expect((await open(ticket)).result).toBe('connected');
    expect((await open(ticket)).result).toBe('TICKET_INVALID');
  });

  it('a ticket is bound to its origin', async () => {
    const { ticket } = await ticketFor('origin_user');
    expect((await open(ticket, 'http://evil.test')).result).not.toBe('connected');
  });

  it('an expired ticket is refused', async () => {
    const { ticket } = await ticketFor('expired_ticket_user');
    await api.admin.query(
      `UPDATE app_private.socket_tickets SET issued_at = now() - interval '2 minutes', expires_at = now() - interval '110 seconds'`,
    );
    expect((await open(ticket)).result).toBe('TICKET_INVALID');
  });

  it('tickets require gate + session: no ticket without a valid gate grant', async () => {
    const member = await onboardMember(api, 'gateless_ticket');
    const stripped = member.client.clone();
    stripped.gate = undefined;
    expect((await stripped.request('POST', '/v1/socket-tickets')).body.error?.code).toBe(
      'GATE_REQUIRED',
    );
  });

  it('a revoking rotation disconnects live sockets with auth.revoked', async () => {
    const { ticket } = await ticketFor('live_socket_user');
    const { result, socket } = await open(ticket);
    expect(result).toBe('connected');
    const revoked = new Promise<unknown>((resolve) => socket.on('auth.revoked', resolve));
    const disconnected = new Promise<void>((resolve) => socket.on('disconnect', () => resolve()));
    await api.setAccessCode('brand-new-code-789', { policy: 'REVOKE_EXISTING' });
    await api.admin.query(
      'UPDATE app_private.gate_grants SET revoked_at = now() WHERE revoked_at IS NULL',
    );
    api.deps.bus.emit({ kind: 'access.revoked', minValidVersion: '999' });
    expect(await revoked).toMatchObject({ reason: 'access.rotated' });
    await disconnected;
  });
});
