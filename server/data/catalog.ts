import 'server-only';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, lte, max, or, sql, type SQL } from 'drizzle-orm';
import {
  addPagesInput, adminListChaptersInput, uploadChapterInput, type UploadChapterInput, adminListSeriesInput, createChapterInput, createSeriesInput, listSeriesInput,
  publicChaptersInput, reorderPagesInput, slug as slugSchema, toSlug, updateChapterInput, updateSeriesInput, uuid,
  type AddPagesInput, type AdminListChaptersInput, type AdminListSeriesInput, type CreateChapterInput, type CreateSeriesInput,
  type ListSeriesInput, type PublicChaptersInput, type ReorderPagesInput, type UpdateChapterInput, type UpdateSeriesInput,
} from '@/lib/validation';
import type { ChapterStatus, SeriesStatus } from '@/lib/catalog';
import { getCurrentActor, hasRole, requireRole, type Actor } from '../auth/actor';
import { db, type Executor } from '../db/client';
import { outer } from '../db/sql';
import {
  chapterPages, chapters, follows, genres, notifications, profiles, readingProgress, series, seriesGenres, seriesTags, tags, translationJobLogs, translationJobs,
} from '../db/schema';
import { DalError, parseInput, rethrowUnique } from '../errors';
import { imageSrc } from '../storage';
import { recordAudit } from './audit';
import { getSettings } from './settings';

/* DTOs: the only shapes that leave the DAL. */

export type Paged<T> = { items: T[]; total: number; limit: number; offset: number };
export type LabelDTO = { slug: string; name: string };

export type SeriesCardDTO = {
  id: string; slug: string; title: string; author: string; status: SeriesStatus; description: string;
  coverHue: number; coverUrl: string | null;
  rating: number; ratingCount: number; viewCount: number; followerCount: number;
  genres: LabelDTO[];
  /** Visible (published, released) chapters only. */
  chapterCount: number; firstChapter: number | null; latestChapter: number | null; latestChapterAt: Date | null;
  publishedAt: Date | null;
};
export type ChapterListItemDTO = {
  id: string; number: number; title: string | null; publishedAt: Date | null;
  /** Early access and not yet free for everyone. */
  early: boolean; freeAt: Date | null;
  /** Early for this viewer (no Premium). */
  locked: boolean;
};
export type SeriesDetailDTO = SeriesCardDTO & {
  altTitles: string[]; artist: string | null; sourceLanguage: string; tags: LabelDTO[];
  /** Newest chapter this viewer can read. */
  latestFree: { number: number; title: string | null } | null;
  earlyCount: number;
  progress: { chapterNumber: number; percent: number } | null;
  premium: boolean;
  chapters: Paged<ChapterListItemDTO>;
};
export type ReaderChapterDTO = {
  id: string; number: number; title: string | null; locked: boolean; freeAt: Date | null;
  series: { id: string; slug: string; title: string; coverHue: number };
  prev: number | null; next: number | null; nextLocked: boolean;
  /** Empty when locked. `src` is null for pages whose image isn't reachable yet. */
  pages: { id: string; pageNumber: number; width: number; height: number; src: string | null }[];
  /** Light list for the chapter drawer. */
  toc: { number: number; title: string | null; locked: boolean }[];
  /** Where the signed-in reader left off in this chapter. */
  resume: { pageNumber: number; pageOffset: number } | null;
  /** First page images of the next chapter, preloaded near the end. Empty when locked or absent. */
  nextPreload: string[];
};

/* Shared query pieces */

const isPublicSeries = and(isNull(series.deletedAt), sql`${series.status} <> 'draft'`);
const isPublishedChapter = and(eq(chapters.status, 'published'), lte(chapters.publishedAt, sql`now()`));
const escapeLike = (s: string) => `%${s.replace(/[\\%_]/g, c => `\\${c}`)}%`;

// Correlated subqueries over visible chapters; served by chapters_series_number_uq / chapters_series_published_idx.
const visibleIn = sql`c.series_id = ${outer(series.id)} and c.status = 'published' and c.published_at <= now()`;
const chapterStats = {
  chapterCount: sql<number>`(select count(*)::int from ${chapters} c where ${visibleIn})`,
  firstChapter: sql<number | null>`(select min(c.number)::float8 from ${chapters} c where ${visibleIn})`,
  latestChapter: sql<number | null>`(select max(c.number)::float8 from ${chapters} c where ${visibleIn})`,
  latestChapterAt: sql<Date | null>`(select max(c.published_at) from ${chapters} c where ${visibleIn})`.mapWith(series.publishedAt),
};

const cardColumns = {
  id: series.id, slug: series.slug, title: series.title, author: series.author, status: series.status,
  description: series.description, coverHue: series.coverHue, coverKey: series.coverKey,
  rating: series.ratingAvg, ratingCount: series.ratingCount, viewCount: series.viewCount,
  followerCount: series.followerCount, publishedAt: series.publishedAt, ...chapterStats,
};
type CardRow = { [K in keyof typeof cardColumns]: unknown } & {
  id: string; coverKey: string | null; chapterCount: number; firstChapter: number | null; latestChapter: number | null;
};

async function isPremium(actor: Actor | null): Promise<boolean> {
  if (!actor) return false;
  const [row] = await db().select({ until: profiles.premiumUntil }).from(profiles).where(eq(profiles.userId, actor.userId));
  return !!row?.until && row.until > new Date();
}

const isEarly = (c: { access: string; freeAt: Date | null }) => c.access === 'early_access' && (!c.freeAt || c.freeAt > new Date());
const chapterLocked = (c: { access: string; freeAt: Date | null }, premium: boolean, staff: boolean) => !staff && !premium && isEarly(c);

