import 'server-only';
import { and, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { pagination, roleKey, updateProfileInput, uuid, type Pagination, type UpdateProfileInput } from '@/lib/validation';
import { z } from 'zod';
import { requireActor, requireRole, type RoleKey } from '../auth/actor';
import { db } from '../db/client';
import { outer } from '../db/sql';
import { profiles, roles, sessions, userRoles, users } from '../db/schema';
import { DalError, parseInput, rethrowUnique } from '../errors';
import { recordAudit } from './audit';

const profileColumns = {
  userId: profiles.userId, username: profiles.username, displayName: profiles.displayName, avatarUrl: profiles.avatarUrl,
  bio: profiles.bio, locale: profiles.locale, readerSettings: profiles.readerSettings,
  emailOnNewChapter: profiles.emailOnNewChapter, showActivity: profiles.showActivity, premiumUntil: profiles.premiumUntil,
};

/** The signed-in user's own profile. Includes their email; never use this DTO for other users. */
export async function getMyProfile() {
  const actor = await requireActor();
  const [row] = await db()
    .select({ ...profileColumns, email: users.email })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, actor.userId));
  if (!row) throw new DalError('NOT_FOUND', 'Profile not found.');
  return { ...row, roles: [...actor.roles] };
}

export async function updateMyProfile(input: UpdateProfileInput) {
  const actor = await requireActor();
  const data = parseInput(updateProfileInput, input);
  if (Object.keys(data).length === 0) return;
  // Always scoped to the caller: there is no user id parameter to tamper with.
  try {
    const { readerSettings, ...rest } = data;
    await db().update(profiles).set({
      ...rest,
      // Merge so saving one reader option doesn't drop the others.
      ...(readerSettings ? { readerSettings: sql`${profiles.readerSettings} || ${JSON.stringify(readerSettings)}::jsonb` } : {}),
    }).where(eq(profiles.userId, actor.userId));
  } catch (err) {
    rethrowUnique(err, 'That username is taken.');
  }
}

/** Public profile by username: no email, no premium state. */
export async function getPublicProfile(username: string) {
  const name = parseInput(z.string().trim().min(3).max(32), username);
  const [row] = await db()
    .select({ username: profiles.username, displayName: profiles.displayName, avatarUrl: profiles.avatarUrl, bio: profiles.bio })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(eq(sql`lower(${profiles.username})`, name.toLowerCase()), eq(users.status, 'active'), isNull(users.deletedAt)));
  return row ?? null;
}

/* Admin */

export type AdminUserDTO = {
  id: string; email: string; status: 'active' | 'suspended' | 'deleted'; createdAt: Date;
  username: string | null; displayName: string | null; premiumUntil: Date | null;
  roles: RoleKey[]; chaptersRead: number; lastActiveAt: Date | null; pendingPayments: number;
};

export const USER_FILTERS = ['all', 'staff', 'premium', 'suspended'] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

export async function listUsers(input: Pagination & { q?: string; filter?: UserFilter } = {}) {
  await requireRole('admin');
  const { limit, offset, q, filter } = parseInput(pagination.extend({ q: z.string().trim().max(100).optional(), filter: z.enum(USER_FILTERS).default('all') }), input);
  const term = q ? `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%` : undefined;
  const where = and(
    isNull(users.deletedAt),
    term ? or(ilike(users.email, term), ilike(profiles.username, term), ilike(profiles.displayName, term)) : undefined,
    filter === 'suspended' ? eq(users.status, 'suspended') : undefined,
    filter === 'premium' ? sql`${profiles.premiumUntil} > now()` : undefined,
    filter === 'staff' ? sql`exists (select 1 from ${userRoles} ur join ${roles} r on r.id = ur.role_id where ur.user_id = ${users.id} and r.key <> 'reader')` : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db()
      .select({
        id: users.id, email: users.email, status: users.status, createdAt: users.createdAt,
        username: profiles.username, displayName: profiles.displayName, premiumUntil: profiles.premiumUntil,
        roles: sql<RoleKey[]>`coalesce((select array_agg(r.key::text order by r.key) from ${userRoles} ur join ${roles} r on r.id = ur.role_id where ur.user_id = ${outer(users.id)}), '{}')`,
        chaptersRead: sql<number>`(select count(*)::int from reading_history h where h.user_id = ${outer(users.id)} and h.completed)`,
        lastActiveAt: sql<Date | null>`greatest((select max(s.last_used_at) from sessions s where s.user_id = ${outer(users.id)}), (select max(h.last_read_at) from reading_history h where h.user_id = ${outer(users.id)}))`.mapWith(users.createdAt),
        pendingPayments: sql<number>`(select count(*)::int from payment_records p where p.user_id = ${outer(users.id)} and p.status = 'pending')`,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset),
    db().select({ total: count() }).from(users).leftJoin(profiles, eq(profiles.userId, users.id)).where(where),
  ]);
  return { items: rows as AdminUserDTO[], total, limit, offset };
}

export async function setUserRole(userId: string, role: RoleKey, granted: boolean) {
  const actor = await requireRole('admin');
  const target = parseInput(uuid, userId);
  const key = parseInput(roleKey, role);
  const on = parseInput(z.boolean(), granted);
  if (key === 'reader') throw new DalError('INVALID_INPUT', 'Every account keeps the reader role.');
  if (target === actor.userId && key === 'admin' && !on) throw new DalError('FORBIDDEN', 'You can’t remove your own admin role.');

  await db().transaction(async tx => {
    const [r] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    if (!r) throw new DalError('NOT_FOUND', 'Role not found.');
    const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, target), isNull(users.deletedAt)));
    if (!u) throw new DalError('NOT_FOUND', 'User not found.');
    const changed = on
      ? await tx.insert(userRoles).values({ userId: target, roleId: r.id, grantedBy: actor.userId }).onConflictDoNothing().returning({ userId: userRoles.userId })
      : await tx.delete(userRoles).where(and(eq(userRoles.userId, target), eq(userRoles.roleId, r.id))).returning({ userId: userRoles.userId });
    if (changed.length) await recordAudit(tx, actor, { action: on ? 'user.role.grant' : 'user.role.revoke', targetType: 'user', targetId: target, metadata: { role: key } });
  });
}

/** Suspend (and sign out everywhere) or reactivate an account. */
export async function setUserStatus(userId: string, status: 'active' | 'suspended') {
  const actor = await requireRole('admin');
  const target = parseInput(uuid, userId);
  const next = parseInput(z.enum(['active', 'suspended']), status);
  if (target === actor.userId) throw new DalError('FORBIDDEN', 'You can’t change your own status.');
  await db().transaction(async tx => {
    const [row] = await tx.update(users).set({ status: next }).where(and(eq(users.id, target), isNull(users.deletedAt))).returning({ id: users.id });
    if (!row) throw new DalError('NOT_FOUND', 'User not found.');
    if (next === 'suspended') await tx.delete(sessions).where(eq(sessions.userId, target));
    await recordAudit(tx, actor, { action: `user.${next === 'active' ? 'reactivate' : 'suspend'}`, targetType: 'user', targetId: target });
  });
}
