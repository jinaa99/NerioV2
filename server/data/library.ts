import 'server-only';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { pagination, slug as slugSchema, type Pagination } from '@/lib/validation';
import { z } from 'zod';
import { requireActor } from '../auth/actor';
import { db } from '../db/client';
import { outer } from '../db/sql';
import { bookmarks, chapters, follows, profiles, readingHistory, readingProgress, series, seriesGenres } from '../db/schema';
import { DalError, parseInput } from '../errors';
import { imageSrc } from '../storage';

/*
 * The signed-in user's library. Every function scopes to `requireActor().userId`; none takes a
 * user id, so one user can never read or change another's rows. Series are identified by their
 * public slug and must be visible (not deleted, not draft).
 */

export type Paged<T> = { items: T[]; total: number; limit: number; offset: number };
type SeriesRef = { slug: string; title: string; coverHue: number; coverUrl: string | null };

const visibleSeries = and(isNull(series.deletedAt), sql`${series.status} <> 'draft'`);
const visibleIn = (seriesCol: typeof series.id) => sql`c.series_id = ${outer(seriesCol)} and c.status = 'published' and c.published_at <= now()`;
const latestChapter = sql<number | null>`(select max(c.number)::float8 from ${chapters} c where ${visibleIn(series.id)})`;
const seriesRef = { slug: series.slug, title: series.title, coverHue: series.coverHue, coverKey: series.coverKey };
const toRef = <T extends { coverKey: string | null }>({ coverKey, ...r }: T) => ({ ...r, coverUrl: imageSrc(coverKey) });

async function seriesIdBySlug(slugInput: string): Promise<string> {
  const slug = parseInput(slugSchema, slugInput);
  const [row] = await db().select({ id: series.id }).from(series).where(and(eq(series.slug, slug), visibleSeries));
  if (!row) throw new DalError('NOT_FOUND', 'Series not found.');
  return row.id;
}

/* Summary for the profile header and achievements */

export type LibrarySummaryDTO = {
  chaptersRead: number; chaptersOpened: number; seriesStarted: number; genresRead: number;
  bookmarks: number; following: number; unreadNotifications: number;
};

export async function getLibrarySummary(): Promise<LibrarySummaryDTO> {
  const { userId } = await requireActor();
  // One round trip; each subquery hits a (user_id, …) index.
  const [row] = await db().execute<{ [K in keyof LibrarySummaryDTO]: number }>(sql`
    select
      (select count(*)::int from reading_history where user_id = ${userId} and completed) as "chaptersRead",
      (select count(*)::int from reading_history where user_id = ${userId}) as "chaptersOpened",
      (select count(distinct series_id)::int from reading_history where user_id = ${userId}) as "seriesStarted",
      (select count(distinct sg.genre_id)::int from reading_history h join ${seriesGenres} sg on sg.series_id = h.series_id where h.user_id = ${userId}) as "genresRead",
      (select count(*)::int from bookmarks b join series s on s.id = b.series_id where b.user_id = ${userId} and s.deleted_at is null and s.status <> 'draft') as "bookmarks",
      (select count(*)::int from follows f join series s on s.id = f.series_id where f.user_id = ${userId} and s.deleted_at is null and s.status <> 'draft') as "following",
      (select count(*)::int from notifications where user_id = ${userId} and read_at is null) as "unreadNotifications"
  `);
  return row;
}

/** When chapters were last read during the past week, for the activity chart (binned client-side in the reader's timezone). */
export async function listRecentReadTimes(): Promise<Date[]> {
  const { userId } = await requireActor();
  const rows = await db().select({ at: readingHistory.lastReadAt }).from(readingHistory)
    .where(and(eq(readingHistory.userId, userId), sql`${readingHistory.lastReadAt} > now() - interval '8 days'`))
    .orderBy(desc(readingHistory.lastReadAt)).limit(1000);
  return rows.map(r => r.at);
}

/* Bookmarks */

export type BookmarkDTO = SeriesRef & { addedAt: Date; latestChapter: number | null; progressChapter: number | null };

export async function listMyBookmarks(input: Pagination = {}): Promise<Paged<BookmarkDTO>> {
  const { userId } = await requireActor();
  const q = parseInput(pagination, input);
  const where = and(eq(bookmarks.userId, userId), visibleSeries);
  const [rows, [{ total }]] = await Promise.all([
    db().select({
      ...seriesRef, addedAt: bookmarks.createdAt, latestChapter,
      progressChapter: sql<number | null>`(select c.number::float8 from ${readingProgress} rp join ${chapters} c on c.id = rp.chapter_id where rp.user_id = ${userId} and rp.series_id = ${outer(series.id)})`,
    }).from(bookmarks).innerJoin(series, eq(series.id, bookmarks.seriesId)).where(where)
      .orderBy(desc(bookmarks.createdAt)).limit(q.limit).offset(q.offset),
    db().select({ total: count() }).from(bookmarks).innerJoin(series, eq(series.id, bookmarks.seriesId)).where(where),
  ]);
  return { items: rows.map(toRef), total, ...q };
}

