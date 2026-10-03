/**
 * Session cookie settings, shared by the DAL and `proxy.ts`. No secrets here.
 * In production the `__Host-` prefix makes browsers reject the cookie unless it is Secure,
 * host-only and Path=/, so subdomains can't set or overwrite it.
 */
const production = process.env.NODE_ENV === 'production';

export const SESSION_COOKIE = production ? '__Host-nerio_session' : 'nerio_session';
/** Sessions last 30 days and slide forward while in use. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const sessionCookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: production,
  sameSite: 'lax' as const,
  path: '/',
  expires,
});