async function labelsFor(kind: 'genres' | 'tags', ids: string[]): Promise<Map<string, LabelDTO[]>> {
  const map = new Map<string, LabelDTO[]>();
  if (ids.length === 0) return map;
  const rows = kind === 'genres'
    ? await db().select({ seriesId: seriesGenres.seriesId, slug: genres.slug, name: genres.name }).from(seriesGenres)
      .innerJoin(genres, eq(genres.id, seriesGenres.genreId)).where(inArray(seriesGenres.seriesId, ids)).orderBy(asc(seriesGenres.position))
    : await db().select({ seriesId: seriesTags.seriesId, slug: tags.slug, name: tags.name }).from(seriesTags)
      .innerJoin(tags, eq(tags.id, seriesTags.tagId)).where(inArray(seriesTags.seriesId, ids)).orderBy(asc(seriesTags.position));
  for (const r of rows) map.set(r.seriesId, [...(map.get(r.seriesId) ?? []), { slug: r.slug, name: r.name }]);
  return map;
}

async function toCards<R extends CardRow>(rows: R[]) {
  const g = await labelsFor('genres', rows.map(r => r.id));
  return rows.map(({ coverKey, ...r }) => ({ ...r, coverUrl: imageSrc(coverKey), genres: g.get(r.id) ?? [] }));
}

function pageOf<T>(items: T[], total: number, q: { limit: number; offset: number }): Paged<T> {
  return { items, total, limit: q.limit, offset: q.offset };
}

/* Public reads */

export async function listGenres() {
  const n = sql<number>`count(${series.id})::int`;
  return db()
    .select({ slug: genres.slug, name: genres.name, hue: genres.hue, count: n })
    .from(genres)
    .leftJoin(seriesGenres, eq(seriesGenres.genreId, genres.id))
    .leftJoin(series, and(eq(series.id, seriesGenres.seriesId), isPublicSeries))
    .groupBy(genres.id)
    .orderBy(desc(n), asc(genres.name));
}

export async function listSeries(input: ListSeriesInput = {}): Promise<Paged<SeriesCardDTO>> {
  const q = parseInput(listSeriesInput, input);
  const filters: (SQL | undefined)[] = [isPublicSeries];
  if (q.status) filters.push(eq(series.status, q.status));
  if (q.excludeId) filters.push(sql`${series.id} <> ${q.excludeId}`);
  if (q.q) {
    const term = escapeLike(q.q);
    filters.push(or(
      ilike(series.title, term),
      ilike(series.author, term),
      ilike(series.artist, term),
      sql`array_to_string(${series.altTitles}, ' ') ilike ${term}`,
      inArray(series.id, db().select({ id: seriesTags.seriesId }).from(seriesTags).innerJoin(tags, eq(tags.id, seriesTags.tagId)).where(ilike(tags.name, term))),
    ));
  }
  if (q.genre) {
    filters.push(inArray(series.id, db()
      .select({ id: seriesGenres.seriesId }).from(seriesGenres)
      .innerJoin(genres, eq(genres.id, seriesGenres.genreId))
      .where(eq(genres.slug, q.genre))));
  }
  const where = and(...filters);
  const order = {
    popular: [desc(series.viewCount)],
    updated: [sql`${chapterStats.latestChapterAt} desc nulls last`],
    new: [sql`${series.publishedAt} desc nulls last`],
    rating: [desc(series.ratingAvg), desc(series.ratingCount)],
    title: [asc(series.title)],
  }[q.sort];
  const [rows, [{ total }]] = await Promise.all([
    db().select(cardColumns).from(series).where(where).orderBy(...order, asc(series.id)).limit(q.limit).offset(q.offset),
    db().select({ total: count() }).from(series).where(where),
  ]);
  return pageOf(await toCards(rows), total, q);
}

/** Newest `perSeries` visible chapters for each series, in one query. */
export async function latestChapters(seriesIds: string[], perSeries = 2) {
  const map = new Map<string, { number: number; title: string | null; publishedAt: Date | null; early: boolean }[]>();
  if (seriesIds.length === 0) return map;
  const ranked = db()
    .select({
      seriesId: chapters.seriesId, number: chapters.number, title: chapters.title, publishedAt: chapters.publishedAt,
      access: chapters.access, freeAt: chapters.freeAt,
      rn: sql<number>`row_number() over (partition by ${chapters.seriesId} order by ${chapters.number} desc)`.as('rn'),
    })
    .from(chapters)
    .where(and(inArray(chapters.seriesId, seriesIds), isPublishedChapter))
    .as('ranked');
  const rows = await db().select().from(ranked).where(lte(ranked.rn, perSeries)).orderBy(asc(ranked.seriesId), desc(ranked.number));
  const date = (v: Date | string | null) => (v ? new Date(v) : null);
  for (const r of rows) {
    const freeAt = date(r.freeAt);
    map.set(r.seriesId, [...(map.get(r.seriesId) ?? []), { number: Number(r.number), title: r.title, publishedAt: date(r.publishedAt), early: isEarly({ access: r.access, freeAt }) }]);
  }
  return map;
}

