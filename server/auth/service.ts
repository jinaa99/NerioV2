import 'server-only';
/**
 * Account operations behind the auth forms: register, log in, log out.
 * Callers are Server Actions; these set and clear cookies, so they can't run during render.
 */
import { eq, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { loginInput, registerInput, type LoginInput, type RegisterInput } from '@/lib/validation';
import { db } from '../db/client';
import { profiles, roles, userRoles, users } from '../db/schema';
import { DalError, parseInput, uniqueViolation } from '../errors';
import { SESSION_COOKIE } from './cookie';
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from './password';
import { clearRateLimit, hitRateLimits, limitKey } from './rate-limit';
import { requestMeta } from './request';
import { createSession, destroyCurrentSession } from './session';

const MINUTE = 60_000;
const tooMany = (seconds: number) =>
  new DalError('FORBIDDEN', `Too many attempts. Try again in ${Math.max(1, Math.ceil(seconds / 60))} min.`);

/** Replace any existing session on this device, so a pre-set cookie can't survive login (session fixation). */
export async function startFreshSession(userId: string) {
  if ((await cookies()).get(SESSION_COOKIE)) await destroyCurrentSession();
  await createSession(userId);
}

/** Create an account with the `reader` role and sign it in. */
export async function register(input: RegisterInput): Promise<{ userId: string }> {
  const data = parseInput(registerInput, input);
  const { ipAddress } = await requestMeta();
  // Without a trusted client IP there is nothing per-client to limit on; a shared "unknown" bucket would lock everyone out.
  const wait = ipAddress ? await hitRateLimits([{ key: limitKey('register:ip', ipAddress), max: 10, windowMs: 60 * MINUTE }]) : 0;
  if (wait) throw tooMany(wait);

  const passwordHash = await hashPassword(data.password);
  let userId: string;
  try {
    userId = await db().transaction(async tx => {
      const [user] = await tx.insert(users).values({ email: data.email, passwordHash }).returning({ id: users.id });
      await tx.insert(profiles).values({ userId: user.id, username: data.username, displayName: data.displayName });
      // Role comes from the server; registration can never grant more than `reader`.
      const [reader] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, 'reader'));
      if (!reader) throw new Error('Role "reader" is missing. Run the database migrations.');
      await tx.insert(userRoles).values({ userId: user.id, roleId: reader.id });
      return user.id;
    });
  } catch (err) {
    const constraint = uniqueViolation(err);
    if (constraint?.includes('username')) throw new DalError('CONFLICT', 'That username is taken.', { username: ['That username is taken'] });
    if (constraint !== null) throw new DalError('CONFLICT', 'An account with this email already exists.', { email: ['An account with this email already exists'] });
    throw err;
  }
  await startFreshSession(userId);
  return { userId };
}

const INVALID_LOGIN = 'Email or password is incorrect.';

export async function login(input: LoginInput): Promise<{ userId: string }> {
  const data = parseInput(loginInput, input);
  const { ipAddress } = await requestMeta();
  const emailKey = limitKey('login:email', data.email);
  const wait = await hitRateLimits([
    { key: emailKey, max: 10, windowMs: 15 * MINUTE },
    ...(ipAddress ? [{ key: limitKey('login:ip', ipAddress), max: 50, windowMs: 15 * MINUTE }] : []),
  ]);
  if (wait) throw tooMany(wait);

  const [user] = await db()
    .select({ id: users.id, passwordHash: users.passwordHash, status: users.status, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(sql`lower(${users.email})`, data.email));

  if (!user?.passwordHash) {
    await burnPasswordCheck(data.password);
    throw new DalError('UNAUTHENTICATED', INVALID_LOGIN);
  }
  if (!(await verifyPassword(user.passwordHash, data.password))) throw new DalError('UNAUTHENTICATED', INVALID_LOGIN);
  // Only reveal account state after the password checks out.
  if (user.status !== 'active' || user.deletedAt) throw new DalError('FORBIDDEN', 'This account is suspended. Contact support.');

  await clearRateLimit(emailKey);
  const updates: Partial<typeof users.$inferInsert> = { lastSeenAt: new Date() };
  if (needsRehash(user.passwordHash)) updates.passwordHash = await hashPassword(data.password);
  await db().update(users).set(updates).where(eq(users.id, user.id));
  await startFreshSession(user.id);
  return { userId: user.id };
}

export async function logout() {
  await destroyCurrentSession();
}
