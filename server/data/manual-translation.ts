import 'server-only';
/**
 * Manual translation workflow: batch dashboard, OCR review, the translation workspace and publishing.
 * Translations are typed by a human and only ever written by these functions; nothing here calls a translation API.
 * Every function checks the caller's role; publishing is audited.
 */
import { createHash, randomInt } from 'node:crypto';
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
import { typesetStyleOverride } from '@/lib/typeset-style';
import { canRerunOcr, type ChapterEvaluation } from '@/lib/manual-translation';
import { requireRole, type Actor } from '../auth/actor';
import { db, type Executor } from '../db/client';
import { chapterPages, chapters, series, translationJobLogs, translationJobs, translationSegments } from '../db/schema';
import { DalError, parseInput } from '../errors';
import { serverEnv } from '../env';
import { deleteImage, imageSrc, putImage } from '../storage';
import { getSettings } from './settings';
import { chapterState, manualJobFor, PublishBlocked, publishFinalizedChapter, refreshChapterState, renderPending, requestPageRender } from '../ai/finalize';
import { ocrPage } from '../ai/ocr-runner';
import { encodeRaster, rasterize, toPixels } from '../ai/bubbles';
import { cutRows, eraseArea, regionAfterCut } from '../ai/page-edit';
import { loadPage } from '../ai/runner';
import { enqueueTranslationJobs, queuedOrRunning } from '../ai/worker';

const text = (maxLength: number) => z.string().max(maxLength).transform(value => value.replace(/\r\n?/g, '\n'));
const box = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) })
  .refine(b => b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, 'The region must stay inside the page.');

/* Batch dashboard */

export type BatchChapterDTO = {
  jobId: string; chapterId: string; chapterNumber: number; chapterStatus: string; filename: string | null;
  series: { id: string; title: string };
  job: { status: string; stage: string; stageProgress: number; attempt: number; errorMessage: string | null; createdAt: Date };
  pages: number; ocrDone: number; ocrFailed: number; pagesFinal: number;
  segments: number; translated: number; drafts: number; needsReview: number;
};

/** Every chapter uploaded for manual translation, newest first. Recovers OCR jobs orphaned by a server restart. */
export async function listBatchChapters(limit = 100): Promise<BatchChapterDTO[]> {
  const actor = await requireRole('editor');
  const approval = !serverEnv().MANUAL_TRANSLATION_AUTO_APPROVE;
  const rows = await db().select({
    jobId: translationJobs.id, chapterId: chapters.id, chapterNumber: chapters.number, chapterStatus: chapters.status, options: translationJobs.options,
    seriesId: series.id, seriesTitle: series.title, status: translationJobs.status, stage: translationJobs.stage, stageProgress: translationJobs.stageProgress,
    attempt: translationJobs.attempt, errorMessage: translationJobs.errorMessage, createdAt: translationJobs.createdAt, updatedAt: translationJobs.updatedAt, pages: chapters.pageCount,
    ocrDone: sql<number>`(select count(*)::int from ${chapterPages} p where p.chapter_id = ${chapters.id} and p.ocr_status = 'done')`,
    ocrFailed: sql<number>`(select count(*)::int from ${chapterPages} p where p.chapter_id = ${chapters.id} and p.ocr_status = 'failed')`,
    pagesFinal: sql<number>`(select count(*)::int from ${chapterPages} p where p.chapter_id = ${chapters.id} and p.ocr_status = 'done' and p.rendered_version >= p.edit_version and p.render_status <> 'failed'
      and not exists (select 1 from ${translationSegments} s where s.page_id = p.id and (s.translation_status not in ${approval ? sql`('approved')` : sql`('translated', 'approved')`} or s.typeset_status not in ('rendered', 'accepted'))))`,
    segments: sql<number>`(select count(*)::int from ${translationSegments} s where s.job_id = ${translationJobs.id})`,
    translated: sql<number>`(select count(*)::int from ${translationSegments} s where s.job_id = ${translationJobs.id} and s.translation_status in ${approval ? sql`('approved')` : sql`('translated', 'approved')`})`,
    drafts: sql<number>`(select count(*)::int from ${translationSegments} s where s.job_id = ${translationJobs.id} and s.translation_status = 'draft')`,
    needsReview: sql<number>`(select count(*)::int from ${translationSegments} s where s.job_id = ${translationJobs.id} and s.typeset_status in ('needs_review', 'failed'))`,
  }).from(translationJobs).innerJoin(chapters, eq(chapters.id, translationJobs.chapterId)).innerJoin(series, eq(series.id, chapters.seriesId))
    .where(eq(translationJobs.workflow, 'manual')).orderBy(desc(translationJobs.createdAt), asc(chapters.number)).limit(Math.min(500, Math.max(1, limit)));
  await recoverOrphans(actor, rows);
  return rows.map(r => ({
    jobId: r.jobId, chapterId: r.chapterId, chapterNumber: r.chapterNumber, chapterStatus: r.chapterStatus,
    filename: typeof r.options.sourceFilename === 'string' ? r.options.sourceFilename : null,
    series: { id: r.seriesId, title: r.seriesTitle },
    job: { status: r.status, stage: r.stage, stageProgress: r.stageProgress, attempt: r.attempt, errorMessage: r.errorMessage, createdAt: r.createdAt },
    pages: r.pages, ocrDone: r.ocrDone, ocrFailed: r.ocrFailed, pagesFinal: r.pagesFinal, segments: r.segments, translated: r.translated, drafts: r.drafts, needsReview: r.needsReview,
  }));
}

