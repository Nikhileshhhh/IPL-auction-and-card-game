import { NextResponse, type NextRequest } from 'next/server';
import { callApi, type BffDirectives } from '@/lib/bff/api';
import { bffConfig } from '@/lib/bff/config';
import { readCredentialCookies, tokenExpiresSoon } from '@/lib/bff/cookies';
import { csrfValid } from '@/lib/bff/csrf';
import { applyDirectives } from '@/lib/bff/directives';
import { clientIpFrom } from '@/lib/bff/request-context';

export const dynamic = 'force-dynamic';

const MAX_BODY = 16 * 1024;
const MAX_IMPORT_BODY = 5 * 1024 * 1024;
// Admin portrait uploads: 2 MiB image as base64 inside JSON.
const MAX_MEDIA_BODY = 3 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function failure(status: number, code: string, message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      serverNow: new Date().toISOString(),
      requestId: 'bff',
    },
    { status, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

/**
 * Same-origin BFF (DB/realtime §2.1): exact Origin + session-bound CSRF on
 * mutations, credentials from HttpOnly cookies, signed forwarding to the API,
 * and cookie directives applied server-side.
 */
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const config = bffConfig();
  const { path } = await context.params;
  if (path.some((segment) => segment === '..' || segment === '.' || segment.length === 0)) {
    return failure(400, 'VALIDATION_FAILED', 'Request is malformed.');
  }
  const joined = path.join('/');
  const apiPath = `/v1/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  const method = request.method.toUpperCase();
  const cookies = readCredentialCookies((name) => request.cookies.get(name)?.value);

  if (method !== 'GET' && method !== 'HEAD') {
    if (request.headers.get('origin') !== config.appOrigin) {
      return failure(403, 'ORIGIN_FORBIDDEN', 'Request origin not allowed.');
    }
    if (!csrfValid(cookies.csrfSecret, request.headers.get('x-csrf-token'))) {
      return failure(403, 'CSRF_INVALID', 'Your session security token expired. Retry.');
    }
  }

  const limit =
    joined === 'admin/catalog/imports'
      ? MAX_IMPORT_BODY
      : joined === 'admin/catalog/media'
        ? MAX_MEDIA_BODY
        : MAX_BODY;
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return failure(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  const body = method === 'GET' || method === 'HEAD' ? '' : await request.text();
  if (Buffer.byteLength(body) > limit)
    return failure(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');

  const admin = path[0] === 'admin';
  const clientIp = clientIpFrom((name) => request.headers.get(name));
  const pending: BffDirectives[] = [];
  let bearer = admin ? cookies.adminAccessToken : cookies.accessToken;
  const refreshCookie = admin ? cookies.adminRefreshToken : cookies.refreshToken;

  const isRefresh = joined === 'auth/refresh';
  if (bearer && refreshCookie && !isRefresh && tokenExpiresSoon(bearer)) {
    const refreshed = await callApi({
      method: 'POST',
      path: `/v1/auth/refresh?scope=${admin ? 'admin' : 'member'}`,
      clientIp,
      origin: config.appOrigin,
      refresh: refreshCookie,
    });
    if (refreshed.directives) pending.push(refreshed.directives);
    bearer =
      refreshed.directives?.setSession?.accessToken ??
      (refreshed.status === 200 ? bearer : undefined);
  }

  // Only a well-formed UUID is forwarded; anything else is dropped (the API then refuses).
  const idempotencyKey = request.headers.get('idempotency-key')?.toLowerCase();
  const forwardRefresh =
    isRefresh || (admin && joined.startsWith('admin/auth/mfa')) ? refreshCookie : undefined;
  const result = await callApi({
    method,
    path: apiPath,
    body,
    clientIp,
    origin: config.appOrigin,
    ...(bearer ? { bearer } : {}),
    ...(cookies.gate ? { gate: cookies.gate } : {}),
    ...(cookies.attempt ? { attempt: cookies.attempt } : {}),
    ...(forwardRefresh ? { refresh: forwardRefresh } : {}),
    ...(idempotencyKey && UUID.test(idempotencyKey) ? { idempotencyKey } : {}),
  });

  const response = new NextResponse(result.text, {
    status: result.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      ...(result.retryAfter ? { 'Retry-After': result.retryAfter } : {}),
    },
  });
  for (const directives of pending) applyDirectives(response, directives);
  applyDirectives(response, result.directives);
  return response;
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
