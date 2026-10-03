import 'server-only';
import { eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { db } from '../db/client';
import { profiles } from '../db/schema';
import { getCurrentActor, hasRole, type Actor } from './actor';

/** What the UI may know about the signed-in user. Safe to pass to Client Components. */
export type ViewerDTO = {
  displayName: string;
  username: string;
  initials: string;
  premium: boolean;
  isAdmin: boolean;
  memberSince: string;
};

const initialsOf = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(w => [...w][0]?.toUpperCase() ?? '').join('') || '?';

export const getViewer = cache(async (): Promise<ViewerDTO | null> => {
  const actor = await getCurrentActor();
  if (!actor) return null;
  const [p] = await db()
    .select({ displayName: profiles.displayName, username: profiles.username, premiumUntil: profiles.premiumUntil, createdAt: profiles.createdAt })
    .from(profiles)
    .where(eq(profiles.userId, actor.userId));
  if (!p) return null;
  return {
    displayName: p.displayName,
    username: p.username,
    initials: initialsOf(p.displayName),
    premium: !!p.premiumUntil && p.premiumUntil > new Date(),
    isAdmin: hasRole(actor, 'admin'),
    memberSince: p.createdAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase(),
  };
});

/** Page guard: signed-in users only. Others go to /login and come back afterwards. */
export async function requireUserPage(returnTo: string): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return actor;
}

/**
 * Page guard for /admin. Signed-out users are sent to log in; signed-in non-admins get a 404
 * so the admin area's existence isn't confirmed to them.
 */
export async function requireAdminPage(returnTo = '/admin'): Promise<Actor> {
  const actor = await requireUserPage(returnTo);
  if (!hasRole(actor, 'admin')) notFound();
  return actor;
}
