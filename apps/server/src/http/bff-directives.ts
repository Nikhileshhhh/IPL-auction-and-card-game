import type { FastifyReply } from 'fastify';

/**
 * Cookie instructions for the trusted BFF only. Sent in a response header that
 * the BFF strips before answering the browser; tokens therefore never appear
 * in browser-visible JSON (DB/realtime §2.1).
 */
export interface BffDirectives {
  setAttempt?: { token: string };
  setGate?: { token: string; expiresAt: string };
  clearGate?: true;
  setSession?: {
    scope: 'member' | 'admin';
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  };
  clearSession?: 'member' | 'admin';
  rotateCsrf?: true;
}

export const BFF_DIRECTIVES_HEADER = 'x-stumps-bff-directives';

export function sendDirectives(reply: FastifyReply, directives: BffDirectives) {
  const existing = reply.getHeader(BFF_DIRECTIVES_HEADER);
  const merged: BffDirectives = {
    ...(typeof existing === 'string'
      ? (JSON.parse(Buffer.from(existing, 'base64url').toString('utf8')) as BffDirectives)
      : {}),
    ...directives,
  };
  reply.header(BFF_DIRECTIVES_HEADER, Buffer.from(JSON.stringify(merged)).toString('base64url'));
}