export async function getSeriesBySlug(slugInput: string): Promise<SeriesDetailDTO | null> {
  const parsed = slugSchema.safeParse(slugInput);
  if (!parsed.success) return null;
  const actor = await getCurrentActor();
  const staff = hasRole(actor, 'editor');
  const [row] = await db()
    .select({ ...cardColumns, altTitles: series.altTitles, artist: series.artist, sourceLanguage: series.sourceLanguage })
    .from(series)
    .where(and(eq(series.slug, parsed.data), staff ? isNull(series.deletedAt) : isPublicSeries));
  if (!row) return null;

  const visible = and(eq(chapters.seriesId, row.id), isPublishedChapter);
  const [[card], tagMap, premium, earlyRows, progressRows] = await Promise.all([
    toCards([row]),
    labelsFor('tags', [row.id]),
    isPremium(actor),
    db().select({ number: chapters.number, title: chapters.title, access: chapters.access, freeAt: chapters.freeAt })
      .from(chapters).where(and(visible, eq(chapters.access, 'early_access'), or(isNull(chapters.freeAt), gt(chapters.freeAt, sql`now()`))))
      .orderBy(asc(chapters.number)),
    actor
      ? db().select({ chapterNumber: chapters.number, percent: readingProgress.percent }).from(readingProgress)
        .innerJoin(chapters, eq(chapters.id, readingProgress.chapterId))
        .where(and(eq(readingProgress.userId, actor.userId), eq(readingProgress.seriesId, row.id)))
      : Promise.resolve([]),
  ]);

  // Newest readable chapter: the latest one unless it (and the ones before it) are early access.
  const lockedNumbers = new Set(premium || staff ? [] : earlyRows.map(r => r.number));
  const [latestFree] = await db().select({ number: chapters.number, title: chapters.title }).from(chapters)
    .where(and(visible, lockedNumbers.size ? sql`${chapters.number} not in (${sql.join([...lockedNumbers].map(n => sql`${n}`), sql`, `)})` : undefined))
    .orderBy(desc(chapters.number)).limit(1);

  return {
    ...card,
    altTitles: row.altTitles,
    artist: row.artist,
    sourceLanguage: row.sourceLanguage,
    tags: tagMap.get(row.id) ?? [],
    latestFree: latestFree ?? null,
    earlyCount: earlyRows.length,
    progress: progressRows[0] ?? null,
    premium,
    chapters: await listChaptersFor(row.id, {}, premium || staff),
  };
}

async function listChaptersFor(seriesId: string, input: PublicChaptersInput, unlocked: boolean): Promise<Paged<ChapterListItemDTO>> {
  const q = parseInput(publicChaptersInput, input);
  const filters: (SQL | undefined)[] = [eq(chapters.seriesId, seriesId), isPublishedChapter];
  if (q.after !== undefined) filters.push(gt(chapters.number, q.after));
  if (q.q) {
    const term = escapeLike(q.q);
    filters.push(or(ilike(chapters.title, term), sql`${chapters.number}::text ilike ${term}`));
  }
  const where = and(...filters);
  const [rows, [{ total }]] = await Promise.all([
    db().select({ id: chapters.id, number: chapters.number, title: chapters.title, publishedAt: chapters.publishedAt, access: chapters.access, freeAt: chapters.freeAt })
      .from(chapters).where(where).orderBy(q.order === 'asc' ? asc(chapters.number) : desc(chapters.number)).limit(q.limit).offset(q.offset),
    db().select({ total: count() }).from(chapters).where(where),
  ]);
  return pageOf(rows.map(({ access, ...c }) => ({ ...c, early: isEarly({ access, freeAt: c.freeAt }), locked: !unlocked && isEarly({ access, freeAt: c.freeAt }) })), total, q);
}

/** Paged, searchable chapter list for a public series page. */
export async function listPublicChapters(seriesSlug: string, input: PublicChaptersInput = {}): Promise<Paged<ChapterListItemDTO> | null> {
  const slug = parseInput(slugSchema, seriesSlug);
  const actor = await getCurrentActor();
  const staff = hasRole(actor, 'editor');
  const [row] = await db().select({ id: series.id }).from(series).where(and(eq(series.slug, slug), staff ? isNull(series.deletedAt) : isPublicSeries));
  if (!row) return null;
  return listChaptersFor(row.id, input, staff || await isPremium(actor));
}

