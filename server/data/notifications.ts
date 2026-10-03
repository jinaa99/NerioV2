import 'server-only';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { pagination, uuid, type Pagination } from '@/lib/validation';
import { z } from 'zod';
import { requireActor } from '../auth/actor';
import { db } from '../db/client';
import { notifications } from '../db/schema';
import { parseInput } from '../errors';

export type NotificationDTO = {
  id: string; type: 'new_chapter' | 'payment_confirmed' | 'payment_rejected' | 'report_update' | 'system';
  title: string; body: string | null; href: string | null; readAt: Date | null; createdAt: Date;
};

export async function listNotifications(input: Pagination & { unreadOnly?: boolean } = {}): Promise<{ items: NotificationDTO[]; total: number; unread: number; limit: number; offset: number }> {
  const actor = await requireActor();
  const { limit, offset, unreadOnly } = parseInput(pagination.extend({ unreadOnly: z.boolean().default(false) }), input);
  const where = and(eq(notifications.userId, actor.userId), unreadOnly ? isNull(notifications.readAt) : undefined);
  const [items, [{ total }], [{ unread }]] = await Promise.all([
    db()
      .select({ id: notifications.id, type: notifications.type, title: notifications.title, body: notifications.body, href: notifications.href, readAt: notifications.readAt, createdAt: notifications.createdAt })
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit)
      .offset(offset),
    db().select({ total: count() }).from(notifications).where(where),
    db().select({ unread: count() }).from(notifications).where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt))),
  ]);
  return { items, total, unread, limit, offset };
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
