import { NextResponse, type NextRequest } from 'next/server';
import { callApi } from '@/lib/bff/api';
import { bffConfig } from '@/lib/bff/config';
import { cookieName, readCredentialCookies, tokenExpiresSoon } from '@/lib/bff/cookies';
import { applyDirectives } from '@/lib/bff/directives';
import { clientIpFrom } from '@/lib/bff/request-context';

const MEMBER_PREFIXES = [
  '/play',
  '/onboarding',
  '/players',
  '/friends',
  '/notifications',
  '/rooms',
];

function redirect(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname;
  url.pathname = pathname;
  url.search = '';
  if (next !== '/' && next.startsWith('/')) url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

/**
 * Navigation guard and token refresher. This is UX only: every protected
 * layout and every API call re-authorizes on the server (route guards are
 * not authorization).
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const cookies = readCredentialCookies((name) => request.cookies.get(name)?.value);
  const isAdmin = path.startsWith('/admin') && !path.startsWith('/admin/login');
  const isMember = MEMBER_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

  if (isAdmin && !cookies.adminAccessToken) return redirect(request, '/admin/login');
  if (isMember && !cookies.gate) return redirect(request, '/access');
  if (isMember && !cookies.accessToken) return redirect(request, '/auth');

  const token = isAdmin ? cookies.adminAccessToken : cookies.accessToken;
  const refresh = isAdmin ? cookies.adminRefreshToken : cookies.refreshToken;
  if ((isAdmin || isMember) && token && refresh && tokenExpiresSoon(token)) {
    const config = bffConfig();
    const result = await callApi({
      method: 'POST',
      path: `/v1/auth/refresh?scope=${isAdmin ? 'admin' : 'member'}`,
      clientIp: clientIpFrom((name) => request.headers.get(name)),
      origin: config.appOrigin,
      refresh,
    });
    const session = result.directives?.setSession;
    if (!session) {
      const response = redirect(request, isAdmin ? '/admin/login' : '/auth');
      applyDirectives(response, result.directives);
      return response;
    }
    // Forward the fresh token to this render and persist it for the browser.
    const atName = cookieName(isAdmin ? 'admin_at' : 'at');
    request.cookies.set(atName, session.accessToken);
    const headers = new Headers(request.headers);
    headers.set('cookie', request.cookies.toString());
    const response = NextResponse.next({ request: { headers } });
    applyDirectives(response, result.directives);
    return response;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|original-assets).*)'],
};