export async function getChapterForReader(seriesSlug: string, number: number): Promise<ReaderChapterDTO | null> {
  const parsedSlug = slugSchema.safeParse(seriesSlug);
  if (!parsedSlug.success || !Number.isFinite(number)) return null;
  const actor = await getCurrentActor();
  const staff = hasRole(actor, 'editor');
  const [row] = await db()
    .select({
      id: chapters.id, number: chapters.number, title: chapters.title, access: chapters.access, freeAt: chapters.freeAt,
      seriesId: series.id, slug: series.slug, seriesTitle: series.title, coverHue: series.coverHue,
    })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(eq(series.slug, parsedSlug.data), eq(chapters.number, number), staff ? isNull(series.deletedAt) : and(isPublicSeries, isPublishedChapter)));
  if (!row) return null;

  const premium = await isPremium(actor);
  const locked = chapterLocked(row, premium, staff);
  const [toc, pages, progress] = await Promise.all([
    db().select({ id: chapters.id, number: chapters.number, title: chapters.title, access: chapters.access, freeAt: chapters.freeAt })
      .from(chapters).where(and(eq(chapters.seriesId, row.seriesId), isPublishedChapter)).orderBy(desc(chapters.number)),
    locked ? Promise.resolve([]) : db()
      .select({ id: chapterPages.id, pageNumber: chapterPages.pageNumber, width: chapterPages.width, height: chapterPages.height, sourceKey: chapterPages.sourceKey, outputKey: chapterPages.outputKey })
      .from(chapterPages).where(eq(chapterPages.chapterId, row.id)).orderBy(asc(chapterPages.pageNumber)),
    actor && !locked
      ? db().select({ pageNumber: readingProgress.pageNumber, pageOffset: readingProgress.pageOffset }).from(readingProgress)
        .where(and(eq(readingProgress.userId, actor.userId), eq(readingProgress.seriesId, row.seriesId), eq(readingProgress.chapterId, row.id)))
      : Promise.resolve([]),
  ]);
  const prev = toc.find(c => c.number < row.number) ?? null;
  const next = [...toc].reverse().find(c => c.number > row.number) ?? null;
  const nextLocked = !!next && chapterLocked(next, premium, staff);
  const nextPages = next && !nextLocked
    ? await db().select({ sourceKey: chapterPages.sourceKey, outputKey: chapterPages.outputKey }).from(chapterPages)
      .where(eq(chapterPages.chapterId, next.id)).orderBy(asc(chapterPages.pageNumber)).limit(2)
    : [];
  return {
    id: row.id, number: row.number, title: row.title, locked, freeAt: row.freeAt,
    series: { id: row.seriesId, slug: row.slug, title: row.seriesTitle, coverHue: row.coverHue },
    prev: prev?.number ?? null,
    next: next?.number ?? null,
    nextLocked,
    pages: pages.map(p => ({ id: p.id, pageNumber: p.pageNumber, width: p.width, height: p.height, src: imageSrc(p.outputKey) ?? imageSrc(p.sourceKey) })),
    toc: toc.map(c => ({ number: c.number, title: c.title, locked: chapterLocked(c, premium, staff) })),
    resume: progress[0] ?? null,
    nextPreload: nextPages.flatMap(p => imageSrc(p.outputKey) ?? imageSrc(p.sourceKey) ?? []),
  };
}

/* Staff reads */

export type AdminSeriesRowDTO = {
  id: string; slug: string; title: string; author: string; status: SeriesStatus; coverHue: number; coverUrl: string | null;
  viewCount: number; chapterCount: number; publishedCount: number; genres: string[]; updatedAt: Date;
};

export async function adminListSeries(input: AdminListSeriesInput = {}): Promise<Paged<AdminSeriesRowDTO>> {
  await requireRole('editor');
  const q = parseInput(adminListSeriesInput, input);
  const filters: (SQL | undefined)[] = [isNull(series.deletedAt)];
  if (q.status) filters.push(eq(series.status, q.status));
  if (q.q) {
    const term = escapeLike(q.q);
    filters.push(or(ilike(series.title, term), ilike(series.author, term), ilike(series.slug, term)));
  }
  const where = and(...filters);
  const [rows, [{ total }]] = await Promise.all([
    db().select({
      id: series.id, slug: series.slug, title: series.title, author: series.author, status: series.status,
      coverHue: series.coverHue, coverKey: series.coverKey, viewCount: series.viewCount, updatedAt: series.updatedAt,
      chapterCount: sql<number>`(select count(*)::int from ${chapters} c where c.series_id = ${outer(series.id)})`,
      publishedCount: chapterStats.chapterCount,
    }).from(series).where(where).orderBy(desc(series.updatedAt), asc(series.id)).limit(q.limit).offset(q.offset),
    db().select({ total: count() }).from(series).where(where),
  ]);
  const g = await labelsFor('genres', rows.map(r => r.id));
  return pageOf(rows.map(({ coverKey, ...r }) => ({ ...r, coverUrl: imageSrc(coverKey), genres: (g.get(r.id) ?? []).map(x => x.name) })), total, q);
}

/** Every non-deleted series, for pickers. */
export async function adminSeriesOptions() {
  await requireRole('editor');
  return db().select({
    id: series.id, title: series.title, sourceLanguage: series.sourceLanguage,
    nextNumber: sql<number>`(select coalesce(floor(max(c.number)), 0)::int + 1 from ${chapters} c where c.series_id = ${outer(series.id)})`,
  }).from(series).where(isNull(series.deletedAt)).orderBy(asc(series.title)).limit(2000);
}

export type AdminSeriesDTO = {
  id: string; slug: string; title: string; altTitles: string[]; description: string; author: string; artist: string | null;
  status: SeriesStatus; sourceLanguage: string; coverHue: number; coverUrl: string | null; genres: string[]; tags: string[];
};

export async function adminGetSeries(seriesId: string): Promise<AdminSeriesDTO | null> {
  await requireRole('editor');
  const id = uuid.safeParse(seriesId);
  if (!id.success) return null;
  const [row] = await db().select({
    id: series.id, slug: series.slug, title: series.title, altTitles: series.altTitles, description: series.description,
    author: series.author, artist: series.artist, status: series.status, sourceLanguage: series.sourceLanguage,
    coverHue: series.coverHue, coverKey: series.coverKey,
  }).from(series).where(and(eq(series.id, id.data), isNull(series.deletedAt)));
  if (!row) return null;
  const [g, t] = await Promise.all([labelsFor('genres', [row.id]), labelsFor('tags', [row.id])]);
  const { coverKey, ...rest } = row;
  return { ...rest, coverUrl: coverKey?.startsWith('https://') ? coverKey : null, genres: (g.get(row.id) ?? []).map(x => x.name), tags: (t.get(row.id) ?? []).map(x => x.name) };
}

export async function adminListTagNames() {
  await requireRole('editor');
  return db().select({ name: tags.name }).from(tags).orderBy(asc(tags.name)).limit(500).then(r => r.map(x => x.name));
}

