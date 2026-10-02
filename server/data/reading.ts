import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { pagination, saveProgressInput, type Pagination, type SaveProgressInput } from '@/lib/validation';
import { requireActor } from '../auth/actor';
import { db } from '../db/client';
import { chapters, readingHistory, readingProgress, series } from '../db/schema';
import { DalError, parseInput } from '../errors';

/** Record the reader's position. Upserts both the per-series progress and the per-chapter history row. */
export async function saveProgress(input: SaveProgressInput) {
  const actor = await requireActor();
  const data = parseInput(saveProgressInput, input);
  const [ch] = await db()
    .select({ seriesId: chapters.seriesId })
    .from(chapters)
    .where(and(eq(chapters.id, data.chapterId), eq(chapters.status, 'published')));
  if (!ch) throw new DalError('NOT_FOUND', 'Chapter not found.');

  const now = new Date();
  await db().transaction(async tx => {
    await tx.insert(readingProgress)
      .values({ userId: actor.userId, seriesId: ch.seriesId, chapterId: data.chapterId, pageNumber: data.pageNumber, percent: data.percent })
      .onConflictDoUpdate({
        target: [readingProgress.userId, readingProgress.seriesId],
        set: { chapterId: data.chapterId, pageNumber: data.pageNumber, percent: data.percent, updatedAt: now },
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

export async function listContinueReading(input: Pagination = {}) {
  const actor = await requireActor();
  const { limit, offset } = parseInput(pagination, input);
  return db()
    .select({
      seriesSlug: series.slug, seriesTitle: series.title, coverHue: series.coverHue,
      chapterNumber: chapters.number, pageNumber: readingProgress.pageNumber, percent: readingProgress.percent,
      updatedAt: readingProgress.updatedAt,
    })
    .from(readingProgress)
    .innerJoin(series, eq(series.id, readingProgress.seriesId))
    .innerJoin(chapters, eq(chapters.id, readingProgress.chapterId))
    .where(eq(readingProgress.userId, actor.userId))
    .orderBy(desc(readingProgress.updatedAt))
    .limit(limit)
    .offset(offset);
}

export async function listReadingHistory(input: Pagination = {}) {
  const actor = await requireActor();
  const { limit, offset } = parseInput(pagination, input);
  return db()
    .select({
      seriesSlug: series.slug, seriesTitle: series.title, coverHue: series.coverHue,
      chapterNumber: chapters.number, chapterTitle: chapters.title,
      lastReadAt: readingHistory.lastReadAt, completed: readingHistory.completed,
    })
    .from(readingHistory)
    .innerJoin(series, eq(series.id, readingHistory.seriesId))
    .innerJoin(chapters, eq(chapters.id, readingHistory.chapterId))
    .where(eq(readingHistory.userId, actor.userId))
    .orderBy(desc(readingHistory.lastReadAt))
    .limit(limit)
    .offset(offset);
}

export async function clearReadingHistory() {
  const actor = await requireActor();
  await db().delete(readingHistory).where(eq(readingHistory.userId, actor.userId));
}
