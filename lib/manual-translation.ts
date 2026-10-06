/**
 * Pure rules of the manual translation workflow: progress, page/chapter completion, publish gating, batch status
 * labels and the bulk copy/paste format. Client-safe and shared by the workspace UI and the server, so the browser
 * and the publish check can never disagree.
 */

export const TRANSLATION_STATUSES = ['pending', 'draft', 'translated', 'approved', 'failed'] as const;
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];
export const TYPESET_STATUSES = ['pending', 'rendered', 'needs_review', 'accepted', 'failed'] as const;
export type TypesetStatus = (typeof TYPESET_STATUSES)[number];

export type SegmentState = { id: string; pageId: string; translationStatus: TranslationStatus; typesetStatus: TypesetStatus };
export type PageState = {
  id: string; pageNumber: number;
  ocrStatus: 'pending' | 'done' | 'failed';
  editVersion: number; renderedVersion: number;
  renderStatus: 'idle' | 'queued' | 'rendering' | 'failed';
  hasOutput: boolean;
};

/** A segment's translation is final: saved (when saves count as approval) or explicitly approved. */
export const isTranslated = (status: TranslationStatus, requireApproval = false) => status === 'approved' || (!requireApproval && status === 'translated');
/** The final image shows the saved text without an unresolved lettering problem. */
const typesetDone = (status: TypesetStatus) => status === 'rendered' || status === 'accepted';
/** The page's final image reflects every saved change. */
export const renderCurrent = (page: PageState) => page.renderedVersion >= page.editVersion && page.renderStatus !== 'failed';

export function pageComplete(page: PageState, segments: SegmentState[], requireApproval = false): boolean {
  if (page.ocrStatus !== 'done' || !renderCurrent(page)) return false;
  if (!segments.every(s => isTranslated(s.translationStatus, requireApproval) && typesetDone(s.typesetStatus))) return false;
  // A page without lettering is delivered as the original image; anything lettered needs a stored final image.
  return segments.length === 0 || page.hasOutput;
}

export type ChapterEvaluation = {
  pages: number; pagesComplete: number;
  segments: number; translated: number; drafts: number; remaining: number;
  failedSegments: number; needsImageReview: number;
  ocrPending: number; ocrFailed: number; renderFailed: number; rendering: number;
  /** 0–100, by translated segments (pages without text count as one unit each so empty chapters still progress). */
  percent: number;
  blocking: string[];
  complete: boolean;
};

export function evaluateChapter(pages: PageState[], segments: SegmentState[], requireApproval = false): ChapterEvaluation {
  const byPage = new Map<string, SegmentState[]>(pages.map(p => [p.id, []]));
  for (const s of segments) byPage.get(s.pageId)?.push(s);
  const translated = segments.filter(s => isTranslated(s.translationStatus, requireApproval)).length;
  const pagesComplete = pages.filter(p => pageComplete(p, byPage.get(p.id) ?? [], requireApproval)).length;
  const ocrPending = pages.filter(p => p.ocrStatus === 'pending').length;
  const ocrFailed = pages.filter(p => p.ocrStatus === 'failed').length;
  const renderFailed = pages.filter(p => p.renderStatus === 'failed').length;
  const rendering = pages.filter(p => !renderCurrent(p) && p.renderStatus !== 'failed').length;
  const failedSegments = segments.filter(s => s.translationStatus === 'failed' || s.typesetStatus === 'failed').length;
  const needsImageReview = segments.filter(s => s.typesetStatus === 'needs_review').length;
  const remaining = segments.length - translated;
  const blocking: string[] = [];
  if (!pages.length) blocking.push('The chapter has no pages.');
  if (ocrPending) blocking.push(`${ocrPending} page${ocrPending === 1 ? '' : 's'} not OCR'd yet.`);
  if (ocrFailed) blocking.push(`OCR failed on ${ocrFailed} page${ocrFailed === 1 ? '' : 's'}.`);
  if (remaining) blocking.push(`${remaining} segment${remaining === 1 ? '' : 's'} still need${remaining === 1 ? 's' : ''} a ${requireApproval ? 'approved ' : ''}translation.`);
  if (failedSegments) blocking.push(`${failedSegments} segment${failedSegments === 1 ? '' : 's'} failed.`);
  if (needsImageReview) blocking.push(`${needsImageReview} segment${needsImageReview === 1 ? '' : 's'} need${needsImageReview === 1 ? 's' : ''} image review.`);
  if (renderFailed) blocking.push(`Final image generation failed on ${renderFailed} page${renderFailed === 1 ? '' : 's'}.`);
  if (pagesComplete < pages.length && !blocking.length) blocking.push(`${pages.length - pagesComplete} page${pages.length - pagesComplete === 1 ? ' is' : 's are'} still being finalized.`);
  const emptyPages = pages.filter(p => !(byPage.get(p.id) ?? []).length).length;
  const units = segments.length + emptyPages;
  const done = translated + pages.filter(p => !(byPage.get(p.id) ?? []).length && p.ocrStatus === 'done').length;
  return {
    pages: pages.length, pagesComplete, segments: segments.length, translated,
    drafts: segments.filter(s => s.translationStatus === 'draft').length, remaining,
    failedSegments, needsImageReview, ocrPending, ocrFailed, renderFailed, rendering,
    percent: units ? Math.floor((done / units) * 100) : 0,
    blocking, complete: pages.length > 0 && blocking.length === 0 && pagesComplete === pages.length,
  };
}

