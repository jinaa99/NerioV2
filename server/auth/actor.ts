import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '../db/client';
import { roles, userRoles, users } from '../db/schema';
import { DalError } from '../errors';

export type RoleKey = (typeof roles.$inferSelect)['key'];

/** The authenticated caller. Built server-side only, never from client input. */
export type Actor = { userId: string; roles: ReadonlySet<RoleKey> };

/**
 * Resolve the current request's actor.
 * Authentication isn't implemented yet, so this always returns null and every protected
 * DAL call rejects with UNAUTHENTICATED. Wire the session lookup in here when auth lands
 * (read the session cookie, verify it, then call `loadActor(userId)`).
 */
export const getCurrentActor = cache(async (): Promise<Actor | null> => null);

/** Load an active user's roles. Suspended or deleted users resolve to null. */
export async function loadActor(userId: string): Promise<Actor | null> {
  const rows = await db()
    .select({ status: users.status, role: roles.key })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  if (rows.length === 0 || rows[0].status !== 'active') return null;
  return { userId, roles: new Set(rows.flatMap(r => (r.role ? [r.role] : []))) };
}

/** Role hierarchy: admin ⊇ editor ⊇ translator ⊇ reader. */
const RANK: Record<RoleKey, number> = { reader: 0, translator: 1, editor: 2, admin: 3 };

export function hasRole(actor: Actor | null, min: RoleKey): boolean {
  if (!actor) return false;
  for (const r of actor.roles) if (RANK[r] >= RANK[min]) return true;
  return false;
}

export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) throw new DalError('UNAUTHENTICATED', 'Sign in to continue.');
  return actor;
}

export async function requireRole(min: RoleKey): Promise<Actor> {
  const actor = await requireActor();
  if (!hasRole(actor, min)) throw new DalError('FORBIDDEN', 'You don’t have permission to do that.');
  return actor;
}
