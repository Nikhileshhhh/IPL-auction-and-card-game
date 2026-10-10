import 'server-only';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { INGRESS_HEADERS, canonicalIngress, credentialMaterial } from '@stumps/contracts';
import { bffConfig } from './config';

export const DIRECTIVES_HEADER = 'x-stumps-bff-directives';

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

export interface ApiCall {
  method: string;
  /** Path under the API including /v1 and any query string. */
  path: string;
  body?: string;
  clientIp: string;
  origin: string;
  bearer?: string;
  gate?: string;
  attempt?: string;
  refresh?: string;
  /** Validated command idempotency key (separate from the ingress nonce). */
  idempotencyKey?: string;
}

export interface ApiResult {
  status: number;
  text: string;
  directives: BffDirectives | undefined;
  retryAfter: string | null;
}

const sha256hex = (data: string) => createHash('sha256').update(data).digest('hex');

/** Server-to-server call to the Render API with the signed ingress envelope. */
export async function callApi(call: ApiCall): Promise<ApiResult> {
  const config = bffConfig();
  const body = call.body ?? '';
  const authorization = call.bearer ? `Bearer ${call.bearer}` : '';
  const timestamp = Date.now();
  const nonce = randomBytes(18).toString('base64url');
  const canonical = canonicalIngress({
    method: call.method,
    pathWithQuery: call.path,
    timestampMs: timestamp,
    nonce,
    clientIp: call.clientIp,
    origin: call.origin,
    bodySha256: sha256hex(body),
    credentialsSha256: sha256hex(
      credentialMaterial(authorization, call.gate ?? '', call.attempt ?? '', call.refresh ?? ''),
    ),
  });
  const headers: Record<string, string> = {
    [INGRESS_HEADERS.timestamp]: String(timestamp),
    [INGRESS_HEADERS.nonce]: nonce,
    [INGRESS_HEADERS.clientIp]: call.clientIp,
    [INGRESS_HEADERS.origin]: call.origin,
    [INGRESS_HEADERS.signature]: createHmac('sha256', config.signingKey)
      .update(canonical)
      .digest('base64url'),
  };
  if (authorization) headers.authorization = authorization;
  if (call.gate) headers[INGRESS_HEADERS.gate] = call.gate;
  if (call.attempt) headers[INGRESS_HEADERS.attempt] = call.attempt;
  if (call.refresh) headers[INGRESS_HEADERS.refresh] = call.refresh;
  if (call.idempotencyKey) headers['idempotency-key'] = call.idempotencyKey;
  if (body) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${call.path}`, {
      method: call.method,
      headers,
      ...(body ? { body } : {}),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return {
      status: 503,
      text: JSON.stringify({
        ok: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The game server is unreachable. Try again shortly.',
          retryable: true,
        },
        serverNow: new Date().toISOString(),
        requestId: 'bff_unreachable',
      }),
      directives: undefined,
      retryAfter: '5',
    };
  }
  const raw = response.headers.get(DIRECTIVES_HEADER);
  let directives: BffDirectives | undefined;
  if (raw) {
    try {
      directives = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as BffDirectives;
    } catch {
      directives = undefined;
    }
  }
  return {
    status: response.status,
    text: await response.text(),
    directives,
    retryAfter: response.headers.get('retry-after'),
  };
}