export type AdminChapterRowDTO = {
  id: string; number: number; title: string | null; status: ChapterStatus; scheduled: boolean;
  access: 'free' | 'early_access'; freeAt: Date | null; publishedAt: Date | null; pageCount: number; updatedAt: Date;
};

export async function adminListChapters(input: AdminListChaptersInput): Promise<Paged<AdminChapterRowDTO>> {
  await requireRole('editor');
  const q = parseInput(adminListChaptersInput, input);
  const filters: (SQL | undefined)[] = [eq(chapters.seriesId, q.seriesId)];
  if (q.status === 'published') filters.push(isPublishedChapter);
  if (q.status === 'scheduled') filters.push(and(eq(chapters.status, 'published'), gt(chapters.publishedAt, sql`now()`)));
  if (q.status === 'draft') filters.push(eq(chapters.status, 'draft'));
  if (q.status === 'pipeline') filters.push(inArray(chapters.status, ['processing', 'in_review', 'ready', 'failed']));
  const where = and(...filters);
  const [rows, [{ total }]] = await Promise.all([
    db().select({
      id: chapters.id, number: chapters.number, title: chapters.title, status: chapters.status, access: chapters.access,
      freeAt: chapters.freeAt, publishedAt: chapters.publishedAt, pageCount: chapters.pageCount, updatedAt: chapters.updatedAt,
    }).from(chapters).where(where).orderBy(desc(chapters.number)).limit(q.limit).offset(q.offset),
    db().select({ total: count() }).from(chapters).where(where),
  ]);
  const now = new Date();
  return pageOf(rows.map(r => ({ ...r, scheduled: r.status === 'published' && !!r.publishedAt && r.publishedAt > now })), total, q);
}

export type AdminChapterDTO = {
  id: string; number: number; title: string | null; status: ChapterStatus; access: 'free' | 'early_access';
  freeAt: Date | null; publishedAt: Date | null;
  series: { id: string; slug: string; title: string };
  pages: { id: string; pageNumber: number; width: number; height: number; src: string | null }[];
};

export async function adminGetChapter(chapterId: string): Promise<AdminChapterDTO | null> {
  await requireRole('editor');
  const id = uuid.safeParse(chapterId);
  if (!id.success) return null;
  const [row] = await db().select({
    id: chapters.id, number: chapters.number, title: chapters.title, status: chapters.status, access: chapters.access,
    freeAt: chapters.freeAt, publishedAt: chapters.publishedAt, seriesId: series.id, slug: series.slug, seriesTitle: series.title,
  }).from(chapters).innerJoin(series, eq(series.id, chapters.seriesId)).where(and(eq(chapters.id, id.data), isNull(series.deletedAt)));
  if (!row) return null;
  const pages = await db().select({ id: chapterPages.id, pageNumber: chapterPages.pageNumber, width: chapterPages.width, height: chapterPages.height, sourceKey: chapterPages.sourceKey, outputKey: chapterPages.outputKey })
    .from(chapterPages).where(eq(chapterPages.chapterId, row.id)).orderBy(asc(chapterPages.pageNumber));
  const { seriesId, slug, seriesTitle, ...c } = row;
  return {
    ...c,
    series: { id: seriesId, slug, title: seriesTitle },
    pages: pages.map(p => ({ id: p.id, pageNumber: p.pageNumber, width: p.width, height: p.height, src: imageSrc(p.outputKey) ?? imageSrc(p.sourceKey) })),
  };
}

/** Next free chapter number for a series (max + 1), used to prefill the new-chapter form. */
export async function adminNextChapterNumber(seriesId: string) {
  await requireRole('editor');
  const [row] = await db().select({ n: max(chapters.number) }).from(chapters).where(eq(chapters.seriesId, parseInput(uuid, seriesId)));
  return Math.floor(Number(row?.n ?? 0)) + 1;
}

/* Staff writes: series */

const hueFor = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** Insert any missing genres/tags by slug and return their ids in the given order. */
async function upsertLabels(tx: Executor, kind: 'genres' | 'tags', names: string[]): Promise<string[]> {
  const bySlug = new Map<string, string>();
  for (const name of names) {
    const s = toSlug(name).slice(0, 64);
    if (!s) throw new DalError('INVALID_INPUT', 'Some fields are invalid.', { [kind]: [`“${name}” needs at least one Latin letter or digit`] });
    if (!bySlug.has(s)) bySlug.set(s, name);
  }
  if (bySlug.size === 0) return [];
  const slugs = [...bySlug.keys()];
  if (kind === 'genres') {
    await tx.insert(genres).values(slugs.map(s => ({ slug: s, name: bySlug.get(s)!, hue: hueFor(s) }))).onConflictDoNothing();
  } else {
    await tx.insert(tags).values(slugs.map(s => ({ slug: s, name: bySlug.get(s)! }))).onConflictDoNothing();
  }
  const table = kind === 'genres' ? genres : tags;
  const found = await tx.select({ id: table.id, slug: table.slug }).from(table).where(inArray(table.slug, slugs));
  const ids = new Map(found.map(r => [r.slug, r.id]));
  // A name can collide with an existing label under a different slug; skip those rather than fail.
  return slugs.flatMap(s => (ids.has(s) ? [ids.get(s)!] : []));
}