/**
 * The in-process queues are lost when the server restarts. Running OCR jobs nobody is processing go back to the
 * queue (pages already read are kept), and queued jobs are started, unless the pipeline is paused.
 */
async function recoverOrphans(actor: Actor, rows: { jobId: string; status: string; updatedAt: Date }[]) {
  if ((await getSettings()).pausePipeline) return;
  const stale = rows.filter(r => r.status === 'running' && !queuedOrRunning(r.jobId) && Date.now() - r.updatedAt.getTime() > 120_000).map(r => r.jobId);
  if (stale.length) await db().update(translationJobs).set({ status: 'queued' }).where(and(inArray(translationJobs.id, stale), eq(translationJobs.status, 'running')));
  const waiting = [...rows.filter(r => r.status === 'queued' && !queuedOrRunning(r.jobId)).map(r => r.jobId), ...stale];
  if (waiting.length) await enqueueTranslationJobs(actor, waiting);
}

/** Start queued OCR jobs (or retry failed ones first via the pipeline's retry). */
export async function startBatchJobs(jobIds: string[]) {
  const actor = await requireRole('editor');
  const ids = parseInput(z.array(uuid).max(200), jobIds);
  if ((await getSettings()).pausePipeline) throw new DalError('CONFLICT', 'The pipeline is paused in Settings.');
  const rows = await db().select({ id: translationJobs.id }).from(translationJobs).where(and(inArray(translationJobs.id, ids), eq(translationJobs.status, 'queued'), eq(translationJobs.workflow, 'manual')));
  const { accepted } = await enqueueTranslationJobs(actor, rows.map(r => r.id));
  return { started: accepted.length };
}

/* Workspace */

export type WorkspacePageDTO = {
  id: string; pageNumber: number; width: number; height: number; src: string | null; outputSrc: string | null;
  ocrStatus: 'pending' | 'done' | 'failed'; ocrError: string | null; editVersion: number; renderedVersion: number;
  renderStatus: 'idle' | 'queued' | 'rendering' | 'failed'; renderError: string | null; visualQaFlags: string[]; hasOutput: boolean;
};
export type WorkspaceSegmentDTO = {
  id: string; pageId: string; position: number; x: number; y: number; w: number; h: number;
  sourceText: string; correctedSourceText: string | null; translatedText: string | null; ocrConfidence: number | null; detectedLanguage: string | null;
  origin: string; translationStatus: 'pending' | 'draft' | 'translated' | 'approved' | 'failed';
  typesetStatus: 'pending' | 'rendered' | 'needs_review' | 'accepted' | 'failed'; qaFlags: string[]; style: Record<string, unknown>; updatedAt: Date;
};
export type WorkspaceDTO = {
  chapter: { id: string; number: number; title: string | null; status: string; pageCount: number };
  series: { id: string; title: string; slug: string; coverUrl: string | null; coverHue: number };
  job: { id: string; status: string; stage: string; stageProgress: number; errorMessage: string | null; sourceLanguage: string; targetLanguage: string };
  pages: WorkspacePageDTO[]; segments: WorkspaceSegmentDTO[];
  evaluation: ChapterEvaluation; requireApproval: boolean; autoPublish: boolean;
};
export type WorkspaceStatusDTO = Omit<WorkspaceDTO, 'series' | 'segments' | 'requireApproval' | 'autoPublish'> & {
  segments: Pick<WorkspaceSegmentDTO, 'id' | 'typesetStatus' | 'qaFlags' | 'translationStatus'>[];
};

