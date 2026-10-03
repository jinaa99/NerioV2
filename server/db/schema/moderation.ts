import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_shared';
import { chapters, series } from './catalog';
import { reportKind, reportStatus } from './enums';
import { users } from './identity';

/** A reader's report about a series/chapter (bad translation, missing page, …), triaged in admin. */
export const contentReports = pgTable('content_reports', {
  id: id(),
  reporterId: uuid().references(() => users.id, { onDelete: 'set null' }),
  seriesId: uuid().notNull().references(() => series.id, { onDelete: 'cascade' }),
  chapterId: uuid().references(() => chapters.id, { onDelete: 'cascade' }),
  pageNumber: integer(),
  kind: reportKind().notNull(),
  message: text().notNull(),
  status: reportStatus().notNull().default('open'),
  resolvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: tstz(),
  resolutionNote: text(),
  ...timestamps(),
}, t => [
  index('content_reports_status_idx').on(t.status, t.createdAt.desc()),
  index('content_reports_reporter_idx').on(t.reporterId, t.createdAt.desc()),
  index('content_reports_chapter_idx').on(t.chapterId),
  check('content_reports_page_positive', sql`${t.pageNumber} is null or ${t.pageNumber} > 0`),
  check('content_reports_message_length', sql`char_length(${t.message}) between 1 and 2000`),
]);

/** Operational settings edited in admin (key → JSON value). Never store secrets here. */
export const appSettings = pgTable('app_settings', {
  key: varchar({ length: 64 }).primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedAt: tstz().notNull().defaultNow(),
});
