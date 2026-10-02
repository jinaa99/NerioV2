import 'server-only';
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  createChapterInput, createSeriesInput, listSeriesInput, slug as slugSchema, updateSeriesInput,
  type CreateChapterInput, type CreateSeriesInput, type ListSeriesInput, type UpdateSeriesInput,
} from '@/lib/validation';
import { getCurrentActor, hasRole, requireRole, type Actor } from '../auth/actor';
import { db, type Executor } from '../db/client';
import { chapterPages, chapters, follows, genres, notifications, profiles, series, seriesGenres } from '../db/schema';
import { DalError, parseInput, rethrowUnique } from '../errors';
import { recordAudit } from './audit';

/* DTOs: the only shapes that leave the DAL. */

export type SeriesCardDTO = {
  id: string; slug: string; title: string; author: string; status: string; coverHue: number;
  rating: number; viewCount: number; followerCount: number; genres: string[]; updatedAt: Date;
};
export type SeriesDetailDTO = SeriesCardDTO & {
  altTitle: string | null; description: string; artist: string | null;
  chapters: { id: string; number: number; title: string | null; publishedAt: Date | null; locked: boolean }[];
};
export type ReaderChapterDTO = {
  id: string; seriesSlug: string; number: number; title: string | null; locked: boolean;
  prev: number | null; next: number | null;
  /** Empty when locked. Image URLs are resolved by the storage layer (not implemented yet). */
  pages: { id: string; pageNumber: number; width: number; height: number }[];
};

const isPublicSeries = and(isNull(series.deletedAt), sql`${series.status} <> 'draft'`);
const isPublishedChapter = and(eq(chapters.status, 'published'), lte(chapters.publishedAt, sql`now()`));

async function isPremium(actor: Actor | null): Promise<boolean> {
  if (!actor) return false;
  const [row] = await db().select({ until: profiles.premiumUntil }).from(profiles).where(eq(profiles.userId, actor.userId));
  return !!row?.until && row.until > new Date();
}

function chapterLocked(c: { access: string; freeAt: Date | null }, premium: boolean, staff: boolean) {
  if (staff || premium || c.access === 'free') return false;
  return !c.freeAt || c.freeAt > new Date();
}

async function genreNames(ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const rows = await db()
    .select({ seriesId: seriesGenres.seriesId, name: genres.name })
    .from(seriesGenres)
    .innerJoin(genres, eq(genres.id, seriesGenres.genreId))
    .where(inArray(seriesGenres.seriesId, ids))
    .orderBy(asc(seriesGenres.position));
  for (const r of rows) map.set(r.seriesId, [...(map.get(r.seriesId) ?? []), r.name]);
  return map;
}

const cardColumns = {
  id: series.id, slug: series.slug, title: series.title, author: series.author, status: series.status,
  coverHue: series.coverHue, rating: series.ratingAvg, viewCount: series.viewCount,
  followerCount: series.followerCount, updatedAt: series.updatedAt,
};

/* Public reads */

export async function listGenres() {
  return db().select({ slug: genres.slug, name: genres.name, hue: genres.hue }).from(genres).orderBy(asc(genres.name));
}

