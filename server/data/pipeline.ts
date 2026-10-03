import 'server-only';
/**
 * Processing pipeline records: jobs, the human review queue and segment review.
 * Nothing here runs OCR or translation; workers that advance jobs are a later phase.
 * Every function checks the caller's role; state changes are audited.
 */
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { pagination, reviewSegmentInput, uuid, type Pagination, type ReviewSegmentInput } from '@/lib/validation';
import { z } from 'zod';
import { requireRole } from '../auth/actor';
import { db } from '../db/client';
import { outer } from '../db/sql';
import { chapterPages, chapters, series, translationJobs, translationSegments } from '../db/schema';
import { DalError, parseInput } from '../errors';
import { imageSrc } from '../storage';
import { recordAudit } from './audit';
import { notifyFollowers } from './catalog';
import { runTranslationJob } from '../ai/runner';

export const PIPELINE_STAGES = ['validating', 'extracting', 'sorting', 'validating_images', 'optimizing_images', 'uploading', 'creating_records', 'ocr', 'context_building', 'translating', 'cleaning', 'typesetting', 'optimizing', 'qa', 'ready', 'published'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type JobStatus = 'queued' | 'running' | 'failed' | 'ready' | 'cancelled';
type Paged<T> = { items: T[]; total: number; limit: number; offset: number };

/* Jobs */

export type JobDTO = {
  id: string; status: JobStatus; stage: PipelineStage; stageProgress: number; attempt: number; priority: number;
  errorCode: string | null; errorMessage: string | null; sourceLanguage: string; targetLanguage: string;
  createdAt: Date; startedAt: Date | null; finishedAt: Date | null;
  chapter: { id: string; number: number; status: string; pageCount: number };
  series: { id: string; title: string; coverHue: number; coverUrl: string | null };
};

export const JOB_FILTERS = ['active', 'failed', 'ready', 'cancelled', 'all'] as const;
export type JobFilter = (typeof JOB_FILTERS)[number];
const filterWhere: Record<JobFilter, SQL | undefined> = {
  active: inArray(translationJobs.status, ['queued', 'running']),
  failed: eq(translationJobs.status, 'failed'),
  ready: eq(translationJobs.status, 'ready'),
  cancelled: eq(translationJobs.status, 'cancelled'),
  all: undefined,
};

export async function listJobs(input: Pagination & { filter?: JobFilter } = {}): Promise<Paged<JobDTO>> {
  await requireRole('editor');
  const q = parseInput(pagination.extend({ filter: z.enum(JOB_FILTERS).default('all') }), input);
  const where = filterWhere[q.filter];
  const [rows, [{ total }]] = await Promise.all([
    db().select({
      id: translationJobs.id, status: translationJobs.status, stage: translationJobs.stage, stageProgress: translationJobs.stageProgress,
      attempt: translationJobs.attempt, priority: translationJobs.priority, errorCode: translationJobs.errorCode, errorMessage: translationJobs.errorMessage,
      sourceLanguage: translationJobs.sourceLanguage, targetLanguage: translationJobs.targetLanguage,
      createdAt: translationJobs.createdAt, startedAt: translationJobs.startedAt, finishedAt: translationJobs.finishedAt,
      chapterId: chapters.id, chapterNumber: chapters.number, chapterStatus: chapters.status, pageCount: chapters.pageCount,
      seriesId: series.id, seriesTitle: series.title, coverHue: series.coverHue, coverKey: series.coverKey,
    })
      .from(translationJobs)
      .innerJoin(chapters, eq(chapters.id, translationJobs.chapterId))
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(where)
      // Failures first, then active work by priority, then newest.
      .orderBy(sql`case ${translationJobs.status} when 'failed' then 0 when 'running' then 1 when 'queued' then 2 else 3 end`, desc(translationJobs.priority), desc(translationJobs.createdAt))
      .limit(q.limit).offset(q.offset),
    db().select({ total: count() }).from(translationJobs).where(where),
  ]);
  return {
    items: rows.map(r => ({
      id: r.id, status: r.status, stage: r.stage, stageProgress: r.stageProgress, attempt: r.attempt, priority: r.priority,
      errorCode: r.errorCode, errorMessage: r.errorMessage, sourceLanguage: r.sourceLanguage, targetLanguage: r.targetLanguage,
      createdAt: r.createdAt, startedAt: r.startedAt, finishedAt: r.finishedAt,
      chapter: { id: r.chapterId, number: r.chapterNumber, status: r.chapterStatus, pageCount: r.pageCount },
      series: { id: r.seriesId, title: r.seriesTitle, coverHue: r.coverHue, coverUrl: imageSrc(r.coverKey) },
    })),
    total, limit: q.limit, offset: q.offset,
  };
}

export async function jobCounts() {
  await requireRole('editor');
  const rows = await db().select({ status: translationJobs.status, n: count() }).from(translationJobs).groupBy(translationJobs.status);
  const by = Object.fromEntries(rows.map(r => [r.status, r.n])) as Partial<Record<JobStatus, number>>;
  return { queued: by.queued ?? 0, running: by.running ?? 0, failed: by.failed ?? 0, ready: by.ready ?? 0, cancelled: by.cancelled ?? 0 };
}

/** Put a failed or cancelled job back in the queue as a new attempt, resuming from the stage it stopped at. */
export async function retryJob(jobId: string) {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, jobId);
  return db().transaction(async tx => {
    const [job] = await tx.update(translationJobs).set({
      status: 'queued', attempt: sql`${translationJobs.attempt} + 1`, stageProgress: 0, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null,
    }).where(and(eq(translationJobs.id, id), inArray(translationJobs.status, ['failed', 'cancelled'])))
      .returning({ chapterId: translationJobs.chapterId, attempt: translationJobs.attempt, stage: translationJobs.stage });
    if (!job) throw new DalError('CONFLICT', 'Only failed or cancelled jobs can be retried.');
    const [busy] = await tx.select({ id: translationJobs.id }).from(translationJobs)
      .where(and(eq(translationJobs.chapterId, job.chapterId), inArray(translationJobs.status, ['queued', 'running']), sql`${translationJobs.id} <> ${id}`));
    if (busy) throw new DalError('CONFLICT', 'This chapter already has another job in progress.');
    await tx.update(chapters).set({ status: 'processing' }).where(and(eq(chapters.id, job.chapterId), sql`${chapters.status} <> 'published'`));
    await recordAudit(tx, actor, { action: 'translation_job.retry', targetType: 'translation_job', targetId: id, metadata: { attempt: job.attempt, stage: job.stage } });
    return { id };
  });
}