const pageColumns = {
  id: chapterPages.id, pageNumber: chapterPages.pageNumber, width: chapterPages.width, height: chapterPages.height, sourceKey: chapterPages.sourceKey, outputKey: chapterPages.outputKey,
  ocrStatus: chapterPages.ocrStatus, ocrError: chapterPages.ocrError, editVersion: chapterPages.editVersion, renderedVersion: chapterPages.renderedVersion,
  renderStatus: chapterPages.renderStatus, renderError: chapterPages.renderError, visualQaFlags: chapterPages.visualQaFlags,
};
type PageRow = {
  id: string; pageNumber: number; width: number; height: number; sourceKey: string; outputKey: string | null; ocrStatus: string; ocrError: string | null;
  editVersion: number; renderedVersion: number; renderStatus: string; renderError: string | null; visualQaFlags: string[];
};
const toPage = (p: PageRow): WorkspacePageDTO => ({
  id: p.id, pageNumber: p.pageNumber, width: p.width, height: p.height, src: imageSrc(p.sourceKey), outputSrc: imageSrc(p.outputKey),
  ocrStatus: p.ocrStatus as WorkspacePageDTO['ocrStatus'], ocrError: p.ocrError, editVersion: p.editVersion, renderedVersion: p.renderedVersion,
  renderStatus: p.renderStatus as WorkspacePageDTO['renderStatus'], renderError: p.renderError, visualQaFlags: p.visualQaFlags, hasOutput: !!p.outputKey,
});

async function loadChapter(chapterId: string) {
  const id = uuid.safeParse(chapterId);
  if (!id.success) return null;
  const [chapter] = await db().select({ id: chapters.id, number: chapters.number, title: chapters.title, status: chapters.status, pageCount: chapters.pageCount,
    seriesId: series.id, seriesTitle: series.title, slug: series.slug, coverKey: series.coverKey, coverHue: series.coverHue })
    .from(chapters).innerJoin(series, eq(series.id, chapters.seriesId)).where(eq(chapters.id, id.data));
  if (!chapter) return null;
  const [job] = await db().select({ id: translationJobs.id, status: translationJobs.status, stage: translationJobs.stage, stageProgress: translationJobs.stageProgress,
    errorMessage: translationJobs.errorMessage, sourceLanguage: translationJobs.sourceLanguage, targetLanguage: translationJobs.targetLanguage })
    .from(translationJobs).where(and(eq(translationJobs.chapterId, chapter.id), eq(translationJobs.workflow, 'manual'))).orderBy(desc(translationJobs.createdAt)).limit(1);
  return job ? { chapter, job } : null;
}

/** Pages whose final image is stale but nothing is rendering them (e.g. after a restart) are queued again. */
async function resumeRenders(actor: Actor, pages: PageRow[]) {
  const stuck = pages.filter(p => p.ocrStatus === 'done' && p.renderStatus !== 'failed' && (p.renderedVersion < p.editVersion || p.renderStatus !== 'idle') && !renderPending(p.id));
  if (stuck.length) await requestPageRender(stuck.map(p => p.id), actor);
}

