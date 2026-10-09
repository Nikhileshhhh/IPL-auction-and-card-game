import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  INGRESS_HEADERS,
  INGRESS_MAX_AGE_MS,
  canonicalIngress,
  credentialMaterial,
} from '@stumps/contracts';
import { AppError } from './app-error';
import { safeEqual, sha256 } from '../security/crypto';

export interface IngressContext {
  clientIp: string;
  origin: string;
  bearer: string | undefined;
  gateToken: string | undefined;
  attemptToken: string | undefined;
  refreshToken: string | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
    ingress?: IngressContext;
  }
}

/** Bounded per-process nonce replay cache (single instance; DB/realtime §2.1). */
export class NonceCache {
  private readonly seen = new Map<string, number>();
  constructor(private readonly maxEntries = 100_000) {}

  /** Returns false when the nonce was already used within its lifetime. */
  claim(nonce: string, nowMs: number): boolean {
    if (this.seen.size > this.maxEntries / 2) {
      for (const [key, expiry] of this.seen) if (expiry <= nowMs) this.seen.delete(key);
    }
    const expiry = this.seen.get(nonce);
    if (expiry !== undefined && expiry > nowMs) return false;
    if (this.seen.size >= this.maxEntries) return false; // fail closed under flood
    this.seen.set(nonce, nowMs + INGRESS_MAX_AGE_MS * 2);
    return true;
  }
}

function header(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  return typeof value === 'string' ? value : '';
}

export interface IngressOptions {
  signingKey: Buffer;
  nonces?: NonceCache;
  now?: () => number;
  /** Routes reachable without a BFF signature (exact paths). */
  publicPaths?: ReadonlySet<string>;
}

/**
 * Every /v1 request must come from the trusted BFF: HMAC over method, path,
 * timestamp, nonce, client IP, browser Origin, body hash and forwarded
 * credentials. Browser-supplied X-Forwarded-For is never trusted.
 */
export const ingressPlugin = fp(async (app: FastifyInstance, opts: IngressOptions) => {
  const nonces = opts.nonces ?? new NonceCache();
  const now = opts.now ?? Date.now;

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const raw = typeof body === 'string' ? body : body.toString('utf8');
    request.rawBody = raw;
    if (raw.length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(new AppError('VALIDATION_FAILED', 'Request is malformed.'), undefined);
    }
  });

  app.addHook('preHandler', async (request) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/v1/') || opts.publicPaths?.has(path)) return;

    const timestamp = Number(header(request, INGRESS_HEADERS.timestamp));
    const nonce = header(request, INGRESS_HEADERS.nonce);
    const signature = header(request, INGRESS_HEADERS.signature);
    const clientIp = header(request, INGRESS_HEADERS.clientIp);
    const origin = header(request, INGRESS_HEADERS.origin);
    const authorization = header(request, 'authorization');
    const gate = header(request, INGRESS_HEADERS.gate);
    const attempt = header(request, INGRESS_HEADERS.attempt);
    const refresh = header(request, INGRESS_HEADERS.refresh);
    const nowMs = now();

    if (
      !signature ||
      !nonce ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) ||
      !Number.isFinite(timestamp) ||
      !clientIp
    ) {
      throw new AppError('FORBIDDEN', 'Request not accepted.');
    }
    if (Math.abs(nowMs - timestamp) > INGRESS_MAX_AGE_MS)
      throw new AppError('FORBIDDEN', 'Request not accepted.');

    const canonical = canonicalIngress({
      method: request.method,
      pathWithQuery: request.url,
      timestampMs: timestamp,
      nonce,
      clientIp,
      origin: origin || '-',
      bodySha256: sha256(request.rawBody ?? '').toString('hex'),
      credentialsSha256: sha256(credentialMaterial(authorization, gate, attempt, refresh)).toString(
        'hex',
      ),
    });
    const expected = createHmac('sha256', opts.signingKey).update(canonical).digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(signature, 'base64url');
    } catch {
      throw new AppError('FORBIDDEN', 'Request not accepted.');
    }
    if (!safeEqual(expected, provided)) throw new AppError('FORBIDDEN', 'Request not accepted.');
    if (!nonces.claim(nonce, nowMs)) throw new AppError('FORBIDDEN', 'Request not accepted.');

    request.ingress = {
      clientIp,
      origin: origin || '-',
      bearer: authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined,
      gateToken: gate || undefined,
      attemptToken: attempt || undefined,
      refreshToken: refresh || undefined,
    };
  });
});

export function requireIngress(request: FastifyRequest): IngressContext {
  if (!request.ingress) throw new AppError('FORBIDDEN', 'Request not accepted.');
  return request.ingress;
}