/** Stop a queued or running job. The chapter returns to draft unless it's already published. */
export async function cancelJob(jobId: string) {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, jobId);
  return db().transaction(async tx => {
    const [job] = await tx.update(translationJobs).set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(eq(translationJobs.id, id), inArray(translationJobs.status, ['queued', 'running'])))
      .returning({ chapterId: translationJobs.chapterId });
    if (!job) throw new DalError('CONFLICT', 'Only queued or running jobs can be cancelled.');
    await tx.update(chapters).set({ status: 'draft' }).where(and(eq(chapters.id, job.chapterId), eq(chapters.status, 'processing')));
    await recordAudit(tx, actor, { action: 'translation_job.cancel', targetType: 'translation_job', targetId: id });
    return { id };
  });
}

/** Queue processing for an existing chapter that has pages. */
export async function queueChapter(chapterId: string, targetLanguage = 'mn') {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, chapterId);
  const target = parseInput(z.string().regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/), targetLanguage);
  return db().transaction(async tx => {
    const [ch] = await tx.select({ id: chapters.id, status: chapters.status, pageCount: chapters.pageCount, sourceLanguage: series.sourceLanguage })
      .from(chapters).innerJoin(series, eq(series.id, chapters.seriesId)).where(eq(chapters.id, id)).for('update');
    if (!ch) throw new DalError('NOT_FOUND', 'Chapter not found.');
    if (ch.status === 'published') throw new DalError('CONFLICT', 'Unpublish this chapter before reprocessing its pages.');
    if (ch.pageCount === 0) throw new DalError('CONFLICT', 'Add pages before queueing the chapter.');
    const [active] = await tx.select({ id: translationJobs.id }).from(translationJobs).where(and(eq(translationJobs.chapterId, id), inArray(translationJobs.status, ['queued', 'running'])));
    if (active) throw new DalError('CONFLICT', 'This chapter already has a job in progress.');
    const [job] = await tx.insert(translationJobs).values({ chapterId: id, sourceLanguage: ch.sourceLanguage, targetLanguage: target, requestedBy: actor.userId }).returning({ id: translationJobs.id });
    await tx.update(chapters).set({ status: 'processing' }).where(eq(chapters.id, id));
    await recordAudit(tx, actor, { action: 'translation_job.create', targetType: 'translation_job', targetId: job.id, metadata: { chapterId: id } });
    return job;
  });
}