export async function getWorkspace(chapterId: string): Promise<WorkspaceDTO | null> {
  const actor = await requireRole('translator');
  const loaded = await loadChapter(chapterId);
  if (!loaded) return null;
  const { chapter, job } = loaded;
  const [pages, segments] = await Promise.all([
    db().select(pageColumns).from(chapterPages).where(eq(chapterPages.chapterId, chapter.id)).orderBy(asc(chapterPages.pageNumber)),
    db().select({
      id: translationSegments.id, pageId: translationSegments.pageId, position: translationSegments.position, x: translationSegments.x, y: translationSegments.y, w: translationSegments.w, h: translationSegments.h,
      sourceText: translationSegments.sourceText, correctedSourceText: translationSegments.correctedSourceText, translatedText: translationSegments.translatedText,
      ocrConfidence: translationSegments.ocrConfidence, detectedLanguage: translationSegments.detectedLanguage, origin: translationSegments.origin,
      translationStatus: translationSegments.translationStatus, typesetStatus: translationSegments.typesetStatus, qaFlags: translationSegments.qaFlags, style: translationSegments.style, updatedAt: translationSegments.updatedAt,
    }).from(translationSegments).innerJoin(chapterPages, eq(chapterPages.id, translationSegments.pageId))
      .where(eq(translationSegments.jobId, job.id)).orderBy(asc(chapterPages.pageNumber), asc(translationSegments.position)),
  ]);
  if (chapter.status !== 'published') await resumeRenders(actor, pages);
  const { evaluation } = await chapterState(db(), chapter.id, job.id);
  const env = serverEnv();
  return {
    chapter: { id: chapter.id, number: chapter.number, title: chapter.title, status: chapter.status, pageCount: chapter.pageCount },
    series: { id: chapter.seriesId, title: chapter.seriesTitle, slug: chapter.slug, coverUrl: imageSrc(chapter.coverKey), coverHue: chapter.coverHue },
    job, pages: pages.map(toPage), segments: segments as WorkspaceSegmentDTO[], evaluation,
    requireApproval: !env.MANUAL_TRANSLATION_AUTO_APPROVE, autoPublish: env.AUTO_PUBLISH_TRANSLATED_CHAPTERS,
  };
}

/** Lightweight poll while OCR or final-image rendering is in progress. */
export async function getWorkspaceStatus(chapterId: string): Promise<WorkspaceStatusDTO | null> {
  await requireRole('translator');
  const loaded = await loadChapter(chapterId);
  if (!loaded) return null;
  const { chapter, job } = loaded;
  const [pages, segments] = await Promise.all([
    db().select(pageColumns).from(chapterPages).where(eq(chapterPages.chapterId, chapter.id)).orderBy(asc(chapterPages.pageNumber)),
    db().select({ id: translationSegments.id, typesetStatus: translationSegments.typesetStatus, qaFlags: translationSegments.qaFlags, translationStatus: translationSegments.translationStatus })
      .from(translationSegments).where(eq(translationSegments.jobId, job.id)),
  ]);
  const { evaluation } = await chapterState(db(), chapter.id, job.id);
  return { chapter: { id: chapter.id, number: chapter.number, title: chapter.title, status: chapter.status, pageCount: chapter.pageCount }, job, pages: pages.map(toPage),
    segments: segments as WorkspaceStatusDTO['segments'], evaluation };
}

/* Edits. A segment is editable while its chapter is unpublished and OCR has run for its page. */

async function editableSegment(tx: Executor, segmentId: string) {
  const [row] = await tx.select({ id: translationSegments.id, pageId: translationSegments.pageId, jobId: translationSegments.jobId, chapterId: chapterPages.chapterId,
    translatedText: translationSegments.translatedText, translationStatus: translationSegments.translationStatus, sourceText: translationSegments.sourceText,
    chapterStatus: chapters.status, workflow: translationJobs.workflow, jobStatus: translationJobs.status })
    .from(translationSegments).innerJoin(chapterPages, eq(chapterPages.id, translationSegments.pageId)).innerJoin(chapters, eq(chapters.id, chapterPages.chapterId))
    .innerJoin(translationJobs, eq(translationJobs.id, translationSegments.jobId)).where(eq(translationSegments.id, parseInput(uuid, segmentId))).for('update', { of: translationSegments });
  if (!row || row.workflow !== 'manual') throw new DalError('NOT_FOUND', 'Segment not found.');
  if (row.chapterStatus === 'published') throw new DalError('CONFLICT', 'This chapter is published; unpublish it before changing translations.');
  if (row.jobStatus === 'queued' || row.jobStatus === 'running' || row.jobStatus === 'cancelled') throw new DalError('CONFLICT', 'Wait for OCR to finish before editing this chapter.');
  return row;
}

async function editablePage(tx: Executor, pageId: string) {
  const [page] = await tx.select({ id: chapterPages.id, chapterId: chapterPages.chapterId, pageNumber: chapterPages.pageNumber, sourceKey: chapterPages.sourceKey, chapterStatus: chapters.status })
    .from(chapterPages).innerJoin(chapters, eq(chapters.id, chapterPages.chapterId)).where(eq(chapterPages.id, parseInput(uuid, pageId))).for('update', { of: chapterPages });
  if (!page) throw new DalError('NOT_FOUND', 'Page not found.');
  if (page.chapterStatus === 'published') throw new DalError('CONFLICT', 'This chapter is published; unpublish it before changing it.');
  const job = await manualJobFor(tx, page.chapterId);
  if (!job) throw new DalError('NOT_FOUND', 'This chapter is not in the manual translation workflow.');
  if (job.status === 'queued' || job.status === 'running' || job.status === 'cancelled') throw new DalError('CONFLICT', 'Wait for OCR to finish before editing this chapter.');
  return { ...page, job };
}

