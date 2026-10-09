import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';

export interface GatewayOptions {
  allowedOrigins: readonly string[];
}

/**
 * Socket.IO on the same HTTP server (ADR-003), WebSocket-only transport.
 * Connections require a one-use ticket (DB/realtime §2.3); ticket issuance
 * arrives in phase 03, so until then every handshake is refused.
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

  io.use((_socket, next) => {
    next(new Error('TICKET_INVALID'));
  });

  return io;
}