/** Slugs of every bookmarked series, so bookmark buttons across the site render the right state. */
export async function listMyBookmarkedSlugs(): Promise<string[]> {
  const { userId } = await requireActor();
  const rows = await db().select({ slug: series.slug }).from(bookmarks).innerJoin(series, eq(series.id, bookmarks.seriesId))
    .where(and(eq(bookmarks.userId, userId), visibleSeries)).orderBy(desc(bookmarks.createdAt)).limit(2000);
  return rows.map(r => r.slug);
}

export async function setBookmark(seriesSlug: string, on: boolean) {
  const { userId } = await requireActor();
  const seriesId = await seriesIdBySlug(seriesSlug);
  if (on) await db().insert(bookmarks).values({ userId, seriesId }).onConflictDoNothing();
  else await db().delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.seriesId, seriesId)));
  return { bookmarked: on };
}

/* Follows; series.follower_count is kept in step inside the same transaction */

export type FollowDTO = SeriesRef & { notify: boolean; since: Date; latestChapter: number | null; latestChapterAt: Date | null };

export async function listMyFollows(input: Pagination = {}): Promise<Paged<FollowDTO>> {
  const { userId } = await requireActor();
  const q = parseInput(pagination, input);
  const where = and(eq(follows.userId, userId), visibleSeries);
  const lastAt = sql<Date | null>`(select max(c.published_at) from ${chapters} c where ${visibleIn(series.id)})`.mapWith(series.publishedAt);
  const [rows, [{ total }]] = await Promise.all([
    db().select({ ...seriesRef, notify: follows.notify, since: follows.createdAt, latestChapter, latestChapterAt: lastAt })
      .from(follows).innerJoin(series, eq(series.id, follows.seriesId)).where(where)
      .orderBy(sql`${lastAt} desc nulls last`, desc(follows.createdAt)).limit(q.limit).offset(q.offset),
    db().select({ total: count() }).from(follows).innerJoin(series, eq(series.id, follows.seriesId)).where(where),
  ]);
  return { items: rows.map(toRef), total, ...q };
}

/** Follow (or update alert setting). Idempotent. */
export async function follow(seriesSlug: string, notify = true) {
  const { userId } = await requireActor();
  const seriesId = await seriesIdBySlug(seriesSlug);
  const n = parseInput(z.boolean(), notify);
  await db().transaction(async tx => {
    const inserted = await tx.insert(follows).values({ userId, seriesId, notify: n })
      .onConflictDoUpdate({ target: [follows.userId, follows.seriesId], set: { notify: n } })
      .returning({ isNew: sql<boolean>`(xmax = 0)` });
    if (inserted[0]?.isNew) await tx.update(series).set({ followerCount: sql`${series.followerCount} + 1` }).where(eq(series.id, seriesId));
  });
  return { following: true, notify: n };
}

export async function unfollow(seriesSlug: string) {
  const { userId } = await requireActor();
  const seriesId = await seriesIdBySlug(seriesSlug);
  await db().transaction(async tx => {
    const removed = await tx.delete(follows).where(and(eq(follows.userId, userId), eq(follows.seriesId, seriesId))).returning({ seriesId: follows.seriesId });
    if (removed.length) await tx.update(series).set({ followerCount: sql`greatest(${series.followerCount} - 1, 0)` }).where(eq(series.id, seriesId));
  });
  return { following: false, notify: false };
}

/** Bookmark/follow state of one series for the signed-in user (null when signed out is handled by the caller). */
export async function getMySeriesState(seriesId: string) {
  const { userId } = await requireActor();
  const [row] = await db().select({
    bookmarked: sql<boolean>`exists(select 1 from ${bookmarks} b where b.user_id = ${userId} and b.series_id = ${seriesId})`,
    notify: sql<boolean | null>`(select f.notify from ${follows} f where f.user_id = ${userId} and f.series_id = ${seriesId})`,
  }).from(profiles).where(eq(profiles.userId, userId));
  return { bookmarked: !!row?.bookmarked, following: row?.notify !== null && row?.notify !== undefined, notify: !!row?.notify };
}
