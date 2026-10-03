/**
 * Display helpers for catalog DTOs. Client-safe: no server imports.
 */

export type SeriesStatus = 'draft' | 'ongoing' | 'completed' | 'hiatus';
export type ChapterStatus = 'draft' | 'processing' | 'in_review' | 'ready' | 'published' | 'failed';

export const SERIES_STATUS_LABEL: Record<SeriesStatus, string> = { draft: 'Draft', ongoing: 'Ongoing', completed: 'Completed', hiatus: 'Hiatus' };
export const SERIES_STATUS_TONE: Record<SeriesStatus, string> = { draft: 'neutral', ongoing: 'success', completed: 'info', hiatus: 'warning' };

export const CHAPTER_STATUS_LABEL: Record<ChapterStatus | 'scheduled', string> = {
  draft: 'DRAFT', processing: 'PROCESSING', in_review: 'IN REVIEW', ready: 'READY', published: 'PUBLISHED', failed: 'FAILED', scheduled: 'SCHEDULED',
};
export const CHAPTER_STATUS_TONE: Record<ChapterStatus | 'scheduled', string> = {
  draft: 'neutral', processing: 'ember', in_review: 'warning', ready: 'info', published: 'success', failed: 'danger', scheduled: 'info',
};

const gradient = (h: number) => `linear-gradient(160deg, oklch(.44 .075 ${h}), oklch(.2 .04 ${h}))`;

/** CSS background for a cover: the image when there is one, over the generated gradient. URLs are normalized server-side. */
export const coverBg = (hue: number, url?: string | null) =>
  url ? `center / cover no-repeat url("${url}"), ${gradient(hue)}` : gradient(hue);

export const backdropBg = (hue: number, url?: string | null) => {
  const g = `linear-gradient(120deg, oklch(.36 .07 ${hue}) 0%, oklch(.22 .05 ${hue + 20}) 55%, oklch(.14 .02 ${hue + 40}) 100%)`;
  return url ? `linear-gradient(rgba(11,11,13,.35), rgba(11,11,13,.35)), center 30% / cover no-repeat url("${url}"), ${g}` : g;
};

const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
/** 12400000 → "12.4M". */
export const compact = (n: number) => compactFmt.format(n).toUpperCase();

/** 12 → "12", 12.5 → "12.5". */
export const chapterNo = (n: number) => String(Number(n.toFixed(2)));

export const chapterName = (n: number, title: string | null | undefined) => title?.trim() || `Chapter ${chapterNo(n)}`;

/** Coarse relative time: "just now", "5h ago", "3d ago", "2mo ago", "1y ago". Future dates read "in …". */
export function timeAgo(date: Date | string | null | undefined, now = Date.now()): string {
  if (!date) return '';
  const diff = now - new Date(date).getTime();
  const abs = Math.abs(diff);
  const m = 60_000, h = 60 * m, d = 24 * h;
  const v = abs < h ? `${Math.max(1, Math.round(abs / m))}m` : abs < d ? `${Math.round(abs / h)}h` : abs < 30 * d ? `${Math.round(abs / d)}d` : abs < 365 * d ? `${Math.round(abs / (30 * d))}mo` : `${Math.round(abs / (365 * d))}y`;
  if (abs < m) return 'just now';
  return diff >= 0 ? `${v} ago` : `in ${v}`;
}

export const shortDate = (date: Date | string | null | undefined) =>
  date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
