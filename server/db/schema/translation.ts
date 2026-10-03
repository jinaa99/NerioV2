import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, real, smallint, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_shared';
import { chapterPages, chapters } from './catalog';
import { jobStatus, pipelineStage, segmentKind, segmentReview } from './enums';
import { users } from './identity';

/**
 * One processing run of a chapter through validation, image processing, OCR, translation and QA.
 */
export const translationJobs = pgTable('translation_jobs', {
  id: id(),
  chapterId: uuid().notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  status: jobStatus().notNull().default('queued'),
  stage: pipelineStage().notNull().default('queued'),
  /** 0–100 progress within the current stage. */
  stageProgress: smallint().notNull().default(0),
  sourceLanguage: varchar({ length: 16 }).notNull(),
  targetLanguage: varchar({ length: 16 }).notNull().default('mn'),
  attempt: integer().notNull().default(1),
  /** Higher runs first. */
  priority: smallint().notNull().default(0),
  errorCode: varchar({ length: 64 }),
  errorMessage: text(),
  /** Non-secret run parameters (model ids, thresholds). */
  options: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  requestedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  startedAt: tstz(),
  finishedAt: tstz(),
  ...timestamps(),
}, t => [
  index('translation_jobs_chapter_idx').on(t.chapterId, t.createdAt.desc()),
  // Worker pickup: queued jobs by priority then age.
  index('translation_jobs_pickup_idx').on(t.priority.desc(), t.createdAt).where(sql`${t.status} = 'queued'`),
  index('translation_jobs_status_idx').on(t.status, t.updatedAt.desc()),
  check('translation_jobs_progress_range', sql`${t.stageProgress} between 0 and 100`),
  check('translation_jobs_attempt_positive', sql`${t.attempt} > 0`),
]);

/** Append-only operational events for inspecting and retrying chapter processing. */
export const translationJobLogs = pgTable('translation_job_logs', {
  id: id(),
  jobId: uuid().notNull().references(() => translationJobs.id, { onDelete: 'cascade' }),
  attempt: integer().notNull(),
  stage: pipelineStage().notNull(),
  level: varchar({ length: 12 }).notNull().default('info'),
  message: varchar({ length: 500 }).notNull(),
  details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
}, t => [
  index('translation_job_logs_job_idx').on(t.jobId, t.createdAt),
  check('translation_job_logs_level', sql`${t.level} in ('info', 'warning', 'error')`),
]);

/** A detected text region on a page, with its source text and translation. Box coordinates are fractions (0–1) of page size. */
export const translationSegments = pgTable('translation_segments', {
  id: id(),
  jobId: uuid().notNull().references(() => translationJobs.id, { onDelete: 'cascade' }),
  pageId: uuid().notNull().references(() => chapterPages.id, { onDelete: 'cascade' }),
  /** Reading order within the page. */
  position: integer().notNull(),
  kind: segmentKind().notNull().default('speech'),
  x: real().notNull(),
  y: real().notNull(),
  w: real().notNull(),
  h: real().notNull(),
  sourceText: text().notNull(),
  translatedText: text(),
  processingStatus: varchar({ length: 24 }).notNull().default('pending'),
  ocrConfidence: real(),
  translationConfidence: real(),
  qaFlags: jsonb().$type<string[]>().notNull().default([]),
  /** Model confidence 0–1; low values surface in admin review. */
  confidence: real(),
  warning: text(),
  reviewStatus: segmentReview().notNull().default('pending'),
  reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: tstz(),
  ...timestamps(),
}, t => [
  index('translation_segments_job_idx').on(t.jobId),
  index('translation_segments_page_idx').on(t.pageId, t.position),
  index('translation_segments_review_idx').on(t.jobId, t.reviewStatus),
  check('translation_segments_box', sql`${t.x} between 0 and 1 and ${t.y} between 0 and 1 and ${t.w} > 0 and ${t.w} <= 1 and ${t.h} > 0 and ${t.h} <= 1`),
  check('translation_segments_confidence_range', sql`${t.confidence} is null or ${t.confidence} between 0 and 1`),
  check('translation_segments_ocr_confidence_range', sql`${t.ocrConfidence} is null or ${t.ocrConfidence} between 0 and 1`),
  check('translation_segments_translation_confidence_range', sql`${t.translationConfidence} is null or ${t.translationConfidence} between 0 and 1`),
]);
