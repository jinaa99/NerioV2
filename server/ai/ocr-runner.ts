import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Actor } from '@/server/auth/actor';
import { db } from '@/server/db/client';
import { chapterPages, chapters, translationJobLogs, translationJobs, translationSegments } from '@/server/db/schema';
import { serverEnv } from '@/server/env';
import { DalError } from '@/server/errors';
import { recordAudit } from '@/server/data/audit';
import { rasterize } from './bubbles';
import { refreshChapterState } from './finalize';
import { readingDirection, readingOrder } from './ocr-layout';
import { getOCRProvider, type OCRProvider } from './providers';
import { groupByBalloon, loadPage } from './runner';
import { isWatermark } from './segments';

/**
 * Manual workflow background job: OCR every page of an uploaded chapter into ordered text segments, then hand the
 * chapter to the human translator. Pages are OCR'd independently and marked done one by one, so a retry only
 * re-reads pages that failed or never ran, and a page that already has typed translations is never touched.
 */

type PageRow = { id: string; pageNumber: number; sourceKey: string };
type JobRow = { id: string; sourceLanguage: string };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** OCR one page and store its segments. Returns the number of segments, or null when the page was left alone. */
export async function ocrPage(job: JobRow, page: PageRow, provider: OCRProvider = getOCRProvider()): Promise<number | null> {
  const { bytes } = await loadPage(page.sourceKey);
  const regions = (await provider.recognize(bytes, job.sourceLanguage)).filter(region => region.text.trim() && !isWatermark(region.text));
  // Decoding a tall strip is the slow part; a page with nothing found (or OCR_PROVIDER=none) doesn't need it.
  const merged = regions.length ? groupByBalloon(await rasterize(bytes), regions).map(group => group.region) : [];
  const ordered = readingOrder(merged, readingDirection(job.sourceLanguage));
  return db().transaction(async tx => {
    const [locked] = await tx.select({ id: chapterPages.id }).from(chapterPages).where(eq(chapterPages.id, page.id)).for('update');
    if (!locked) return null;
    const [typed] = await tx.select({ id: translationSegments.id }).from(translationSegments)
      .where(and(eq(translationSegments.pageId, page.id), sql`coalesce(btrim(${translationSegments.translatedText}), '') <> ''`)).limit(1);
    // Manual work is never overwritten by a re-run.
    if (typed) { await tx.update(chapterPages).set({ ocrStatus: 'done', ocrError: null }).where(eq(chapterPages.id, page.id)); return null; }
    await tx.delete(translationSegments).where(eq(translationSegments.pageId, page.id));
    if (ordered.length) {
      await tx.insert(translationSegments).values(ordered.map((region, index) => {
        const x = clamp01(region.x), y = clamp01(region.y);
        return {
          jobId: job.id, pageId: page.id, position: index + 1, kind: region.kind,
          x, y, w: Math.max(0.001, Math.min(1 - x, region.w)), h: Math.max(0.001, Math.min(1 - y, region.h)),
          sourceText: region.text.trim(), ocrConfidence: clamp01(region.confidence), detectedLanguage: region.language ?? job.sourceLanguage,
          origin: 'ocr', processingStatus: 'ocr_complete', translationStatus: 'pending', typesetStatus: 'pending',
        };
      }));
    }
    // A re-OCR'd page's previous final image no longer matches its segments.
    await tx.update(chapterPages).set({ ocrStatus: 'done', ocrError: null, editVersion: sql`${chapterPages.editVersion} + 1`, outputKey: null, outputBytes: null, visualQaFlags: [] })
      .where(eq(chapterPages.id, page.id));
    return ordered.length;
  });
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

export async function runOcrJobAs(actor: Actor | null, jobId: string) {
  const claimed = await db().transaction(async tx => {
    const [job] = await tx.select({ id: translationJobs.id, chapterId: translationJobs.chapterId, attempt: translationJobs.attempt, sourceLanguage: translationJobs.sourceLanguage })
      .from(translationJobs).where(and(eq(translationJobs.id, jobId), eq(translationJobs.status, 'queued'), eq(translationJobs.workflow, 'manual'))).for('update');
    if (!job) throw new DalError('CONFLICT', 'Only queued OCR jobs can be run.');
    await tx.update(translationJobs).set({ status: 'running', stage: 'validating', stageProgress: 0, startedAt: new Date(), finishedAt: null, errorCode: null, errorMessage: null }).where(eq(translationJobs.id, job.id));
    await tx.update(chapters).set({ status: 'processing' }).where(and(eq(chapters.id, job.chapterId), sql`${chapters.status} <> 'published'`));
    await tx.insert(translationJobLogs).values({ jobId: job.id, attempt: job.attempt, stage: 'validating', message: 'OCR attempt started.' });
    return job;
  });
  const stillRunning = async (progress: number) => {
    const [row] = await db().update(translationJobs).set({ stage: 'ocr', stageProgress: Math.min(100, Math.max(0, Math.round(progress))) })
      .where(and(eq(translationJobs.id, claimed.id), eq(translationJobs.status, 'running'))).returning({ id: translationJobs.id });
    return !!row;
  };
  try {
    const pages = await db().select({ id: chapterPages.id, pageNumber: chapterPages.pageNumber, sourceKey: chapterPages.sourceKey, ocrStatus: chapterPages.ocrStatus })
      .from(chapterPages).where(eq(chapterPages.chapterId, claimed.chapterId)).orderBy(asc(chapterPages.pageNumber));
    if (!pages.length) throw new Error('This chapter has no pages to OCR.');
    const todo = pages.filter(page => page.ocrStatus !== 'done');
    let done = pages.length - todo.length; let segments = 0; let cancelled = false;
    const failed: { pageNumber: number; message: string }[] = [];
    await stillRunning((done / pages.length) * 100);
    await db().insert(translationJobLogs).values({ jobId: claimed.id, attempt: claimed.attempt, stage: 'ocr', message: `OCR of ${todo.length} page${todo.length === 1 ? '' : 's'} started (${serverEnv().OCR_PROVIDER}).` });
    const provider = getOCRProvider();
    await pool(todo, serverEnv().OCR_WORKERS, async page => {
      if (cancelled) return;
      try { segments += (await ocrPage(claimed, page, provider)) ?? 0; }
      catch (error) {
        const message = (error instanceof Error ? error.message : 'OCR failed.').slice(0, 500);
        failed.push({ pageNumber: page.pageNumber, message });
        await db().update(chapterPages).set({ ocrStatus: 'failed', ocrError: message }).where(eq(chapterPages.id, page.id));
      }
      if (!(await stillRunning((++done / pages.length) * 100))) cancelled = true;
    });
    if (cancelled) return { id: claimed.id, cancelled: true };
    const allFailed = failed.length === todo.length && todo.length > 0;
    await db().transaction(async tx => {
      const [job] = await tx.select({ id: translationJobs.id }).from(translationJobs).where(and(eq(translationJobs.id, claimed.id), eq(translationJobs.status, 'running'))).for('update');
      if (!job) return;
      if (failed.length) {
        const pagesList = failed.map(f => f.pageNumber).sort((a, b) => a - b).join(', ');
        const message = `OCR failed on page${failed.length === 1 ? '' : 's'} ${pagesList}. Retry to re-read only those pages.`;
        await tx.update(translationJobs).set({ status: 'failed', stage: 'failed', stageProgress: 0, errorCode: 'ocr_failed', errorMessage: message.slice(0, 500), finishedAt: new Date() }).where(eq(translationJobs.id, claimed.id));
        await tx.insert(translationJobLogs).values({ jobId: claimed.id, attempt: claimed.attempt, stage: 'failed', level: 'error', message: message.slice(0, 500), details: { failedAtStage: 'ocr', pages: failed } });
        // Pages that were read can already be translated while the failed ones are retried.
        await tx.update(chapters).set({ status: allFailed ? 'failed' : 'in_review' }).where(and(eq(chapters.id, claimed.chapterId), eq(chapters.status, 'processing')));
        await recordAudit(tx, actor, { action: 'translation_job.fail', targetType: 'translation_job', targetId: claimed.id, metadata: { chapterId: claimed.chapterId, workflow: 'manual', failedPages: failed.length } });
        return;
      }
      await tx.update(translationJobs).set({ status: 'ready', stage: 'translating', stageProgress: 0, finishedAt: new Date() }).where(eq(translationJobs.id, claimed.id));
      await tx.update(chapters).set({ status: 'in_review' }).where(and(eq(chapters.id, claimed.chapterId), eq(chapters.status, 'processing')));
      await tx.insert(translationJobLogs).values({ jobId: claimed.id, attempt: claimed.attempt, stage: 'ocr', message: `OCR complete: ${segments} new text segment${segments === 1 ? '' : 's'} on ${todo.length} page${todo.length === 1 ? '' : 's'}. Waiting for manual translation.` });
      await recordAudit(tx, actor, { action: 'translation_job.ocr_complete', targetType: 'translation_job', targetId: claimed.id, metadata: { chapterId: claimed.chapterId, workflow: 'manual', segments } });
    });
    await refreshChapterState(claimed.chapterId, actor);
    return { id: claimed.id, segments, failedPages: failed.length };
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'OCR job failed.').slice(0, 500);
    await db().transaction(async tx => {
      const [failedJob] = await tx.update(translationJobs).set({ status: 'failed', stage: 'failed', stageProgress: 0, errorCode: 'ocr_failed', errorMessage: message, finishedAt: new Date() })
        .where(and(eq(translationJobs.id, claimed.id), eq(translationJobs.status, 'running'))).returning({ id: translationJobs.id });
      if (!failedJob) return;
      await tx.insert(translationJobLogs).values({ jobId: claimed.id, attempt: claimed.attempt, stage: 'failed', level: 'error', message, details: { failedAtStage: 'ocr' } });
      await tx.update(chapters).set({ status: 'failed' }).where(and(eq(chapters.id, claimed.chapterId), eq(chapters.status, 'processing')));
    });
    throw new DalError('CONFLICT', message);
  }
}
