import 'server-only';
import { and, count, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { pagination, saveProgressInput, type Pagination, type SaveProgressInput } from '@/lib/validation';
import { requireActor } from '../auth/actor';
import { db } from '../db/client';
import { outer } from '../db/sql';
import { chapters, readingHistory, readingProgress, series } from '../db/schema';
import { DalError, parseInput } from '../errors';
import { imageSrc } from '../storage';

/** Record the reader's position. Upserts both the per-series progress and the per-chapter history row. */
export async function saveProgress(input: SaveProgressInput) {
  const actor = await requireActor();
  const data = parseInput(saveProgressInput, input);
  const [ch] = await db()
    .select({ seriesId: chapters.seriesId, pageCount: chapters.pageCount })
    .from(chapters)
    .where(and(eq(chapters.id, data.chapterId), eq(chapters.status, 'published'), lte(chapters.publishedAt, sql`now()`)));
  if (!ch) throw new DalError('NOT_FOUND', 'Chapter not found.');
  if (data.pageNumber > ch.pageCount) throw new DalError('INVALID_INPUT', 'Page number is outside this chapter.');

  const now = new Date();
  await db().transaction(async tx => {
    await tx.insert(readingProgress)
      .values({ userId: actor.userId, seriesId: ch.seriesId, chapterId: data.chapterId, pageNumber: data.pageNumber, pageOffset: data.pageOffset, percent: data.percent })
      .onConflictDoUpdate({
        target: [readingProgress.userId, readingProgress.seriesId],
        set: { chapterId: data.chapterId, pageNumber: data.pageNumber, pageOffset: data.pageOffset, percent: data.percent, updatedAt: now },
      });
    await tx.insert(readingHistory)
      .values({ userId: actor.userId, seriesId: ch.seriesId, chapterId: data.chapterId, completed: data.percent >= 95 })
      .onConflictDoUpdate({
        target: [readingHistory.userId, readingHistory.chapterId],
        // `completed` only ever flips to true.
        set: { lastReadAt: now, completed: sql`${readingHistory.completed} or excluded.completed` },
      });
  });
}

export type ContinueReadingDTO = {
  seriesSlug: string; seriesTitle: string; coverHue: number; coverUrl: string | null;
  chapterNumber: number; chapterTitle: string | null; percent: number; updatedAt: Date;
  /** Set when the saved chapter is finished: the chapter to open next. */
  nextChapter: number | null;
  latestChapter: number | null;
};

/** Series in progress, most recent first. Finished series with nothing newer to read are left out. */
export async function listContinueReading(input: Pagination = {}): Promise<{ items: ContinueReadingDTO[]; total: number; limit: number; offset: number }> {
  const actor = await requireActor();
  const q = parseInput(pagination, input);
  const visible = sql`c.series_id = ${outer(readingProgress.seriesId)} and c.status = 'published' and c.published_at <= now()`;
  const next = sql<number | null>`(select min(c.number)::float8 from ${chapters} c where ${visible} and c.number > ${outer(chapters.number)})`;
  const where = and(
    eq(readingProgress.userId, actor.userId),
    isNull(series.deletedAt),
    sql`${series.status} <> 'draft'`,
    sql`not (${readingProgress.percent} >= 95 and ${next} is null)`,
  );
  const [rows, [{ total }]] = await Promise.all([
    db().select({
      seriesSlug: series.slug, seriesTitle: series.title, coverHue: series.coverHue, coverKey: series.coverKey,
      chapterNumber: chapters.number, chapterTitle: chapters.title, percent: readingProgress.percent, updatedAt: readingProgress.updatedAt,
      next, latestChapter: sql<number | null>`(select max(c.number)::float8 from ${chapters} c where ${visible})`,
    })
      .from(readingProgress)
      .innerJoin(series, eq(series.id, readingProgress.seriesId))
      .innerJoin(chapters, eq(chapters.id, readingProgress.chapterId))
      .where(where)
      .orderBy(desc(readingProgress.updatedAt))
      .limit(q.limit)
      .offset(q.offset),
    db().select({ total: count() }).from(readingProgress)
      .innerJoin(series, eq(series.id, readingProgress.seriesId))
      .innerJoin(chapters, eq(chapters.id, readingProgress.chapterId))
      .where(where),
  ]);
  return {
    items: rows.map(({ coverKey, next: n, ...r }) => ({ ...r, coverUrl: imageSrc(coverKey), nextChapter: r.percent >= 95 ? n : null })),
    total, ...q,
  };
}

export type HistoryItemDTO = {
  seriesSlug: string; seriesTitle: string; coverHue: number; coverUrl: string | null;
  chapterNumber: number; chapterTitle: string | null; lastReadAt: Date; completed: boolean;
};

export async function listReadingHistory(input: Pagination = {}): Promise<{ items: HistoryItemDTO[]; total: number; limit: number; offset: number }> {
  const actor = await requireActor();
  const q = parseInput(pagination, input);
  const where = and(eq(readingHistory.userId, actor.userId), isNull(series.deletedAt));
  const [rows, [{ total }]] = await Promise.all([
    db().select({
      seriesSlug: series.slug, seriesTitle: series.title, coverHue: series.coverHue, coverKey: series.coverKey,
      chapterNumber: chapters.number, chapterTitle: chapters.title,
      lastReadAt: readingHistory.lastReadAt, completed: readingHistory.completed,
    })
      .from(readingHistory)
      .innerJoin(series, eq(series.id, readingHistory.seriesId))
      .innerJoin(chapters, eq(chapters.id, readingHistory.chapterId))
      .where(where)
      .orderBy(desc(readingHistory.lastReadAt), desc(readingHistory.id))
      .limit(q.limit)
      .offset(q.offset),
    db().select({ total: count() }).from(readingHistory).innerJoin(series, eq(series.id, readingHistory.seriesId)).where(where),
  ]);
  return { items: rows.map(({ coverKey, ...r }) => ({ ...r, coverUrl: imageSrc(coverKey) })), total, ...q };
}

/** Clears the history list. Saved positions ("Continue reading") are kept. */
export async function clearReadingHistory() {
  const actor = await requireActor();
  await db().delete(readingHistory).where(eq(readingHistory.userId, actor.userId));
}