async function setSeriesLabels(tx: Executor, seriesId: string, genreNames: string[], tagNames: string[]) {
  const [genreIds, tagIds] = [await upsertLabels(tx, 'genres', genreNames), await upsertLabels(tx, 'tags', tagNames)];
  await tx.delete(seriesGenres).where(eq(seriesGenres.seriesId, seriesId));
  await tx.delete(seriesTags).where(eq(seriesTags.seriesId, seriesId));
  if (genreIds.length) await tx.insert(seriesGenres).values(genreIds.map((genreId, position) => ({ seriesId, genreId, position })));
  if (tagIds.length) await tx.insert(seriesTags).values(tagIds.map((tagId, position) => ({ seriesId, tagId, position })));
}

export async function createSeries(input: CreateSeriesInput) {
  const actor = await requireRole('editor');
  const { genres: genreNames, tags: tagNames, coverUrl, ...data } = parseInput(createSeriesInput, input);
  try {
    return await db().transaction(async tx => {
      const [row] = await tx.insert(series).values({
        ...data,
        coverKey: coverUrl ?? null,
        createdBy: actor.userId,
        publishedAt: data.status === 'draft' ? null : new Date(),
      }).returning({ id: series.id, slug: series.slug });
      await setSeriesLabels(tx, row.id, genreNames, tagNames);
      await recordAudit(tx, actor, { action: 'series.create', targetType: 'series', targetId: row.id, metadata: { slug: row.slug } });
      return row;
    });
  } catch (err) {
    rethrowUnique(err, 'A series with that slug already exists.');
  }
}

export async function updateSeries(seriesId: string, input: UpdateSeriesInput) {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, seriesId);
  const { genres: genreNames, tags: tagNames, coverUrl, ...data } = parseInput(updateSeriesInput, input);
  try {
    return await db().transaction(async tx => {
      const [current] = await tx.select({ publishedAt: series.publishedAt, coverKey: series.coverKey, slug: series.slug }).from(series).where(and(eq(series.id, id), isNull(series.deletedAt)));
      if (!current) throw new DalError('NOT_FOUND', 'Series not found.');
      // Keep a storage-key cover unless the editor entered a URL; an empty field clears only URL covers.
      const coverKey = coverUrl ?? (current.coverKey?.startsWith('https://') ? null : current.coverKey);
      const publishedAt = current.publishedAt ?? (data.status !== 'draft' ? new Date() : null);
      await tx.update(series).set({ ...data, coverKey, publishedAt }).where(eq(series.id, id));
      await setSeriesLabels(tx, id, genreNames, tagNames);
      await recordAudit(tx, actor, { action: 'series.update', targetType: 'series', targetId: id, metadata: { slug: data.slug, previousSlug: current.slug } });
      return { id, slug: data.slug, previousSlug: current.slug };
    });
  } catch (err) {
    rethrowUnique(err, 'A series with that slug already exists.');
  }
}

/** Soft delete: hides the series everywhere; rows stay for audit and reading history. */
export async function deleteSeries(seriesId: string) {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, seriesId);
  return db().transaction(async tx => {
    const [row] = await tx.update(series).set({ deletedAt: new Date() }).where(and(eq(series.id, id), isNull(series.deletedAt))).returning({ slug: series.slug });
    if (!row) throw new DalError('NOT_FOUND', 'Series not found.');
    await recordAudit(tx, actor, { action: 'series.delete', targetType: 'series', targetId: id, metadata: { slug: row.slug } });
    return row;
  });
}

/* Staff writes: chapters */

/**
 * Notify followers (with alerts on) about a chapter that is now live. One statement regardless of follower count.
 * Skipped when the admin setting "Notify followers on publish" is off.
 */
export async function notifyFollowers(tx: Executor, ch: { id: string; seriesId: string; number: number }) {
  const [s] = await tx.update(series).set({ updatedAt: new Date() }).where(eq(series.id, ch.seriesId)).returning({ slug: series.slug, title: series.title, status: series.status });
  const href = `/read/${s.slug}/${ch.number}`;
  if (s.status === 'draft' || !(await getSettings()).notifyFollowersOnPublish) return href;
  await tx.execute(sql`
    insert into ${notifications} (user_id, type, title, href, data)
    select f.user_id, 'new_chapter', ${`${s.title} · Chapter ${ch.number}`}, ${href}, ${JSON.stringify({ seriesId: ch.seriesId, chapterId: ch.id })}::jsonb
    from ${follows} f
    where f.series_id = ${ch.seriesId} and f.notify
  `);
  return href;
}

/** Resolve the stored publish date: published without a date means now; drafts keep a planned date. */
const publishDate = (status: 'draft' | 'published', at: Date | null | undefined) => (status === 'published' ? at ?? new Date() : at ?? null);

export async function createChapter(input: CreateChapterInput) {
  const actor = await requireRole('editor');
  const data = parseInput(createChapterInput, input);
  try {
    return await db().transaction(async tx => {
      const [exists] = await tx.select({ id: series.id }).from(series).where(and(eq(series.id, data.seriesId), isNull(series.deletedAt)));
      if (!exists) throw new DalError('NOT_FOUND', 'Series not found.');
      const publishedAt = publishDate(data.status, data.publishedAt);
      const [row] = await tx.insert(chapters).values({
        ...data,
        freeAt: data.access === 'early_access' ? data.freeAt : null,
        publishedAt,
        createdBy: actor.userId,
      }).returning({ id: chapters.id, number: chapters.number });
      if (data.status === 'published' && publishedAt && publishedAt <= new Date()) await notifyFollowers(tx, { id: row.id, seriesId: data.seriesId, number: row.number });
      await recordAudit(tx, actor, { action: 'chapter.create', targetType: 'chapter', targetId: row.id, metadata: { seriesId: data.seriesId, number: data.number, status: data.status } });
      return row;
    });
  } catch (err) {
    rethrowUnique(err, 'That chapter number already exists in this series.');
  }
}

