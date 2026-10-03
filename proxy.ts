import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, SESSION_TTL_MS, sessionCookieOptions } from '@/server/auth/cookie';

/**
 * Optimistic auth checks only: no database access here (Proxy runs on every request, prefetches included).
 * Real authorization happens in the page guards and the data access layer.
 *
 * - Signed-out visitors to protected areas are redirected to /login without rendering anything.
 * - On full page loads, the session cookie's expiry is pushed forward so it tracks the sliding
 *   server-side session (an invalid token stays invalid; the server ignores it).
 */
const PROTECTED = ['/profile', '/admin'];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!token && PROTECTED.some(p => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  if (token && request.method === 'GET' && request.headers.get('sec-fetch-dest') === 'document') {
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(new Date(Date.now() + SESSION_TTL_MS)));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
