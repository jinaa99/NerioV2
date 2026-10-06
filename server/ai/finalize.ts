import 'server-only';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Actor } from '@/server/auth/actor';
import { db, type Executor } from '@/server/db/client';
import { chapterPages, chapters, translationJobLogs, translationJobs, translationSegments } from '@/server/db/schema';
import { serverEnv } from '@/server/env';
import { deleteImage, imageExists, putDeliveryImage } from '@/server/storage';
import { recordAudit } from '@/server/data/audit';
import { notifyFollowers } from '@/server/data/catalog';
import { getSettings } from '@/server/data/settings';
import { evaluateChapter, shouldAutoPublish, type ChapterEvaluation, type PageState, type SegmentState } from '@/lib/manual-translation';
import { resolveStyle } from '@/lib/typeset-style';
import { createJobQueue } from './job-queue';
import { loadPage } from './runner';
import { isUppercase, sourceLineCount } from './segments';
import { envTypesetStyle, renderMongolianText, type TypesetFlag } from './typesetting';

/**
 * Manual workflow, after a human saves translations: letter the page's saved translations into a separate final
 * image (the uploaded original is never modified), track whether every page is final, and move the chapter through
 * FINALIZATION → READY_TO_PUBLISH (→ published when AUTO_PUBLISH_TRANSLATED_CHAPTERS is on).
 */

/** Typesetting problems that need a human look before the page can ship. */
const REVIEW_FLAGS: TypesetFlag[] = ['overflow', 'clipping', 'overlapping_text', 'unreadably_small_text', 'outside_region'];

const renderQueue = createJobQueue<{ pageId: string; actor: Actor | null }>('page-render', () => serverEnv().FINALIZE_CONCURRENCY, ({ pageId, actor }) => finalizePage(pageId, actor));

/** Mark pages as needing a fresh final image and render them in the background (coalesced per page). */
export async function requestPageRender(pageIds: string[], actor: Actor | null): Promise<Promise<void>> {
  const ids = [...new Set(pageIds)];
  if (!ids.length) return Promise.resolve();
  await db().update(chapterPages).set({ renderStatus: 'queued', renderError: null }).where(and(inArray(chapterPages.id, ids), ne(chapterPages.renderStatus, 'rendering')));
  return renderQueue.enqueue(ids.map(pageId => ({ key: pageId, payload: { pageId, actor } })), { rerun: true }).done;
}

export const renderPending = (pageId: string) => renderQueue.has(pageId);

/** Latest manual-workflow job of a chapter (its id owns the segments). */
export async function manualJobFor(tx: Executor, chapterId: string) {
  const [job] = await tx.select({ id: translationJobs.id, status: translationJobs.status, stage: translationJobs.stage, attempt: translationJobs.attempt, options: translationJobs.options })
    .from(translationJobs).where(and(eq(translationJobs.chapterId, chapterId), eq(translationJobs.workflow, 'manual'))).orderBy(desc(translationJobs.createdAt)).limit(1);
  return job ?? null;
}

const deliveryKey = (chapterId: string, attempt: number, pageNumber: number, version: number) =>
  `chapters/${chapterId}/delivery-${attempt % 10000}-${String(pageNumber).padStart(4, '0')}-${String(version % 10000).padStart(4, '0')}.png`;

