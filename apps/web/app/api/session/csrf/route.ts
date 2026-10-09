import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_OPTIONS, cookieName } from '@/lib/bff/cookies';
import { csrfTokenFor, newCsrfSecret } from '@/lib/bff/csrf';

export const dynamic = 'force-dynamic';

/** Issue the session-bound CSRF token (creating the HttpOnly secret if absent). */
export async function GET(request: NextRequest) {
  const existing = request.cookies.get(cookieName('csrf'))?.value;
  const secret = existing ?? newCsrfSecret();
  const response = NextResponse.json(
    { token: csrfTokenFor(secret) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
  if (!existing)
    response.cookies.set(cookieName('csrf'), secret, { ...COOKIE_OPTIONS(), maxAge: 12 * 60 * 60 });
  return response;
}