const bump = (tx: Executor, pageId: string) => tx.update(chapterPages).set({ editVersion: sql`${chapterPages.editVersion} + 1` }).where(eq(chapterPages.id, pageId));

/** Debounced autosave of what the translator is typing. Never touches the final image. */
export async function saveDraft(segmentId: string, input: string) {
  const actor = await requireRole('translator');
  const value = parseInput(text(4000), input);
  const result = await db().transaction(async tx => {
    const segment = await editableSegment(tx, segmentId);
    const trimmed = value.trim();
    // Same text as stored (e.g. typed and reverted): a saved translation stays saved.
    if (trimmed === (segment.translatedText ?? '').trim()) return { segment, status: segment.translationStatus, changed: false };
    // Typing over a saved translation makes it a draft again until it is saved.
    const status = trimmed ? 'draft' : 'pending';
    await tx.update(translationSegments).set({ translatedText: trimmed ? value : null, translationStatus: status }).where(eq(translationSegments.id, segment.id));
    return { segment, status, changed: segment.translationStatus !== status };
  });
  if (result.changed) await refreshChapterState(result.segment.chapterId, actor);
  return { id: result.segment.id, translationStatus: result.status };
}

/** Save final translations (one or many on a page) and render the page's final image. */
export async function saveTranslations(items: { segmentId: string; text: string }[]) {
  const actor = await requireRole('translator');
  const list = parseInput(z.array(z.object({ segmentId: uuid, text: text(4000).refine(v => v.trim().length > 0, 'Enter a translation first.') })).min(1).max(200), items);
  const saved = await db().transaction(async tx => {
    const pages = new Set<string>(); const out: { id: string; pageId: string; chapterId: string }[] = [];
    for (const item of list) {
      const segment = await editableSegment(tx, item.segmentId);
      await tx.update(translationSegments).set({ translatedText: item.text.trim(), translationStatus: 'translated', typesetStatus: 'pending', reviewedBy: actor.userId, reviewedAt: new Date() })
        .where(eq(translationSegments.id, segment.id));
      pages.add(segment.pageId); out.push({ id: segment.id, pageId: segment.pageId, chapterId: segment.chapterId });
    }
    for (const pageId of pages) await bump(tx, pageId);
    return out;
  });
  await requestPageRender([...new Set(saved.map(s => s.pageId))], actor);
  await refreshChapterState(saved[0].chapterId, actor);
  return { saved: saved.map(s => s.id), translationStatus: 'translated' as const };
}

/** Optional explicit approval when MANUAL_TRANSLATION_AUTO_APPROVE is off. */
export async function approveSegments(segmentIds: string[]) {
  const actor = await requireRole('translator');
  const ids = parseInput(z.array(uuid).min(1).max(200), segmentIds);
  const rows = await db().transaction(async tx => {
    for (const id of ids) await editableSegment(tx, id);
    return tx.update(translationSegments).set({ translationStatus: 'approved', reviewStatus: 'approved', reviewedBy: actor.userId, reviewedAt: new Date() })
      .where(and(inArray(translationSegments.id, ids), eq(translationSegments.translationStatus, 'translated')))
      .returning({ id: translationSegments.id, pageId: translationSegments.pageId });
  });
  const [page] = rows.length ? await db().select({ chapterId: chapterPages.chapterId }).from(chapterPages).where(eq(chapterPages.id, rows[0].pageId)) : [];
  if (page) await refreshChapterState(page.chapterId, actor);
  return { approved: rows.length };
}

/** OCR correction: the corrected text becomes the source shown to the translator. */
export async function correctSourceText(segmentId: string, input: string) {
  await requireRole('translator');
  const value = parseInput(text(4000), input).trim();
  return db().transaction(async tx => {
    const segment = await editableSegment(tx, segmentId);
    const corrected = !value || value === segment.sourceText ? null : value;
    await tx.update(translationSegments).set({ correctedSourceText: corrected }).where(eq(translationSegments.id, segment.id));
    return { id: segment.id, correctedSourceText: corrected };
  });
}

