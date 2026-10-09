import 'server-only';
import type { NextResponse } from 'next/server';
import type { BffDirectives } from './api';
import { COOKIE_OPTIONS, cookieName } from './cookies';
import { newCsrfSecret } from './csrf';

const DAY = 24 * 60 * 60;

function secondsUntil(iso: string, cap: number): number {
  return Math.max(0, Math.min(cap, Math.floor((Date.parse(iso) - Date.now()) / 1000)));
}

/** Translate API cookie directives into HttpOnly cookies; tokens never reach browser JS. */
export function applyDirectives(response: NextResponse, directives: BffDirectives | undefined) {
  if (!directives) return;
  const opts = COOKIE_OPTIONS();
  if (directives.setAttempt) {
    response.cookies.set(cookieName('attempt'), directives.setAttempt.token, {
      ...opts,
      maxAge: DAY,
    });
  }
  if (directives.setGate) {
    response.cookies.set(cookieName('gate'), directives.setGate.token, {
      ...opts,
      maxAge: secondsUntil(directives.setGate.expiresAt, 12 * 60 * 60),
    });
  }
  if (directives.clearGate) response.cookies.set(cookieName('gate'), '', { ...opts, maxAge: 0 });
  if (directives.clearSession === 'member') {
    response.cookies.set(cookieName('at'), '', { ...opts, maxAge: 0 });
    response.cookies.set(cookieName('rt'), '', { ...opts, maxAge: 0 });
  }
  if (directives.clearSession === 'admin') {
    response.cookies.set(cookieName('admin_at'), '', { ...opts, maxAge: 0 });
    response.cookies.set(cookieName('admin_rt'), '', { ...opts, maxAge: 0 });
  }
  if (directives.setSession) {
    const admin = directives.setSession.scope === 'admin';
    const lifetime = admin ? 8 * 60 * 60 : 12 * 60 * 60;
    response.cookies.set(cookieName(admin ? 'admin_at' : 'at'), directives.setSession.accessToken, {
      ...opts,
      maxAge: lifetime,
    });
    response.cookies.set(
      cookieName(admin ? 'admin_rt' : 'rt'),
      directives.setSession.refreshToken,
      {
        ...opts,
        maxAge: lifetime,
      },
    );
  }
  if (directives.rotateCsrf) {
    response.cookies.set(cookieName('csrf'), newCsrfSecret(), { ...opts, maxAge: 12 * 60 * 60 });
  }
}
