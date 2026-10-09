import 'server-only';
import { bffConfig } from './config';

type Base = 'attempt' | 'gate' | 'at' | 'rt' | 'admin_at' | 'admin_rt' | 'csrf';

/** `__Host-` prefixed names on HTTPS (Secure, Path=/, no Domain); plain names on local http. */
export function cookieName(base: Base): string {
  return bffConfig().secureCookies ? `__Host-stumps_${base}` : `stumps_${base}`;
}

export interface CookieSpec {
  name: string;
  value: string;
  maxAge: number;
}

export const COOKIE_OPTIONS = () =>
  ({
    httpOnly: true,
    secure: bffConfig().secureCookies,
    sameSite: 'lax' as const,
    path: '/',
  }) as const;

export interface CredentialCookies {
  attempt?: string;
  gate?: string;
  accessToken?: string;
  refreshToken?: string;
  adminAccessToken?: string;
  adminRefreshToken?: string;
  csrfSecret?: string;
}

export function readCredentialCookies(
  get: (name: string) => string | undefined,
): CredentialCookies {
  const pick = (base: Base) => get(cookieName(base)) || undefined;
  const result: CredentialCookies = {};
  const entries: [keyof CredentialCookies, Base][] = [
    ['attempt', 'attempt'],
    ['gate', 'gate'],
    ['accessToken', 'at'],
    ['refreshToken', 'rt'],
    ['adminAccessToken', 'admin_at'],
    ['adminRefreshToken', 'admin_rt'],
    ['csrfSecret', 'csrf'],
  ];
  for (const [key, base] of entries) {
    const value = pick(base);
    if (value) result[key] = value;
  }
  return result;
}

/** Decode a JWT's exp without trusting it (only to decide when to refresh). */
export function tokenExpiresSoon(token: string | undefined, withinMs = 60_000): boolean {
  if (!token) return false;
  const payload = token.split('.')[1];
  if (!payload) return true;
  try {
    const exp = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number })
      .exp;
    return typeof exp !== 'number' || exp * 1000 - Date.now() < withinMs;
  } catch {
    return true;
  }
}
