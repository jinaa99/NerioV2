import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, ne } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';
import { SESSION_COOKIE, SESSION_TTL_MS, sessionCookieOptions } from './cookie';
import { requestMeta } from './request';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** Tokens are 43 base64url chars (256 bits); anything else is rejected before touching the DB. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Create a session and set the cookie. Call only from a Server Action or Route Handler. */
export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const { ipAddress, userAgent } = await requestMeta();
  await db().insert(sessions).values({ id: hashToken(token), userId, expiresAt, ipAddress, userAgent });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

/**
 * Resolve the request's session to an active user id, or null.
 * Slides expiry forward once less than half the TTL remains, so active readers stay signed in.
 */
export async function validateSessionCookie(): Promise<{ userId: string; sessionId: string } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !TOKEN_RE.test(token)) return null;
  const id = hashToken(token);
  const [row] = await db()
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()), eq(users.status, 'active'), isNull(users.deletedAt)));
  if (!row) return null;

  const now = Date.now();
  if (row.expiresAt.getTime() - now < SESSION_TTL_MS / 2) {
    await db().update(sessions).set({ expiresAt: new Date(now + SESSION_TTL_MS), lastUsedAt: new Date(now) }).where(eq(sessions.id, id));
  }
  return { userId: row.userId, sessionId: id };
}

/** End the current session (server row and cookie). */
export async function destroyCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token && TOKEN_RE.test(token)) await db().delete(sessions).where(eq(sessions.id, hashToken(token)));
  // Overwrite with identical attributes: a bare delete omits Secure, which browsers reject for __Host- cookies.
  store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
}

/** End every session for a user, optionally keeping one (e.g. the current device). */
export async function destroyUserSessions(userId: string, keepSessionId?: string) {
  const where = keepSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))
    : eq(sessions.userId, userId);
  const removed = await db().delete(sessions).where(where).returning({ id: sessions.id });
  return removed.length;
}

/** Housekeeping: remove expired rows. Safe to run from a cron job. */
export async function purgeExpiredSessions() {
  await db().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