const PIPELINE_BUSY: ChapterStatus[] = ['processing', 'in_review', 'failed'];

export async function updateChapter(chapterId: string, input: UpdateChapterInput) {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, chapterId);
  const data = parseInput(updateChapterInput, input);
  try {
    return await db().transaction(async tx => {
      const [current] = await tx.select({ status: chapters.status, publishedAt: chapters.publishedAt, seriesId: chapters.seriesId }).from(chapters).where(eq(chapters.id, id)).for('update');
      if (!current) throw new DalError('NOT_FOUND', 'Chapter not found.');
      if (data.status === 'published' && PIPELINE_BUSY.includes(current.status)) {
        throw new DalError('CONFLICT', 'This chapter is still in the processing pipeline and can’t be published yet.');
      }
      // A "draft" save on a pipeline chapter keeps its pipeline state.
      const status = data.status === 'draft' && current.status !== 'published' && current.status !== 'draft' ? current.status : data.status;
      const publishedAt = publishDate(data.status, data.publishedAt);
      const [row] = await tx.update(chapters).set({
        ...data,
        status,
        freeAt: data.access === 'early_access' ? data.freeAt : null,
        publishedAt,
      }).where(eq(chapters.id, id)).returning({ id: chapters.id, number: chapters.number, seriesId: chapters.seriesId });

      const wasLive = current.status === 'published' && !!current.publishedAt && current.publishedAt <= new Date();
      const isLive = status === 'published' && !!publishedAt && publishedAt <= new Date();
      if (isLive && !wasLive) await notifyFollowers(tx, row);
      await recordAudit(tx, actor, { action: 'chapter.update', targetType: 'chapter', targetId: id, metadata: { status, number: row.number } });
      return row;
    });
  } catch (err) {
    rethrowUnique(err, 'That chapter number already exists in this series.');
  }
}

/** Quick publish/unpublish from the chapter list. Publishing keeps a scheduled date; unpublishing returns to draft. */
export async function setChapterPublished(chapterId: string, published: boolean) {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, chapterId);
  return db().transaction(async tx => {
    const [current] = await tx.select({ status: chapters.status, publishedAt: chapters.publishedAt }).from(chapters).where(eq(chapters.id, id)).for('update');
    if (!current) throw new DalError('NOT_FOUND', 'Chapter not found.');
    if (published && PIPELINE_BUSY.includes(current.status)) throw new DalError('CONFLICT', 'This chapter is still in the processing pipeline.');
    if (!published && current.status !== 'published') return { id };
    const publishedAt = published ? current.publishedAt ?? new Date() : current.publishedAt;
    const [row] = await tx.update(chapters).set({ status: published ? 'published' : 'draft', publishedAt })
      .where(eq(chapters.id, id)).returning({ id: chapters.id, number: chapters.number, seriesId: chapters.seriesId });
    if (published && current.status !== 'published' && !!publishedAt && publishedAt <= new Date()) await notifyFollowers(tx, row);
    await recordAudit(tx, actor, { action: published ? 'chapter.publish' : 'chapter.unpublish', targetType: 'chapter', targetId: id });
    return { id };
  });
}

/** Publish a `ready` chapter (the pipeline's hand-off) and notify followers, atomically. */
export async function publishChapter(chapterId: string) {
  const actor = await requireRole('editor');
  return db().transaction(async tx => {
    const [ch] = await tx
      .update(chapters)
      .set({ status: 'published', publishedAt: new Date() })
      .where(and(eq(chapters.id, parseInput(uuid, chapterId)), eq(chapters.status, 'ready')))
      .returning({ id: chapters.id, seriesId: chapters.seriesId, number: chapters.number });
    if (!ch) throw new DalError('CONFLICT', 'Only chapters marked ready can be published.');
    const href = await notifyFollowers(tx, ch);
    await recordAudit(tx, actor, { action: 'chapter.publish', targetType: 'chapter', targetId: ch.id });
    return { id: ch.id, href };
  });
}

export async function deleteChapter(chapterId: string) {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, chapterId);
  return db().transaction(async tx => {
    const [row] = await tx.delete(chapters).where(eq(chapters.id, id)).returning({ seriesId: chapters.seriesId, number: chapters.number });
    if (!row) throw new DalError('NOT_FOUND', 'Chapter not found.');
    await recordAudit(tx, actor, { action: 'chapter.delete', targetType: 'chapter', targetId: id, metadata: row });
    return row;
  });
}

/* Staff writes: pages */

async function syncPageCount(tx: Executor, chapterId: string) {
  await tx.update(chapters)
    .set({ pageCount: sql`(select count(*)::int from ${chapterPages} p where p.chapter_id = ${chapterId})` })
    .where(eq(chapters.id, chapterId));
}

async function lockChapter(tx: Executor, chapterId: string) {
  const [row] = await tx.select({ id: chapters.id }).from(chapters).where(eq(chapters.id, chapterId)).for('update');
  if (!row) throw new DalError('NOT_FOUND', 'Chapter not found.');
}

/** Append pages after the current last page. */
export async function addPages(input: AddPagesInput) {
  const actor = await requireRole('editor');
  const data = parseInput(addPagesInput, input);
  return db().transaction(async tx => {
    await lockChapter(tx, data.chapterId);
    const [{ last }] = await tx.select({ last: sql<number>`coalesce(max(${chapterPages.pageNumber}), 0)::int` }).from(chapterPages).where(eq(chapterPages.chapterId, data.chapterId));
    await tx.insert(chapterPages).values(data.pages.map((p, i) => ({
      chapterId: data.chapterId, pageNumber: last + i + 1, sourceKey: p.url, width: p.width, height: p.height,
    })));
    await syncPageCount(tx, data.chapterId);
    await recordAudit(tx, actor, { action: 'chapter.pages.add', targetType: 'chapter', targetId: data.chapterId, metadata: { count: data.pages.length } });
    return { added: data.pages.length };
  });
}

