import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, smallint, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, tstz } from './_shared';
import { chapters, series } from './catalog';
import { notificationType } from './enums';
import { users } from './identity';

/** Current position per user per series ("Continue reading"). One row per (user, series), upserted. */
export const readingProgress = pgTable('reading_progress', {
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  seriesId: uuid().notNull().references(() => series.id, { onDelete: 'cascade' }),
  chapterId: uuid().notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  pageNumber: integer().notNull().default(1),
  /** 0–1000: how far down `page_number` the reader was (per mille), for exact resume. */
  pageOffset: smallint().notNull().default(0),
  /** 0–100, scroll progress within the chapter. */
  percent: smallint().notNull().default(0),
  updatedAt: tstz().notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  primaryKey({ columns: [t.userId, t.seriesId] }),
  index('reading_progress_user_recent_idx').on(t.userId, t.updatedAt.desc()),
  check('reading_progress_percent_range', sql`${t.percent} between 0 and 100`),
  check('reading_progress_page_offset_range', sql`${t.pageOffset} between 0 and 1000`),
]);

/** Chapters a user has opened. One row per (user, chapter); re-reads bump `last_read_at`. */
export const readingHistory = pgTable('reading_history', {
  id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  seriesId: uuid().notNull().references(() => series.id, { onDelete: 'cascade' }),
  chapterId: uuid().notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  firstReadAt: createdAt(),
  lastReadAt: tstz().notNull().defaultNow(),
  completed: boolean().notNull().default(false),
}, t => [
  uniqueIndex('reading_history_user_chapter_uq').on(t.userId, t.chapterId),
  index('reading_history_user_recent_idx').on(t.userId, t.lastReadAt.desc()),
]);

/** Series saved to the user's library. */
export const bookmarks = pgTable('bookmarks', {
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  seriesId: uuid().notNull().references(() => series.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, t => [
  primaryKey({ columns: [t.userId, t.seriesId] }),
  index('bookmarks_user_recent_idx').on(t.userId, t.createdAt.desc()),
  index('bookmarks_series_idx').on(t.seriesId),
]);

/** Series a user follows; `notify` toggles new-chapter alerts. */
export const follows = pgTable('follows', {
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  seriesId: uuid().notNull().references(() => series.id, { onDelete: 'cascade' }),
  notify: boolean().notNull().default(true),
  createdAt: createdAt(),
}, t => [
  primaryKey({ columns: [t.userId, t.seriesId] }),
  // Fan-out on publish: "who follows this series with alerts on?"
  index('follows_series_notify_idx').on(t.seriesId).where(sql`${t.notify}`),
]);

export const notifications = pgTable('notifications', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: notificationType().notNull(),
  title: varchar({ length: 200 }).notNull(),
  body: text(),
  /** Relative in-app link, e.g. `/read/lantern/115`. */
  href: varchar({ length: 500 }),
  data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  readAt: tstz(),
  createdAt: createdAt(),
}, t => [
  index('notifications_user_recent_idx').on(t.userId, t.createdAt.desc()),
  index('notifications_user_unread_idx').on(t.userId).where(sql`${t.readAt} is null`),
  check('notifications_href_relative', sql`${t.href} is null or ${t.href} ~ '^/([^/\\\\]|$)'`),
]);
