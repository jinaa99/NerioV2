'use server';
/**
 * Server Actions for the batch dashboard and the manual translation workspace. Authorization is enforced in each
 * DAL function. Autosave-style actions deliberately skip revalidation so typing never re-renders the page.
 */
import { revalidatePath } from 'next/cache';
import {
  acceptSegmentImage, addSegment, approveSegments, correctSourceText, deleteSegment, editPageImage, getWorkspaceStatus, moveSegment, type PageEdit,
  publishManualChapter, retryPageOcr, retryPageRender, saveDraft, saveTranslations, startBatchJobs, updateSegmentLayout,
} from '../data/manual-translation';
import { retryJob } from '../data/pipeline';
import { DalError } from '../errors';
import type { AdminResult } from './admin';

async function run<T>(fn: () => Promise<T>, revalidate: string[] = []): Promise<AdminResult<T>> {
  let data: T;
  try { data = await fn(); }
  catch (err) {
    if (err instanceof DalError) return { ok: false, error: err.message, fields: err.fields };
    throw err;
  }
  for (const p of revalidate) revalidatePath(p, p === '/admin' ? 'layout' : 'page');
  return { ok: true, data };
}

export async function workspaceStatusAction(chapterId: string) {
  return run(() => getWorkspaceStatus(chapterId));
}

export async function saveDraftAction(segmentId: string, text: string) {
  return run(() => saveDraft(segmentId, text));
}

export async function saveTranslationsAction(items: { segmentId: string; text: string }[]) {
  return run(() => saveTranslations(items));
}

export async function approveSegmentsAction(segmentIds: string[]) {
  return run(() => approveSegments(segmentIds));
}

export async function correctSourceTextAction(segmentId: string, text: string) {
  return run(() => correctSourceText(segmentId, text));
}

export async function updateSegmentLayoutAction(segmentId: string, input: { box?: { x: number; y: number; w: number; h: number }; style?: Record<string, unknown> | null }) {
  return run(() => updateSegmentLayout(segmentId, input));
}

export async function addSegmentAction(pageId: string, box: { x: number; y: number; w: number; h: number }, sourceText: string) {
  return run(() => addSegment(pageId, box, sourceText));
}

export async function editPageImageAction(pageId: string, edit: PageEdit) {
  return run(() => editPageImage(pageId, edit));
}

export async function deleteSegmentAction(segmentId: string) {
  return run(() => deleteSegment(segmentId));
}

export async function moveSegmentAction(segmentId: string, direction: 'up' | 'down') {
  return run(() => moveSegment(segmentId, direction));
}

export async function acceptSegmentImageAction(segmentId: string) {
  return run(() => acceptSegmentImage(segmentId));
}

export async function retryPageOcrAction(pageId: string) {
  return run(() => retryPageOcr(pageId));
}

export async function retryPageRenderAction(pageIds: string[]) {
  return run(() => retryPageRender(pageIds));
}

export async function publishManualChapterAction(chapterId: string) {
  return run(() => publishManualChapter(chapterId), ['/admin', '/']);
}

export async function startBatchJobsAction(jobIds: string[]) {
  return run(() => startBatchJobs(jobIds), ['/admin']);
}

/** Retry failed OCR jobs; pages already read are kept, so only failed pages are OCR'd again. */
export async function retryBatchJobAction(jobId: string) {
  return run(async () => {
    await retryJob(jobId);
    return startBatchJobs([jobId]);
  }, ['/admin']);
}