/** Run one queued OCR → context → translation → QA job. */
export { runTranslationJob };

/* Review queue */

export type ReviewQueueItemDTO = {
  jobId: string; chapterId: string; chapterNumber: number; pageCount: number;
  series: { title: string; coverHue: number; coverUrl: string | null };
  regions: number; pending: number; flagged: number; warnings: number; avgConfidence: number | null; minConfidence: number | null;
  waitingSince: Date;
};

/** Chapters the pipeline finished that need a human pass (`chapters.status = 'in_review'`). */
export async function listReviewQueue(input: Pagination = {}): Promise<Paged<ReviewQueueItemDTO>> {
  await requireRole('translator');
  const q = parseInput(pagination, input);
  const where = and(eq(chapters.status, 'in_review'), eq(translationJobs.status, 'ready'), isNull(series.deletedAt));
  const seg = (expr: SQL) => sql`(select ${expr} from ${translationSegments} s where s.job_id = ${outer(translationJobs.id)})`;
  const [rows, [{ total }]] = await Promise.all([
    db().select({
      jobId: translationJobs.id, chapterId: chapters.id, chapterNumber: chapters.number, pageCount: chapters.pageCount,
      title: series.title, coverHue: series.coverHue, coverKey: series.coverKey, waitingSince: translationJobs.finishedAt, updatedAt: translationJobs.updatedAt,
      regions: sql<number>`${seg(sql`count(*)::int`)}`,
      pending: sql<number>`${seg(sql`count(*) filter (where s.review_status = 'pending')::int`)}`,
      flagged: sql<number>`${seg(sql`count(*) filter (where s.review_status = 'flagged')::int`)}`,
      warnings: sql<number>`${seg(sql`count(*) filter (where s.warning is not null)::int`)}`,
      avgConfidence: sql<number | null>`${seg(sql`avg(s.confidence)::float8`)}`,
      minConfidence: sql<number | null>`${seg(sql`min(s.confidence)::float8`)}`,
    })
      .from(translationJobs)
      .innerJoin(chapters, eq(chapters.id, translationJobs.chapterId))
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(where)
      .orderBy(asc(sql`coalesce(${translationJobs.finishedAt}, ${translationJobs.updatedAt})`))
      .limit(q.limit).offset(q.offset),
    db().select({ total: count() }).from(translationJobs).innerJoin(chapters, eq(chapters.id, translationJobs.chapterId)).innerJoin(series, eq(series.id, chapters.seriesId)).where(where),
  ]);
  return {
    items: rows.map(r => ({
      jobId: r.jobId, chapterId: r.chapterId, chapterNumber: r.chapterNumber, pageCount: r.pageCount,
      series: { title: r.title, coverHue: r.coverHue, coverUrl: imageSrc(r.coverKey) },
      regions: r.regions, pending: r.pending, flagged: r.flagged, warnings: r.warnings,
      avgConfidence: r.avgConfidence, minConfidence: r.minConfidence, waitingSince: r.waitingSince ?? r.updatedAt,
    })),
    total, limit: q.limit, offset: q.offset,
  };
}

export type ReviewSegmentDTO = {
  id: string; pageId: string; pageNumber: number; position: number; kind: string;
  x: number; y: number; w: number; h: number;
  sourceText: string; translatedText: string | null; confidence: number | null; ocrConfidence: number | null; translationConfidence: number | null;
  processingStatus: string; qaFlags: string[]; warning: string | null;
  reviewStatus: 'pending' | 'approved' | 'edited' | 'flagged';
};
export type ReviewJobDTO = {
  jobId: string; jobStatus: JobStatus; sourceLanguage: string; targetLanguage: string;
  chapter: { id: string; number: number; title: string | null; status: string };
  series: { title: string; slug: string };
  pages: { id: string; pageNumber: number; width: number; height: number; src: string | null; outputSrc: string | null; visualQaFlags: string[] }[];
  segments: ReviewSegmentDTO[];
};