/** Move/resize a region or change its lettering style; re-renders when the segment is already lettered. */
export async function updateSegmentLayout(segmentId: string, input: { box?: { x: number; y: number; w: number; h: number }; style?: Record<string, unknown> | null }) {
  const actor = await requireRole('translator');
  const data = parseInput(z.object({ box: box.optional(), style: typesetStyleOverride.nullable().optional() }).strict(), input);
  const result = await db().transaction(async tx => {
    const segment = await editableSegment(tx, segmentId);
    await tx.update(translationSegments).set({ ...(data.box ?? {}), ...(data.style !== undefined ? { style: data.style ?? {} } : {}), typesetStatus: 'pending' })
      .where(eq(translationSegments.id, segment.id));
    const lettered = segment.translationStatus === 'translated' || segment.translationStatus === 'approved';
    if (lettered) await bump(tx, segment.pageId);
    return { segment, lettered };
  });
  if (result.lettered) await requestPageRender([result.segment.pageId], actor);
  return { id: result.segment.id };
}

/** Draw a region OCR missed. */
export async function addSegment(pageId: string, input: { x: number; y: number; w: number; h: number }, sourceText = '') {
  const actor = await requireRole('translator');
  const data = parseInput(box, input);
  const source = parseInput(text(4000), sourceText).trim();
  const row = await db().transaction(async tx => {
    const page = await editablePage(tx, pageId);
    const [{ last }] = await tx.select({ last: max(translationSegments.position) }).from(translationSegments).where(eq(translationSegments.pageId, page.id));
    const [segment] = await tx.insert(translationSegments).values({ jobId: page.job.id, pageId: page.id, position: (last ?? 0) + 1, kind: 'speech', ...data,
      sourceText: source, origin: 'manual', processingStatus: 'manual', translationStatus: 'pending', typesetStatus: 'pending' }).returning({ id: translationSegments.id, position: translationSegments.position });
    await tx.update(chapterPages).set({ ocrStatus: 'done', ocrError: null }).where(eq(chapterPages.id, page.id));
    return { ...segment, chapterId: page.chapterId };
  });
  await refreshChapterState(row.chapterId, actor);
  return { id: row.id, position: row.position };
}

/** Remove a false detection (or lettering that should stay untouched, like a sound effect). */
export async function deleteSegment(segmentId: string) {
  const actor = await requireRole('translator');
  const result = await db().transaction(async tx => {
    const segment = await editableSegment(tx, segmentId);
    await tx.delete(translationSegments).where(eq(translationSegments.id, segment.id));
    const rest = await tx.select({ id: translationSegments.id }).from(translationSegments).where(eq(translationSegments.pageId, segment.pageId)).orderBy(asc(translationSegments.position));
    for (let i = 0; i < rest.length; i++) await tx.update(translationSegments).set({ position: i + 1 }).where(eq(translationSegments.id, rest[i].id));
    await bump(tx, segment.pageId);
    return segment;
  });
  await requestPageRender([result.pageId], actor);
  await refreshChapterState(result.chapterId, actor);
  return { id: result.id };
}

/** Fix reading order: move a segment one place earlier or later on its page. */
export async function moveSegment(segmentId: string, direction: 'up' | 'down') {
  await requireRole('translator');
  const dir = parseInput(z.enum(['up', 'down']), direction);
  return db().transaction(async tx => {
    const segment = await editableSegment(tx, segmentId);
    const list = await tx.select({ id: translationSegments.id }).from(translationSegments).where(eq(translationSegments.pageId, segment.pageId)).orderBy(asc(translationSegments.position), asc(translationSegments.createdAt));
    const index = list.findIndex(s => s.id === segment.id);
    const swap = dir === 'up' ? index - 1 : index + 1;
    if (index < 0 || swap < 0 || swap >= list.length) return { order: list.map(s => s.id) };
    [list[index], list[swap]] = [list[swap], list[index]];
    for (let i = 0; i < list.length; i++) await tx.update(translationSegments).set({ position: i + 1 }).where(eq(translationSegments.id, list[i].id));
    return { order: list.map(s => s.id) };
  });
}