/** Write page numbers 1..n in the given order. Moves through a temporary range so the unique index never collides. */
async function renumber(tx: Executor, chapterId: string, orderedIds: string[]) {
  if (orderedIds.length === 0) return;
  const OFFSET = 1_000_000;
  await tx.update(chapterPages).set({ pageNumber: sql`${chapterPages.pageNumber} + ${OFFSET}` }).where(eq(chapterPages.chapterId, chapterId));
  const values = sql.join(orderedIds.map((id, i) => sql`(${id}::uuid, ${i + 1}::int)`), sql`, `);
  await tx.execute(sql`
    update ${chapterPages} set page_number = v.n
    from (values ${values}) as v(id, n)
    where ${chapterPages.id} = v.id and ${chapterPages.chapterId} = ${chapterId}
  `);
}

export async function reorderPages(input: ReorderPagesInput) {
  const actor = await requireRole('editor');
  const data = parseInput(reorderPagesInput, input);
  return db().transaction(async tx => {
    await lockChapter(tx, data.chapterId);
    const existing = await tx.select({ id: chapterPages.id }).from(chapterPages).where(eq(chapterPages.chapterId, data.chapterId));
    const ids = new Set(existing.map(p => p.id));
    if (ids.size !== data.pageIds.length || data.pageIds.some(id => !ids.has(id))) {
      throw new DalError('CONFLICT', 'The page list changed since you opened it. Reload and try again.');
    }
    await renumber(tx, data.chapterId, data.pageIds);
    await recordAudit(tx, actor, { action: 'chapter.pages.reorder', targetType: 'chapter', targetId: data.chapterId });
    return { count: data.pageIds.length };
  });
}

export async function deletePage(pageId: string) {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, pageId);
  return db().transaction(async tx => {
    const [page] = await tx.select({ chapterId: chapterPages.chapterId }).from(chapterPages).where(eq(chapterPages.id, id));
    if (!page) throw new DalError('NOT_FOUND', 'Page not found.');
    await lockChapter(tx, page.chapterId);
    await tx.delete(chapterPages).where(eq(chapterPages.id, id));
    const rest = await tx.select({ id: chapterPages.id }).from(chapterPages).where(eq(chapterPages.chapterId, page.chapterId)).orderBy(asc(chapterPages.pageNumber));
    await renumber(tx, page.chapterId, rest.map(p => p.id));
    await syncPageCount(tx, page.chapterId);
    await recordAudit(tx, actor, { action: 'chapter.pages.delete', targetType: 'chapter', targetId: page.chapterId, metadata: { pageId: id } });
    return { chapterId: page.chapterId };
  });
}

/* Upload: chapter + pages (+ processing job) in one transaction */

/**
 * Create a chapter from uploaded pages. `process` queues a pipeline job (the chapter waits in
 * `processing` for a worker); `direct` is for pages that are already translated and typeset,
 * which leaves the chapter `ready` to publish.
 */
export async function uploadChapter(input: UploadChapterInput) {
  const actor = await requireRole('editor');
  const data = parseInput(uploadChapterInput, input);
  try {
    return await db().transaction(async tx => {
      const [s] = await tx.select({ id: series.id, sourceLanguage: series.sourceLanguage }).from(series).where(and(eq(series.id, data.seriesId), isNull(series.deletedAt)));
      if (!s) throw new DalError('NOT_FOUND', 'Series not found.');
      const [ch] = await tx.insert(chapters).values({
        seriesId: s.id, number: data.number, title: data.title, status: data.mode === 'process' ? 'processing' : 'ready',
        pageCount: data.pages.length, createdBy: actor.userId,
      }).returning({ id: chapters.id, number: chapters.number });
      await tx.insert(chapterPages).values(data.pages.map((p, i) => ({ chapterId: ch.id, pageNumber: i + 1, sourceKey: p.url, width: p.width, height: p.height })));
      let jobId: string | null = null;
      if (data.mode === 'process') {
        const [job] = await tx.insert(translationJobs).values({
          chapterId: ch.id, sourceLanguage: data.sourceLanguage ?? s.sourceLanguage, targetLanguage: data.targetLanguage, requestedBy: actor.userId,
        }).returning({ id: translationJobs.id });
        jobId = job.id;
        await tx.insert(translationJobLogs).values({ jobId: job.id, attempt: 1, stage: 'queued', message: `Validated upload records for ${data.pages.length} pages; queued full processing.` });
      }
      await recordAudit(tx, actor, { action: 'chapter.upload', targetType: 'chapter', targetId: ch.id, metadata: { seriesId: s.id, number: ch.number, pages: data.pages.length, mode: data.mode, jobId } });
      return { chapterId: ch.id, jobId };
    });
  } catch (err) {
    rethrowUnique(err, 'That chapter number already exists in this series.');
  }
}

/* Helpers for callers that only have an id */

export async function seriesSlugForChapter(chapterId: string) {
  const [row] = await db().select({ slug: series.slug, seriesId: series.id }).from(chapters).innerJoin(series, eq(series.id, chapters.seriesId)).where(eq(chapters.id, parseInput(uuid, chapterId)));
  return row ?? null;
}
