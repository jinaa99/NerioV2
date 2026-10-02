import 'server-only';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { uuid } from '@/lib/validation';
import { requireActor } from '../auth/actor';
import { db } from '../db/client';
import { bookmarks, follows, series } from '../db/schema';
import { DalError, parseInput } from '../errors';

async function assertSeries(seriesId: string) {
  const id = parseInput(uuid, seriesId);
  const [row] = await db().select({ id: series.id }).from(series).where(and(eq(series.id, id), isNull(series.deletedAt)));
  if (!row) throw new DalError('NOT_FOUND', 'Series not found.');
  return id;
}

/* Bookmarks (library) */

export async function setBookmark(seriesId: string, on: boolean) {
  const actor = await requireActor();
  const id = await assertSeries(seriesId);
  if (on) await db().insert(bookmarks).values({ userId: actor.userId, seriesId: id }).onConflictDoNothing();
  else await db().delete(bookmarks).where(and(eq(bookmarks.userId, actor.userId), eq(bookmarks.seriesId, id)));
  return { seriesId: id, bookmarked: on };
}

export async function listBookmarks() {
  const actor = await requireActor();
  return db()
    .select({ seriesId: series.id, slug: series.slug, title: series.title, coverHue: series.coverHue, status: series.status, addedAt: bookmarks.createdAt })
    .from(bookmarks)
    .innerJoin(series, eq(series.id, bookmarks.seriesId))
    .where(and(eq(bookmarks.userId, actor.userId), isNull(series.deletedAt)))
    .orderBy(desc(bookmarks.createdAt));
}

/* Follows; keeps series.follower_count in step within the same transaction. */

export async function follow(seriesId: string, notify = true) {
  const actor = await requireActor();
  const id = await assertSeries(seriesId);
  await db().transaction(async tx => {
    const inserted = await tx.insert(follows).values({ userId: actor.userId, seriesId: id, notify })
      .onConflictDoUpdate({ target: [follows.userId, follows.seriesId], set: { notify } })
      .returning({ isNew: sql<boolean>`(xmax = 0)` });
    if (inserted[0]?.isNew) await tx.update(series).set({ followerCount: sql`${series.followerCount} + 1` }).where(eq(series.id, id));
  });
  return { seriesId: id, following: true, notify };
}

export async function unfollow(seriesId: string) {
  const actor = await requireActor();
  const id = parseInput(uuid, seriesId);
  await db().transaction(async tx => {
    const removed = await tx.delete(follows).where(and(eq(follows.userId, actor.userId), eq(follows.seriesId, id))).returning({ seriesId: follows.seriesId });
    if (removed.length) await tx.update(series).set({ followerCount: sql`greatest(${series.followerCount} - 1, 0)` }).where(eq(series.id, id));
  });
  return { seriesId: id, following: false };
}

export async function listFollows() {
  const actor = await requireActor();
  return db()
    .select({ seriesId: series.id, slug: series.slug, title: series.title, coverHue: series.coverHue, notify: follows.notify, since: follows.createdAt })
    .from(follows)
    .innerJoin(series, eq(series.id, follows.seriesId))
    .where(and(eq(follows.userId, actor.userId), isNull(series.deletedAt)))
    .orderBy(desc(follows.createdAt));
}
