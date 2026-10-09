import type { Server as HttpServer } from 'node:http';
import type pg from 'pg';
import { Server } from 'socket.io';
import { consumeTicket, type SocketPrincipal } from './tickets';
import type { SecurityBus } from './security-bus';

export interface GatewayOptions {
  allowedOrigins: readonly string[];
  /** Without a pool (e.g. unit tests) every handshake is refused. */
  pool?: pg.Pool;
  bus?: SecurityBus;
}

declare module 'socket.io' {
  interface SocketData {
    principal: SocketPrincipal;
  }
}

/**
 * Socket.IO on the same HTTP server (ADR-003), WebSocket-only transport.
 * The handshake must carry a one-use ticket in the auth payload (never the
 * URL); CORS alone is not WebSocket authorization (DB/realtime §2.3).
 */
export function attachGateway(httpServer: HttpServer, options: GatewayOptions): Server {
  const io = new Server(httpServer, {
    path: '/socket.io',
    transports: ['websocket'],
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, typeof origin === 'string' && options.allowedOrigins.includes(origin));
    },
  });

  io.use((socket, next) => {
    const pool = options.pool;
    const origin = socket.handshake.headers.origin;
    const auth = socket.handshake.auth as Record<string, unknown>;
    if (!pool || typeof origin !== 'string') return next(new Error('TICKET_INVALID'));
    consumeTicket(pool, auth.ticket, origin)
      .then((principal) => {
        if (!principal) return next(new Error('TICKET_INVALID'));
        socket.data.principal = principal;
        next();
      })
      .catch(() => next(new Error('SERVICE_UNAVAILABLE')));
  });

  options.bus?.on((signal) => {
    if (signal.kind !== 'access.revoked' || !options.pool) return;
    const sockets = [...io.sockets.sockets.values()];
    const grantIds = [...new Set(sockets.map((s) => s.data.principal?.grantId).filter(Boolean))];
    if (grantIds.length === 0) return;
    options.pool
      .query<{ id: string }>(
        `SELECT g.id FROM app_private.gate_grants g JOIN app_private.access_config c ON c.id = 1
          WHERE g.id = ANY($1::uuid[]) AND (g.revoked_at IS NOT NULL OR g.access_version < c.min_valid_version)`,
        [grantIds],
      )
      .then((res) => {
        const revoked = new Set(res.rows.map((r) => r.id));
        for (const socket of sockets) {
          if (revoked.has(socket.data.principal?.grantId)) {
            socket.emit('auth.revoked', { reason: 'access.rotated', reverifyUrl: '/access' });
            socket.disconnect(true);
          }
        }
      })
      .catch(() => undefined);
  });

  return io;
}