/** Accept a lettering/removal warning after looking at the final image. */
export async function acceptSegmentImage(segmentId: string) {
  const actor = await requireRole('translator');
  const segment = await db().transaction(async tx => {
    const row = await editableSegment(tx, segmentId);
    const [updated] = await tx.update(translationSegments).set({ typesetStatus: 'accepted' })
      .where(and(eq(translationSegments.id, row.id), eq(translationSegments.typesetStatus, 'needs_review'))).returning({ id: translationSegments.id });
    if (!updated) throw new DalError('CONFLICT', 'Only segments waiting for image review can be accepted.');
    return row;
  });
  await refreshChapterState(segment.chapterId, actor);
  return { id: segment.id };
}

/** Re-run OCR for one page. Refused when any segment on it already has a typed translation. */
export async function retryPageOcr(pageId: string) {
  const actor = await requireRole('translator');
  const page = await db().transaction(async tx => {
    const row = await editablePage(tx, pageId);
    const existing = await tx.select({ translatedText: translationSegments.translatedText }).from(translationSegments).where(eq(translationSegments.pageId, row.id));
    if (!canRerunOcr(existing)) throw new DalError('CONFLICT', 'This page already has translations. Delete or correct regions by hand instead of re-running OCR.');
    await tx.update(chapterPages).set({ ocrStatus: 'pending', ocrError: null }).where(eq(chapterPages.id, row.id));
    return row;
  });
  const [job] = await db().select({ id: translationJobs.id, sourceLanguage: translationJobs.sourceLanguage }).from(translationJobs).where(eq(translationJobs.id, page.job.id));
  let segments: number | null = null;
  try { segments = await ocrPage(job, { id: page.id, pageNumber: page.pageNumber, sourceKey: page.sourceKey }); }
  catch (error) {
    const message = (error instanceof Error ? error.message : 'OCR failed.').slice(0, 500);
    await db().update(chapterPages).set({ ocrStatus: 'failed', ocrError: message }).where(eq(chapterPages.id, page.id));
    throw new DalError('CONFLICT', `OCR failed: ${message}`);
  }
  await db().insert(translationJobLogs).values({ jobId: job.id, attempt: page.job.attempt, stage: 'ocr', message: `OCR re-run on page ${page.pageNumber}: ${segments ?? 0} segments.` });
  await requestPageRender([page.id], actor);
  await refreshChapterState(page.chapterId, actor);
  return { segments: segments ?? 0 };
}

/** Retry final-image generation for pages whose render failed (or all stale pages of a chapter). */
export async function retryPageRender(pageIds: string[]) {
  const actor = await requireRole('translator');
  const ids = parseInput(z.array(uuid).min(1).max(1000), pageIds);
  const rows = await db().select({ id: chapterPages.id, chapterStatus: chapters.status }).from(chapterPages).innerJoin(chapters, eq(chapters.id, chapterPages.chapterId)).where(inArray(chapterPages.id, ids));
  if (rows.some(r => r.chapterStatus === 'published')) throw new DalError('CONFLICT', 'This chapter is published.');
  await db().update(chapterPages).set({ renderStatus: 'idle', renderError: null, editVersion: sql`${chapterPages.editVersion} + 1` }).where(inArray(chapterPages.id, rows.map(r => r.id)));
  await requestPageRender(rows.map(r => r.id), actor);
  return { queued: rows.length };
}

/** Publish after final review. Atomic: every check is re-run inside the publishing transaction. */
export async function publishManualChapter(chapterId: string) {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, chapterId);
  try { return await db().transaction(tx => publishFinalizedChapter(tx, id, actor, false)); }
  catch (error) {
    if (error instanceof PublishBlocked) throw new DalError('CONFLICT', `Cannot publish yet: ${error.reasons.join(' ')}`);
    throw error;
  }
}

/* Page image edits */

const pageEdit = z.discriminatedUnion('type', [
  z.object({ type: z.literal('erase'), box }),
  z.object({ type: z.literal('cut'), top: z.number().min(0).max(1), bottom: z.number().min(0).max(1) }).refine(c => c.bottom > c.top, 'Select a strip to cut.'),
]);
export type PageEdit = z.input<typeof pageEdit>;
export type PageEditResult = { src: string | null; width: number; height: number; segments: { id: string; y: number; h: number }[]; deleted: string[]; erase?: 'clean' | 'smudged' };
/** Hand-edited versions are replaced on the next edit; the uploaded original (`0005.png`) is always kept. */
const isEditedKey = (key: string) => /-e[0-9]+\.png$/.test(key);