export async function getReviewJob(jobId: string): Promise<ReviewJobDTO | null> {
  await requireRole('translator');
  const id = uuid.safeParse(jobId);
  if (!id.success) return null;
  const [job] = await db().select({
    jobId: translationJobs.id, jobStatus: translationJobs.status, sourceLanguage: translationJobs.sourceLanguage, targetLanguage: translationJobs.targetLanguage,
    chapterId: chapters.id, number: chapters.number, chapterTitle: chapters.title, chapterStatus: chapters.status, seriesTitle: series.title, slug: series.slug,
  }).from(translationJobs).innerJoin(chapters, eq(chapters.id, translationJobs.chapterId)).innerJoin(series, eq(series.id, chapters.seriesId))
    .where(eq(translationJobs.id, id.data));
  if (!job) return null;
  const [pages, segments] = await Promise.all([
    db().select({ id: chapterPages.id, pageNumber: chapterPages.pageNumber, width: chapterPages.width, height: chapterPages.height, sourceKey: chapterPages.sourceKey, outputKey: chapterPages.outputKey, visualQaFlags: chapterPages.visualQaFlags })
      .from(chapterPages).where(eq(chapterPages.chapterId, job.chapterId)).orderBy(asc(chapterPages.pageNumber)),
    db().select({
      id: translationSegments.id, pageId: translationSegments.pageId, pageNumber: chapterPages.pageNumber, position: translationSegments.position, kind: translationSegments.kind,
      x: translationSegments.x, y: translationSegments.y, w: translationSegments.w, h: translationSegments.h,
      sourceText: translationSegments.sourceText, translatedText: translationSegments.translatedText,
      confidence: translationSegments.confidence, ocrConfidence: translationSegments.ocrConfidence,
      translationConfidence: translationSegments.translationConfidence, processingStatus: translationSegments.processingStatus,
      qaFlags: translationSegments.qaFlags, warning: translationSegments.warning, reviewStatus: translationSegments.reviewStatus,
    }).from(translationSegments).innerJoin(chapterPages, eq(chapterPages.id, translationSegments.pageId))
      .where(eq(translationSegments.jobId, job.jobId)).orderBy(asc(chapterPages.pageNumber), asc(translationSegments.position)),
  ]);
  return {
    jobId: job.jobId, jobStatus: job.jobStatus, sourceLanguage: job.sourceLanguage, targetLanguage: job.targetLanguage,
    chapter: { id: job.chapterId, number: job.number, title: job.chapterTitle, status: job.chapterStatus },
    series: { title: job.seriesTitle, slug: job.slug },
    // Review shows the original upload; the typeset output (when present) is the "translated" pane.
    pages: pages.map(p => ({ id: p.id, pageNumber: p.pageNumber, width: p.width, height: p.height, src: imageSrc(p.sourceKey), outputSrc: imageSrc(p.outputKey), visualQaFlags: p.visualQaFlags })),
    segments,
  };
}

/** Approve / edit / flag one segment. Only segments of jobs still under review can change. */
export async function reviewSegment(input: ReviewSegmentInput) {
  const actor = await requireRole('translator');
  const data = parseInput(reviewSegmentInput, input);
  if (data.reviewStatus === 'edited' && !data.translatedText) throw new DalError('INVALID_INPUT', 'Edited segments need text.', { translatedText: ['Required'] });
  const [row] = await db().update(translationSegments)
    .set({ reviewStatus: data.reviewStatus, ...(data.translatedText !== undefined ? { translatedText: data.translatedText } : {}), reviewedBy: actor.userId, reviewedAt: new Date() })
    .where(and(
      eq(translationSegments.id, data.segmentId),
      sql`exists (select 1 from ${translationJobs} j join ${chapters} c on c.id = j.chapter_id where j.id = ${translationSegments.jobId} and j.status = 'ready' and c.status = 'in_review')`,
    ))
    .returning({ id: translationSegments.id, reviewStatus: translationSegments.reviewStatus });
  if (!row) throw new DalError('CONFLICT', 'This segment is no longer under review.');
  return row;
}

