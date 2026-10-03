import 'server-only';
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { authRateLimits } from '../db/schema';

export type Limit = { key: string; max: number; windowMs: number };

/** Hash identifiers (emails) so the table never stores them in clear text. */
export const limitKey = (scope: string, value: string) =>
  `${scope}:${createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 40)}`;

/**
 * Count one attempt against each limit (atomic fixed window).
 * Returns the seconds to wait if any limit is exceeded, otherwise 0.
 */
export async function hitRateLimits(limits: Limit[]): Promise<number> {
  let retryAfter = 0;
  for (const { key, max, windowMs } of limits) {
    const [row] = await db().insert(authRateLimits)
      .values({ key, attempts: 1, resetAt: new Date(Date.now() + windowMs) })
      .onConflictDoUpdate({
        target: authRateLimits.key,
        set: {
          attempts: sql`case when ${authRateLimits.resetAt} <= now() then 1 else ${authRateLimits.attempts} + 1 end`,
          resetAt: sql`case when ${authRateLimits.resetAt} <= now() then excluded.reset_at else ${authRateLimits.resetAt} end`,
        },
      })
      .returning({ attempts: authRateLimits.attempts, resetAt: authRateLimits.resetAt });
    if (row.attempts > max) retryAfter = Math.max(retryAfter, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000));
  }
  return retryAfter;
}

export async function clearRateLimit(key: string) {
  await db().delete(authRateLimits).where(eq(authRateLimits.key, key));
}
