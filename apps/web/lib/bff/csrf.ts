import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { bffConfig } from './config';

export function newCsrfSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Token = HMAC(CSRF_SIGNING_KEY, per-browser secret cookie). */
export function csrfTokenFor(secret: string): string {
  return createHmac('sha256', bffConfig().csrfKey).update(`csrf:${secret}`).digest('base64url');
}

export function csrfValid(secret: string | undefined, token: string | null): boolean {
  if (!secret || !token) return false;
  const expected = Buffer.from(csrfTokenFor(secret));
  const provided = Buffer.from(token);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