/** Approve every still-pending segment on one page. */
export async function approvePage(jobId: string, pageNumber: number) {
  const actor = await requireRole('translator');
  const id = parseInput(uuid, jobId);
  const n = parseInput(z.number().int().min(1).max(10_000), pageNumber);
  const rows = await db().update(translationSegments)
    .set({ reviewStatus: 'approved', reviewedBy: actor.userId, reviewedAt: new Date() })
    .where(and(
      eq(translationSegments.jobId, id),
      eq(translationSegments.reviewStatus, 'pending'),
      sql`${translationSegments.pageId} in (select p.id from ${chapterPages} p join ${translationJobs} j on j.chapter_id = p.chapter_id join ${chapters} c on c.id = j.chapter_id where j.id = ${id} and p.page_number = ${n} and j.status = 'ready' and c.status = 'in_review')`,
    ))
    .returning({ id: translationSegments.id });
  return { approved: rows.length };
}

/** Return a chapter to the pipeline for re-translation. */
export async function sendBack(jobId: string, note: string) {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, jobId);
  const reason = parseInput(z.string().trim().max(500), note);
  return db().transaction(async tx => {
    const [job] = await tx.update(translationJobs).set({ status: 'queued', stage: 'translating', stageProgress: 0, attempt: sql`${translationJobs.attempt} + 1`, finishedAt: null, startedAt: null })
      .where(and(eq(translationJobs.id, id), eq(translationJobs.status, 'ready'))).returning({ chapterId: translationJobs.chapterId });
    if (!job) throw new DalError('CONFLICT', 'Only chapters waiting for review can be sent back.');
    await tx.update(chapters).set({ status: 'processing' }).where(and(eq(chapters.id, job.chapterId), eq(chapters.status, 'in_review')));
    await recordAudit(tx, actor, { action: 'review.send_back', targetType: 'translation_job', targetId: id, metadata: { chapterId: job.chapterId, note: reason || null } });
    return { chapterId: job.chapterId };
  });
}

/** Publish a reviewed chapter. Every segment must be approved or edited. */
export async function publishReviewed(jobId: string) {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, jobId);
  return db().transaction(async tx => {
    const [job] = await tx.select({ chapterId: translationJobs.chapterId }).from(translationJobs).where(and(eq(translationJobs.id, id), eq(translationJobs.status, 'ready'))).for('update');
    if (!job) throw new DalError('NOT_FOUND', 'Review not found.');
    const [{ open }] = await tx.select({ open: count() }).from(translationSegments)
      .where(and(eq(translationSegments.jobId, id), inArray(translationSegments.reviewStatus, ['pending', 'flagged'])));
    if (open > 0) throw new DalError('CONFLICT', `${open} region${open === 1 ? '' : 's'} still need approval.`);
    const [pageCheck] = await tx.select({ total: count(), missing: sql<number>`count(*) filter (where ${chapterPages.outputKey} is null)::int`, critical: sql<number>`count(*) filter (where ${chapterPages.visualQaFlags} ?| array['cleanup_failed','cleanup_unavailable','missing_translation','overflow','clipping','outside_region','overlapping_text','unreadably_small_text','delivery_storage_failed'])::int` })
      .from(chapterPages).where(eq(chapterPages.chapterId, job.chapterId));
    const [segmentBlockers] = await tx.select({ count: count() }).from(translationSegments).where(and(
      eq(translationSegments.jobId, id),
      sql`${translationSegments.qaFlags} ?| array['empty_translation','untranslated_text','malformed_output']`,
    ));
    if (pageCheck.missing || pageCheck.critical || segmentBlockers.count) throw new DalError('CONFLICT', 'Critical visual QA failures remain. Re-run the chapter with image cleanup configured and resolve all flagged text before publishing.');
    const [ch] = await tx.update(chapters).set({ status: 'published', publishedAt: new Date() })
      .where(and(eq(chapters.id, job.chapterId), eq(chapters.status, 'in_review')))
      .returning({ id: chapters.id, seriesId: chapters.seriesId, number: chapters.number });
    if (!ch) throw new DalError('CONFLICT', 'This chapter isn’t waiting for review.');
    await tx.update(translationJobs).set({ stage: 'published', stageProgress: 100 }).where(eq(translationJobs.id, id));
    const href = await notifyFollowers(tx, ch);
    await recordAudit(tx, actor, { action: 'review.publish', targetType: 'chapter', targetId: ch.id, metadata: { jobId: id, number: ch.number } });
    return { chapterId: ch.id, href };
  });
}
