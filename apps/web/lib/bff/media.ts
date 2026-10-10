import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { callApi } from './api';
import { bffConfig } from './config';
import { readCredentialCookies } from './cookies';
import { clientIpFrom } from './request-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WIDTHS = new Set(['320', '640', '960']);

/**
 * Same-origin image proxy: player portraits live in private storage and are
 * only served to an authenticated, gated session (members) or an admin
 * session (previews). The browser never sees storage URLs or credentials.
 */
export async function proxyPortrait(
  request: NextRequest,
  params: { assetId: string; width: string },
  scope: 'member' | 'admin',
) {
  if (!UUID.test(params.assetId) || !WIDTHS.has(params.width)) {
    return new NextResponse(null, { status: 404 });
  }
  const cookies = readCredentialCookies((name) => request.cookies.get(name)?.value);
  const bearer = scope === 'admin' ? cookies.adminAccessToken : cookies.accessToken;
  if (!bearer) return new NextResponse(null, { status: 401 });
  const prefix = scope === 'admin' ? '/v1/admin/catalog/media' : '/v1/media';
  const result = await callApi({
    method: 'GET',
    path: `${prefix}/${params.assetId}/${params.width}`,
    clientIp: clientIpFrom((name) => request.headers.get(name)),
    origin: bffConfig().appOrigin,
    bearer,
    ...(cookies.gate ? { gate: cookies.gate } : {}),
    binary: true,
  });
  if (!result.bytes)
    return new NextResponse(null, { status: result.status === 200 ? 502 : result.status });
  return new NextResponse(result.bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': scope === 'admin' ? 'private, no-store' : 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