export async function listSeries(input: ListSeriesInput = {}): Promise<SeriesCardDTO[]> {
  const q = parseInput(listSeriesInput, input);
  const filters = [isPublicSeries];
  if (q.status) filters.push(eq(series.status, q.status));
  if (q.q) {
    const term = `%${q.q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
    filters.push(or(ilike(series.title, term), ilike(series.altTitle, term), ilike(series.author, term)));
  }
  if (q.genre) {
    filters.push(inArray(series.id, db()
      .select({ id: seriesGenres.seriesId }).from(seriesGenres)
      .innerJoin(genres, eq(genres.id, seriesGenres.genreId))
      .where(eq(genres.slug, q.genre))));
  }
  const order = q.sort === 'updated' ? desc(series.updatedAt) : q.sort === 'new' ? desc(series.publishedAt) : desc(series.viewCount);
  const rows = await db().select(cardColumns).from(series).where(and(...filters)).orderBy(order, asc(series.id)).limit(q.limit).offset(q.offset);
  const g = await genreNames(rows.map(r => r.id));
  return rows.map(r => ({ ...r, genres: g.get(r.id) ?? [] }));
}

export async function getSeriesBySlug(slugInput: string): Promise<SeriesDetailDTO | null> {
  const slug = parseInput(slugSchema, slugInput);
  const actor = await getCurrentActor();
  const staff = hasRole(actor, 'editor');
  const [row] = await db()
    .select({ ...cardColumns, altTitle: series.altTitle, description: series.description, artist: series.artist })
    .from(series)
    .where(and(eq(series.slug, slug), staff ? isNull(series.deletedAt) : isPublicSeries));
  if (!row) return null;
  const [chapterRows, g, premium] = await Promise.all([
    db().select({ id: chapters.id, number: chapters.number, title: chapters.title, publishedAt: chapters.publishedAt, access: chapters.access, freeAt: chapters.freeAt })
      .from(chapters).where(and(eq(chapters.seriesId, row.id), isPublishedChapter)).orderBy(asc(chapters.number)),
    genreNames([row.id]),
    isPremium(actor),
  ]);
  return {
    ...row,
    genres: g.get(row.id) ?? [],
    chapters: chapterRows.map(c => ({ id: c.id, number: c.number, title: c.title, publishedAt: c.publishedAt, locked: chapterLocked(c, premium, staff) })),
  };
}

export async function getChapterForReader(seriesSlug: string, number: number): Promise<ReaderChapterDTO | null> {
  const slug = parseInput(slugSchema, seriesSlug);
  const actor = await getCurrentActor();
  const staff = hasRole(actor, 'editor');
  const [row] = await db()
    .select({ id: chapters.id, seriesId: chapters.seriesId, number: chapters.number, title: chapters.title, access: chapters.access, freeAt: chapters.freeAt })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(eq(series.slug, slug), eq(chapters.number, number), staff ? isNull(series.deletedAt) : and(isPublicSeries, isPublishedChapter)));
  if (!row) return null;

  const locked = chapterLocked(row, await isPremium(actor), staff);
  const visible = and(eq(chapters.seriesId, row.seriesId), isPublishedChapter);
  const [[prev], [next], pages] = await Promise.all([
    db().select({ n: chapters.number }).from(chapters).where(and(visible, lt(chapters.number, row.number))).orderBy(desc(chapters.number)).limit(1),
    db().select({ n: chapters.number }).from(chapters).where(and(visible, gt(chapters.number, row.number))).orderBy(asc(chapters.number)).limit(1),
    locked ? Promise.resolve([]) : db()
      .select({ id: chapterPages.id, pageNumber: chapterPages.pageNumber, width: chapterPages.width, height: chapterPages.height })
      .from(chapterPages).where(eq(chapterPages.chapterId, row.id)).orderBy(asc(chapterPages.pageNumber)),
  ]);
  return { id: row.id, seriesSlug: slug, number: row.number, title: row.title, locked, prev: prev?.n ?? null, next: next?.n ?? null, pages };
}

/* Staff writes */

async function setSeriesGenres(tx: Executor, seriesId: string, genreSlugs: string[]) {
  await tx.delete(seriesGenres).where(eq(seriesGenres.seriesId, seriesId));
  if (genreSlugs.length === 0) return;
  const found = await tx.select({ id: genres.id, slug: genres.slug }).from(genres).where(inArray(genres.slug, genreSlugs));
  if (found.length !== new Set(genreSlugs).size) throw new DalError('INVALID_INPUT', 'Unknown genre.', { genreSlugs: ['Unknown genre'] });
  const bySlug = new Map(found.map(g => [g.slug, g.id]));
  await tx.insert(seriesGenres).values([...new Set(genreSlugs)].map((s, position) => ({ seriesId, genreId: bySlug.get(s)!, position })));
}

export async function createSeries(input: CreateSeriesInput) {
  const actor = await requireRole('editor');
  const { genreSlugs, ...data } = parseInput(createSeriesInput, input);
  try {
    return await db().transaction(async tx => {
      const [row] = await tx.insert(series).values({
        ...data,
        createdBy: actor.userId,
        publishedAt: data.status === 'draft' ? null : new Date(),
      }).returning({ id: series.id, slug: series.slug });
      await setSeriesGenres(tx, row.id, genreSlugs);
      await recordAudit(tx, actor, { action: 'series.create', targetType: 'series', targetId: row.id, metadata: { slug: row.slug } });
      return row;
    });
  } catch (err) {
    rethrowUnique(err, 'A series with that slug already exists.');
  }
}

export async function updateSeries(seriesId: string, input: UpdateSeriesInput) {
  const actor = await requireRole('editor');
  const { genreSlugs, ...data } = parseInput(updateSeriesInput, input);
  return db().transaction(async tx => {
    const [current] = await tx.select({ publishedAt: series.publishedAt }).from(series).where(and(eq(series.id, seriesId), isNull(series.deletedAt)));
    if (!current) throw new DalError('NOT_FOUND', 'Series not found.');
    const publishedAt = current.publishedAt ?? (data.status && data.status !== 'draft' ? new Date() : null);
    if (Object.keys(data).length) await tx.update(series).set({ ...data, publishedAt }).where(eq(series.id, seriesId));
    if (genreSlugs) await setSeriesGenres(tx, seriesId, genreSlugs);
    await recordAudit(tx, actor, { action: 'series.update', targetType: 'series', targetId: seriesId, metadata: { fields: Object.keys(input) } });
    return { id: seriesId };
  });
}

export async function createChapter(input: CreateChapterInput) {
  const actor = await requireRole('editor');
  const data = parseInput(createChapterInput, input);
  try {
    return await db().transaction(async tx => {
      const [exists] = await tx.select({ id: series.id }).from(series).where(and(eq(series.id, data.seriesId), isNull(series.deletedAt)));
      if (!exists) throw new DalError('NOT_FOUND', 'Series not found.');
      const [row] = await tx.insert(chapters).values({ ...data, createdBy: actor.userId }).returning({ id: chapters.id });
      await recordAudit(tx, actor, { action: 'chapter.create', targetType: 'chapter', targetId: row.id, metadata: { seriesId: data.seriesId, number: data.number } });
      return row;
    });
  } catch (err) {
    rethrowUnique(err, 'That chapter number already exists in this series.');
  }
}

/** Publish a `ready` chapter and notify followers with alerts on, atomically. */
export async function publishChapter(chapterId: string) {
  const actor = await requireRole('editor');
  return db().transaction(async tx => {
    const [ch] = await tx
      .update(chapters)
      .set({ status: 'published', publishedAt: new Date() })
      .where(and(eq(chapters.id, chapterId), eq(chapters.status, 'ready')))
      .returning({ id: chapters.id, seriesId: chapters.seriesId, number: chapters.number });
    if (!ch) throw new DalError('CONFLICT', 'Only chapters marked ready can be published.');

    const [s] = await tx.update(series).set({ updatedAt: new Date() }).where(eq(series.id, ch.seriesId)).returning({ slug: series.slug, title: series.title });
    const href = `/read/${s.slug}/${ch.number}`;
    // Set-based fan-out: one statement regardless of follower count.
    await tx.execute(sql`
      insert into ${notifications} (user_id, type, title, href, data)
      select f.user_id, 'new_chapter', ${`${s.title} · Chapter ${ch.number}`}, ${href}, ${JSON.stringify({ seriesId: ch.seriesId, chapterId: ch.id })}::jsonb
      from ${follows} f
      where f.series_id = ${ch.seriesId} and f.notify
    `);
    await recordAudit(tx, actor, { action: 'chapter.publish', targetType: 'chapter', targetId: ch.id });
    return { id: ch.id, href };
  });
}
