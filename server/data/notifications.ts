import 'server-only';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { pagination, uuid, type Pagination } from '@/lib/validation';
import { z } from 'zod';
import { requireActor } from '../auth/actor';
import { db } from '../db/client';
import { notifications } from '../db/schema';
import { parseInput } from '../errors';

export async function listNotifications(input: Pagination & { unreadOnly?: boolean } = {}) {
  const actor = await requireActor();
  const { limit, offset, unreadOnly } = parseInput(pagination.extend({ unreadOnly: z.boolean().default(false) }), input);
  return db()
    .select({ id: notifications.id, type: notifications.type, title: notifications.title, body: notifications.body, href: notifications.href, readAt: notifications.readAt, createdAt: notifications.createdAt })
    .from(notifications)
    .where(and(eq(notifications.userId, actor.userId), unreadOnly ? isNull(notifications.readAt) : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function countUnreadNotifications() {
  const actor = await requireActor();
  const [row] = await db().select({ n: count() }).from(notifications).where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** Mark specific notifications read, or all of them when `ids` is omitted. Only ever touches the caller's rows. */
export async function markNotificationsRead(ids?: string[]) {
  const actor = await requireActor();
  const parsed = ids === undefined ? undefined : parseInput(z.array(uuid).max(200), ids);
  await db()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt), parsed ? inArray(notifications.id, parsed) : undefined));
}
