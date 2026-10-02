import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, numeric, pgTable, primaryKey, smallint, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_shared';
import { chapterAccess, chapterStatus, seriesStatus } from './enums';
import { users } from './identity';

export const series = pgTable('series', {
  id: id(),
  slug: varchar({ length: 96 }).notNull().unique(),
  title: varchar({ length: 200 }).notNull(),
  altTitle: varchar({ length: 300 }),
  description: text().notNull().default(''),
  author: varchar({ length: 120 }).notNull(),
  artist: varchar({ length: 120 }),
  status: seriesStatus().notNull().default('draft'),
  /** BCP-47 language of the source material, e.g. `ko`. */
  sourceLanguage: varchar({ length: 16 }).notNull().default('ko'),
  coverKey: text(),
  /** OKLCH hue used for generated covers/backdrops (see lib/data.ts `cover`). */
  coverHue: smallint().notNull().default(40),
  /** Denormalized counters, maintained by server-side jobs. */
  ratingAvg: numeric({ precision: 3, scale: 2, mode: 'number' }).notNull().default(0),
  ratingCount: integer().notNull().default(0),
  viewCount: bigint({ mode: 'number' }).notNull().default(0),
  followerCount: integer().notNull().default(0),
  publishedAt: tstz(),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  deletedAt: tstz(),
  ...timestamps(),
}, t => [
  index('series_status_published_idx').on(t.status, t.publishedAt),
  index('series_views_idx').on(t.viewCount),
  check('series_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check('series_cover_hue_range', sql`${t.coverHue} between 0 and 360`),
  check('series_rating_range', sql`${t.ratingAvg} between 0 and 5`),
]);

export const genres = pgTable('genres', {
  id: id(),
  slug: varchar({ length: 64 }).notNull().unique(),
  name: varchar({ length: 64 }).notNull().unique(),
  hue: smallint().notNull().default(0),
  ...timestamps(),
});

export const seriesGenres = pgTable('series_genres', {
  seriesId: uuid().notNull().references(() => series.id, { onDelete: 'cascade' }),
  genreId: uuid().notNull().references(() => genres.id, { onDelete: 'cascade' }),
  /** Lower = more prominent; the first genre is the series' primary genre. */
  position: smallint().notNull().default(0),
}, t => [
  primaryKey({ columns: [t.seriesId, t.genreId] }),
  index('series_genres_genre_idx').on(t.genreId),
]);

export const chapters = pgTable('chapters', {
  id: id(),
  seriesId: uuid().notNull().references(() => series.id, { onDelete: 'cascade' }),
  /** Numeric so bonus chapters like 12.5 sort correctly. */
  number: numeric({ precision: 7, scale: 2, mode: 'number' }).notNull(),
  title: varchar({ length: 200 }),
  status: chapterStatus().notNull().default('draft'),
  access: chapterAccess().notNull().default('free'),
  /** For `early_access` chapters: when they become free for everyone. */
  freeAt: tstz(),
  publishedAt: tstz(),
  pageCount: integer().notNull().default(0),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  ...timestamps(),
}, t => [
  uniqueIndex('chapters_series_number_uq').on(t.seriesId, t.number),
  index('chapters_series_published_idx').on(t.seriesId, t.publishedAt),
  index('chapters_status_idx').on(t.status),
  index('chapters_published_at_idx').on(t.publishedAt),
  check('chapters_number_positive', sql`${t.number} >= 0`),
]);

export const chapterPages = pgTable('chapter_pages', {
  id: id(),
  chapterId: uuid().notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  pageNumber: integer().notNull(),
  /** Object-storage key of the original upload. Never expose raw keys; sign URLs server-side. */
  sourceKey: text().notNull(),
  /** Object-storage key of the final typeset image (null until processed). */
  outputKey: text(),
  width: integer().notNull(),
  height: integer().notNull(),
  bytes: integer(),
  ...timestamps(),
}, t => [
  uniqueIndex('chapter_pages_chapter_page_uq').on(t.chapterId, t.pageNumber),
  check('chapter_pages_page_positive', sql`${t.pageNumber} > 0`),
  check('chapter_pages_dimensions', sql`${t.width} > 0 and ${t.height} > 0`),
]);

/** Per-series translation glossary (e.g. 빚 → "the Debt"). */
export const glossaryTerms = pgTable('glossary_terms', {
  id: id(),
  seriesId: uuid().notNull().references(() => series.id, { onDelete: 'cascade' }),
  sourceTerm: varchar({ length: 200 }).notNull(),
  targetTerm: varchar({ length: 200 }).notNull(),
  notes: text(),
  caseSensitive: boolean().notNull().default(false),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  ...timestamps(),
}, t => [
  uniqueIndex('glossary_terms_series_source_uq').on(t.seriesId, t.sourceTerm),
]);

export const characters = pgTable('characters', {
  id: id(),
  seriesId: uuid().notNull().references(() => series.id, { onDelete: 'cascade' }),
  name: varchar({ length: 120 }).notNull(),
  nativeName: varchar({ length: 120 }),
  aliases: text().array().notNull().default(sql`'{}'::text[]`),
  description: text(),
  /** Speech register hints for translation, e.g. "formal, archaic". */
  voiceNotes: text(),
  imageKey: text(),
  ...timestamps(),
}, t => [
  uniqueIndex('characters_series_name_uq').on(t.seriesId, t.name),
]);