/**
 * Erase a rectangle or cut a horizontal strip out of a page's source image. The result becomes the page's new source
 * (translations are lettered on top of it); regions below a cut move up with the artwork.
 */
export async function editPageImage(pageId: string, input: PageEdit): Promise<PageEditResult> {
  const actor = await requireRole('translator');
  const edit = parseInput(pageEdit, input);
  const before = await db().transaction(tx => editablePage(tx, pageId));
  const [{ width, height }] = await db().select({ width: chapterPages.width, height: chapterPages.height }).from(chapterPages).where(eq(chapterPages.id, before.id));
  const raster = await rasterize((await loadPage(before.sourceKey)).bytes);
  if (raster.width !== width || raster.height !== height) throw new DalError('CONFLICT', 'The stored page image does not match its recorded size.');
  let output = raster; let cut: { top: number; bottom: number } | null = null; let erase: 'clean' | 'smudged' | undefined;
  if (edit.type === 'erase') {
    const outcome = eraseArea(raster, toPixels(edit.box, width, height));
    if (outcome === 'unchanged') throw new DalError('INVALID_INPUT', 'Nothing to erase there. Drag a box around the text.');
    erase = outcome;
  } else {
    cut = { top: Math.round(edit.top * height), bottom: Math.round(edit.bottom * height) };
    if (cut.bottom - cut.top < 1) throw new DalError('INVALID_INPUT', 'Select a taller strip to cut.');
    if (height - (cut.bottom - cut.top) < 50) throw new DalError('INVALID_INPUT', 'Cutting this much would leave an empty page.');
    output = cutRows(raster, cut.top, cut.bottom);
  }
  const bytes = await encodeRaster(output);
  const key = `chapters/${before.chapterId}/${String(before.pageNumber).padStart(4, '0')}-e${randomInt(1, 100_000_000)}.png`;
  await putImage(key, bytes);
  let result: PageEditResult;
  try {
    result = await db().transaction(async tx => {
      const page = await editablePage(tx, pageId);
      if (page.sourceKey !== before.sourceKey) throw new DalError('CONFLICT', 'This page was changed meanwhile. Reload and try again.');
      const moved: PageEditResult['segments'] = [], deleted: string[] = [];
      if (cut) {
        const rows = await tx.select({ id: translationSegments.id, y: translationSegments.y, h: translationSegments.h }).from(translationSegments).where(eq(translationSegments.pageId, page.id));
        for (const row of rows) {
          const next = regionAfterCut(row, height, cut.top, cut.bottom);
          if (!next) { deleted.push(row.id); continue; }
          moved.push({ id: row.id, ...next });
          await tx.update(translationSegments).set({ y: next.y, h: next.h, typesetStatus: 'pending' }).where(eq(translationSegments.id, row.id));
        }
        if (deleted.length) await tx.delete(translationSegments).where(inArray(translationSegments.id, deleted));
        const rest = await tx.select({ id: translationSegments.id }).from(translationSegments).where(eq(translationSegments.pageId, page.id)).orderBy(asc(translationSegments.position));
        for (let i = 0; i < rest.length; i++) await tx.update(translationSegments).set({ position: i + 1 }).where(eq(translationSegments.id, rest[i].id));
      }
      await tx.update(chapterPages).set({ sourceKey: key, width: output.width, height: output.height, bytes: bytes.length, contentHash: createHash('sha256').update(bytes).digest('hex'),
        ocrStatus: 'done', ocrError: null, editVersion: sql`${chapterPages.editVersion} + 1` }).where(eq(chapterPages.id, page.id));
      await tx.insert(translationJobLogs).values({ jobId: page.job.id, attempt: page.job.attempt, stage: 'ocr',
        message: edit.type === 'erase' ? `Page ${page.pageNumber}: area erased by hand.` : `Page ${page.pageNumber}: ${cut!.bottom - cut!.top}px strip cut out by hand.` });
      return { src: imageSrc(key), width: output.width, height: output.height, segments: moved, deleted, erase };
    });
  } catch (error) { await deleteImage(key); throw error; }
  if (isEditedKey(before.sourceKey)) await deleteImage(before.sourceKey);
  // The final image (or the original delivered for a page without text) must be regenerated from the new source.
  await requestPageRender([before.id], actor);
  return result;
}