/** Render one page's final image from its saved translations. Idempotent: the result is keyed by the page's edit version. */
export async function finalizePage(pageId: string, actor: Actor | null): Promise<void> {
  const [page] = await db().update(chapterPages).set({ renderStatus: 'rendering' }).where(eq(chapterPages.id, pageId))
    .returning({ id: chapterPages.id, chapterId: chapterPages.chapterId, pageNumber: chapterPages.pageNumber, sourceKey: chapterPages.sourceKey,
      outputKey: chapterPages.outputKey, version: chapterPages.editVersion, width: chapterPages.width, height: chapterPages.height });
  if (!page) return;
  const job = await manualJobFor(db(), page.chapterId);
  if (!job) { await db().update(chapterPages).set({ renderStatus: 'failed', renderError: 'This chapter has no manual translation job.' }).where(eq(chapterPages.id, pageId)); return; }
  const segments = await db().select({ id: translationSegments.id, x: translationSegments.x, y: translationSegments.y, w: translationSegments.w, h: translationSegments.h,
    sourceText: translationSegments.sourceText, corrected: translationSegments.correctedSourceText, text: translationSegments.translatedText,
    translationStatus: translationSegments.translationStatus, typesetStatus: translationSegments.typesetStatus, style: translationSegments.style })
    .from(translationSegments).where(eq(translationSegments.pageId, pageId)).orderBy(asc(translationSegments.position));
  const lettered = segments.filter(s => (s.translationStatus === 'translated' || s.translationStatus === 'approved') && s.text?.trim());
  let newKey: string | null = null;
  try {
    let output: { key: string; bytes: number } | null = null;
    const pageFlags = new Set<string>();
    const segmentResults = new Map<string, { status: 'rendered' | 'needs_review' | 'failed'; flags: string[] }>();
    if (lettered.length) {
      const master = await loadPage(page.sourceKey);
      const settings = await getSettings();
      const base = resolveStyle(envTypesetStyle(settings.typesetFont), job.options.style as Record<string, unknown> | undefined);
      const result = await renderMongolianText(master.bytes, lettered.map(s => {
        const source = s.corrected ?? s.sourceText;
        return { id: s.id, x: s.x, y: s.y, w: s.w, h: s.h, text: s.text!, uppercase: isUppercase(source), sourceLines: sourceLineCount(source), style: resolveStyle(base, s.style) };
      }), { style: base });
      for (const s of lettered) {
        const flags: string[] = [...(result.flags.get(s.id) ?? [])];
        if (result.removal.get(s.id) === 'needs_review') flags.push('needs_image_review');
        const status = flags.includes('missing_glyph') ? 'failed' : flags.some(flag => flag === 'needs_image_review' || REVIEW_FLAGS.includes(flag as TypesetFlag)) ? 'needs_review' : 'rendered';
        segmentResults.set(s.id, { status, flags });
        flags.forEach(flag => pageFlags.add(flag));
      }
      newKey = deliveryKey(page.chapterId, job.attempt, page.pageNumber, page.version);
      // A leftover from an interrupted render of this exact version is replaced, never duplicated.
      if (newKey !== page.outputKey) await deleteImage(newKey);
      await putDeliveryImage(newKey, result.image);
      output = { key: newKey, bytes: result.image.length };
    }
    const committed = await db().transaction(async tx => {
      const [current] = await tx.select({ editVersion: chapterPages.editVersion, outputKey: chapterPages.outputKey }).from(chapterPages).where(eq(chapterPages.id, pageId)).for('update');
      if (!current) return null;
      const stale = current.editVersion !== page.version;
      await tx.update(chapterPages).set({ outputKey: output?.key ?? null, outputBytes: output?.bytes ?? null, visualQaFlags: [...pageFlags], renderedVersion: page.version,
        renderStatus: stale ? 'queued' : 'idle', renderError: null }).where(eq(chapterPages.id, pageId));
      for (const s of segments) {
        const result = segmentResults.get(s.id);
        // An admin's "looks good" on a lettering warning stands until the segment itself changes.
        const typesetStatus = !result ? 'pending' : s.typesetStatus === 'accepted' && result.status === 'needs_review' ? 'accepted' : result.status;
        await tx.update(translationSegments).set({ typesetStatus, qaFlags: result?.flags ?? [], warning: result?.flags.length ? result.flags.join(', ') : null })
          .where(eq(translationSegments.id, s.id));
      }
      return { previous: current.outputKey, stale };
    });
    if (committed?.previous && committed.previous !== output?.key) await deleteImage(committed.previous);
    if (committed?.stale) renderQueue.enqueue([{ key: pageId, payload: { pageId, actor } }], { rerun: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Final image could not be rendered.';
    console.error(`[finalize] page ${pageId} failed:`, message);
    const [current] = await db().select({ outputKey: chapterPages.outputKey }).from(chapterPages).where(eq(chapterPages.id, pageId));
    if (newKey && current?.outputKey !== newKey) await deleteImage(newKey);
    await db().update(chapterPages).set({ renderStatus: 'failed', renderError: message }).where(eq(chapterPages.id, pageId));
  }
  await refreshChapterState(page.chapterId, actor);
}

/** Durable page/segment state of a chapter in the shape the pure evaluation rules use. */
export async function chapterState(tx: Executor, chapterId: string, jobId: string) {
  const [pages, segments] = await Promise.all([
    tx.select({ id: chapterPages.id, pageNumber: chapterPages.pageNumber, ocrStatus: chapterPages.ocrStatus, editVersion: chapterPages.editVersion,
      renderedVersion: chapterPages.renderedVersion, renderStatus: chapterPages.renderStatus, outputKey: chapterPages.outputKey })
      .from(chapterPages).where(eq(chapterPages.chapterId, chapterId)).orderBy(asc(chapterPages.pageNumber)),
    tx.select({ id: translationSegments.id, pageId: translationSegments.pageId, translationStatus: translationSegments.translationStatus, typesetStatus: translationSegments.typesetStatus })
      .from(translationSegments).where(eq(translationSegments.jobId, jobId)),
  ]);
  const pageStates: PageState[] = pages.map(p => ({ ...p, ocrStatus: p.ocrStatus as PageState['ocrStatus'], renderStatus: p.renderStatus as PageState['renderStatus'], hasOutput: !!p.outputKey }));
  const evaluation = evaluateChapter(pageStates, segments as SegmentState[], !serverEnv().MANUAL_TRANSLATION_AUTO_APPROVE);
  return { pages, evaluation };
}

/** Publish a fully finalized manual chapter inside `tx`. Throws with the blocking reasons otherwise. */
export async function publishFinalizedChapter(tx: Executor, chapterId: string, actor: Actor | null, auto: boolean) {
  const [chapter] = await tx.select({ id: chapters.id, status: chapters.status, seriesId: chapters.seriesId, number: chapters.number, pageCount: chapters.pageCount })
    .from(chapters).where(eq(chapters.id, chapterId)).for('update');
  if (!chapter) throw new PublishBlocked(['Chapter not found.']);
  if (chapter.status === 'published') throw new PublishBlocked(['This chapter is already published.']);
  const job = await manualJobFor(tx, chapterId);
  if (!job || job.status !== 'ready') throw new PublishBlocked(['OCR has not finished for this chapter.']);
  const { pages, evaluation } = await chapterState(tx, chapterId, job.id);
  const blocking = [...evaluation.blocking];
  if (pages.length !== chapter.pageCount) blocking.push('Some chapter pages are missing.');
  for (const page of pages) if (page.outputKey && !(await imageExists(page.outputKey))) blocking.push(`Final image of page ${page.pageNumber} is missing from storage.`);
  if (blocking.length || !evaluation.complete) throw new PublishBlocked(blocking.length ? blocking : ['The chapter is not fully finalized.']);
  await tx.update(chapters).set({ status: 'published', publishedAt: new Date() }).where(eq(chapters.id, chapterId));
  await tx.update(translationJobs).set({ stage: 'published', stageProgress: 100 }).where(eq(translationJobs.id, job.id));
  await tx.insert(translationJobLogs).values({ jobId: job.id, attempt: job.attempt, stage: 'published', message: auto ? 'Chapter published automatically after every page was translated and finalized.' : 'Chapter published after final review.' });
  const href = await notifyFollowers(tx, chapter);
  await recordAudit(tx, actor, { action: auto ? 'chapter.auto_publish' : 'chapter.publish', targetType: 'chapter', targetId: chapterId, metadata: { jobId: job.id, workflow: 'manual', pages: pages.length, segments: evaluation.segments } });
  return { chapterId, href };
}

export class PublishBlocked extends Error {
  constructor(readonly reasons: string[]) { super(reasons.join(' ')); }
}

/**
 * Move a manual chapter between TRANSLATION (in_review) → FINALIZATION → READY_TO_PUBLISH (ready) based on the
 * durable page/segment state; auto-publish when configured. Safe to call any number of times.
 */
export async function refreshChapterState(chapterId: string, actor: Actor | null): Promise<ChapterEvaluation | null> {
  return db().transaction(async tx => {
    const [chapter] = await tx.select({ status: chapters.status }).from(chapters).where(eq(chapters.id, chapterId)).for('update');
    const job = await manualJobFor(tx, chapterId);
    if (!chapter || !job || job.status !== 'ready' || !['in_review', 'ready'].includes(chapter.status)) return null;
    const { evaluation } = await chapterState(tx, chapterId, job.id);
    const stage = evaluation.complete ? 'ready' : evaluation.segments > 0 && evaluation.remaining === 0 ? 'typesetting' : 'translating';
    if (job.stage !== stage) await tx.update(translationJobs).set({ stage, stageProgress: evaluation.percent }).where(eq(translationJobs.id, job.id));
    else await tx.update(translationJobs).set({ stageProgress: evaluation.percent }).where(and(eq(translationJobs.id, job.id), sql`${translationJobs.stageProgress} <> ${evaluation.percent}`));
    if (evaluation.complete && chapter.status === 'in_review') {
      await tx.update(chapters).set({ status: 'ready' }).where(eq(chapters.id, chapterId));
      await tx.insert(translationJobLogs).values({ jobId: job.id, attempt: job.attempt, stage: 'ready', message: `All ${evaluation.pages} pages translated and finalized; ready to publish.` });
      if (shouldAutoPublish(serverEnv().AUTO_PUBLISH_TRANSLATED_CHAPTERS, evaluation)) {
        try { await tx.transaction(inner => publishFinalizedChapter(inner, chapterId, actor, true)); }
        catch (error) {
          if (!(error instanceof PublishBlocked)) throw error;
          await tx.insert(translationJobLogs).values({ jobId: job.id, attempt: job.attempt, stage: 'ready', level: 'warning', message: 'Auto-publish skipped: final validation failed.', details: { reasons: error.reasons } });
        }
      }
    } else if (!evaluation.complete && chapter.status === 'ready') {
      await tx.update(chapters).set({ status: 'in_review' }).where(eq(chapters.id, chapterId));
    }
    return evaluation;
  });
}

/** Whether a chapter in the manual workflow may be published by the generic chapter screens. */
export async function manualPublishBlocker(tx: Executor, chapterId: string): Promise<string | null> {
  const job = await manualJobFor(tx, chapterId);
  if (!job) return null;
  if (job.status !== 'ready') return 'This chapter is still in the manual translation workflow (OCR not finished).';
  const { evaluation } = await chapterState(tx, chapterId, job.id);
  return evaluation.complete ? null : `This chapter is not fully translated and finalized: ${evaluation.blocking.join(' ')}`;
}