/** Auto-publish only a fully finalized chapter with no blocking problem, and only when the setting is on. */
export const shouldAutoPublish = (enabled: boolean, evaluation: ChapterEvaluation) => enabled && evaluation.complete && evaluation.blocking.length === 0;

/** OCR of a page may be re-run only while nobody has typed a translation on it (manual work is never overwritten). */
export const canRerunOcr = (segments: { translatedText: string | null }[]) => segments.every(s => !s.translatedText?.trim());

export const BATCH_STATUSES = ['QUEUED', 'UPLOADING', 'VALIDATING', 'EXTRACTING', 'SORTING', 'OCR_PROCESSING', 'OCR_COMPLETED', 'TRANSLATION_PENDING',
  'TRANSLATION_IN_PROGRESS', 'TRANSLATION_COMPLETED', 'FINALIZATION', 'READY_TO_PUBLISH', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/** Status of one uploaded chapter in the batch dashboard, derived from durable job/chapter state. */
export function batchStatus(job: { status: string; stage: string }, chapterStatus: string, evaluation: Pick<ChapterEvaluation, 'segments' | 'translated' | 'drafts' | 'remaining' | 'complete'>): BatchStatus {
  if (chapterStatus === 'published' || job.stage === 'published') return 'COMPLETED';
  if (job.status === 'cancelled') return 'CANCELLED';
  if (job.status === 'failed') return 'FAILED';
  if (job.status === 'queued') return 'QUEUED';
  if (job.status === 'running') return job.stage === 'validating' ? 'VALIDATING' : job.stage === 'processing_images' ? 'EXTRACTING' : 'OCR_PROCESSING';
  if (evaluation.complete || chapterStatus === 'ready') return 'READY_TO_PUBLISH';
  if (evaluation.segments > 0 && evaluation.remaining === 0) return job.stage === 'typesetting' ? 'FINALIZATION' : 'TRANSLATION_COMPLETED';
  if (evaluation.translated > 0 || evaluation.drafts > 0) return 'TRANSLATION_IN_PROGRESS';
  return evaluation.segments === 0 ? 'OCR_COMPLETED' : 'TRANSLATION_PENDING';
}

/* Clipboard */

const tag = (n: number) => `[SEGMENT_${String(n).padStart(3, '0')}]`;

/** Page text in reading order, one tagged block per segment, ready to translate externally and paste back. */
export function formatPageText(sources: string[]): string {
  return sources.map((text, i) => `${tag(i + 1)}\n${text.trim()}`).join('\n\n');
}

/**
 * Parse pasted translations. Accepts the tagged format produced by `formatPageText` ([SEGMENT_001] blocks, in any
 * order) or a numbered list ("1. …", "2) …"). Returns 1-based segment number → text; blank blocks are skipped.
 */
export function parseBulkTranslation(input: string): Map<number, string> {
  const result = new Map<number, string>();
  const text = input.replace(/\r\n?/g, '\n');
  const tagged = [...text.matchAll(/^\s*\[\s*SEGMENT[_\s-]*(\d{1,4})\s*\]\s*$/gimu)];
  if (tagged.length) {
    tagged.forEach((match, i) => {
      const start = match.index! + match[0].length;
      const end = i + 1 < tagged.length ? tagged[i + 1].index! : text.length;
      const body = text.slice(start, end).trim();
      const n = Number(match[1]);
      if (n > 0 && body) result.set(n, body);
    });
    return result;
  }
  const numbered = [...text.matchAll(/^\s*(\d{1,4})[.)]\s+/gmu)];
  numbered.forEach((match, i) => {
    const start = match.index! + match[0].length;
    const end = i + 1 < numbered.length ? numbered[i + 1].index! : text.length;
    const body = text.slice(start, end).trim();
    const n = Number(match[1]);
    if (n > 0 && body) result.set(n, body);
  });
  return result;
}

/** The next segment that still needs a translation after `currentId`, wrapping to the start; null when all done. */
export function nextUntranslated<T extends { id: string; translationStatus: TranslationStatus }>(ordered: T[], currentId: string | null, requireApproval = false): T | null {
  const start = currentId ? ordered.findIndex(s => s.id === currentId) : -1;
  for (let step = 1; step <= ordered.length; step++) {
    const candidate = ordered[(start + step + ordered.length) % ordered.length];
    if (candidate && !isTranslated(candidate.translationStatus, requireApproval)) return candidate;
  }
  return null;
}
