import 'server-only';
import { cookies, headers } from 'next/headers';
import type { SessionProjection } from '@stumps/contracts';
import { callApi } from './api';
import { bffConfig } from './config';
import { readCredentialCookies } from './cookies';
import { clientIpFrom } from './request-context';

export type ServerResult<T> = { ok: true; data: T } | { ok: false; code: string; status: number };

/** Authorized GET from a Server Component (no cookie writes possible here). */
export async function serverGet<T>(
  path: string,
  scope: 'member' | 'admin' = 'member',
): Promise<ServerResult<T>> {
  const jar = await cookies();
  const hdrs = await headers();
  const creds = readCredentialCookies((name) => jar.get(name)?.value);
  const bearer = scope === 'admin' ? creds.adminAccessToken : creds.accessToken;
  const result = await callApi({
    method: 'GET',
    path,
    clientIp: clientIpFrom((name) => hdrs.get(name)),
    origin: bffConfig().appOrigin,
    ...(bearer ? { bearer } : {}),
    ...(creds.gate ? { gate: creds.gate } : {}),
  });
  try {
    const json = JSON.parse(result.text) as { ok: boolean; data?: T; error?: { code: string } };
    if (json.ok && json.data !== undefined) return { ok: true, data: json.data };
    return { ok: false, code: json.error?.code ?? 'INTERNAL', status: result.status };
  } catch {
    return { ok: false, code: 'SERVICE_UNAVAILABLE', status: 503 };
  }
}

export function getMemberSession() {
  return serverGet<SessionProjection>('/v1/me');
}
