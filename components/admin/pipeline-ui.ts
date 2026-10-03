/** Pipeline display constants shared by the admin dashboard, processing and upload screens. Client-safe. */
export const PIPELINE_STAGE_ORDER = ['queued', 'validating', 'processing_images', 'ocr', 'translating', 'cleaning', 'typesetting', 'qa', 'ready', 'published', 'failed'] as const;
export type Stage = (typeof PIPELINE_STAGE_ORDER)[number];
export const PIPELINE_STAGE_LABEL: Record<Stage, string> = {
  queued: 'QUEUED', validating: 'VALIDATING', processing_images: 'PROCESSING IMAGES', ocr: 'OCR', translating: 'TRANSLATING', cleaning: 'CLEANING', typesetting: 'TYPESETTING', qa: 'QA', ready: 'READY', published: 'PUBLISHED', failed: 'FAILED',
};
export const PIPELINE_STAGE_SHORT: Record<Stage, string> = {
  queued: 'QUEUE', validating: 'VALID', processing_images: 'IMAGES', ocr: 'OCR', translating: 'TRANS', cleaning: 'CLEAN', typesetting: 'TYPE', qa: 'QA', ready: 'READY', published: 'PUB', failed: 'FAIL',
};
export const PIPELINE_STAGE_DESC: Record<Stage, string> = {
  queued: 'Waiting for a processing worker', validating: 'Checking chapter page records and required page count', processing_images: 'Decoding and validating every source image', ocr: 'Detecting Korean text regions', translating: 'Translating regions using chapter context and glossary',
  cleaning: 'Removing original lettering from bubbles and SFX', typesetting: 'Fitting translated text into bubbles and encoding pages',
  qa: 'Checking image integrity, translation flags and visual layout', ready: 'Waiting for admin review', published: 'Live for readers', failed: 'Processing stopped; inspect logs and retry this stage',
};
export const JOB_TONE = { queued: 'neutral', running: 'ember', failed: 'danger', ready: 'info', cancelled: 'neutral' } as const;

/** [line color, text color] for a 0–1 confidence score. */
export const confColors = (c: number): [string, string] =>
  c >= .85 ? ['var(--success)', 'var(--success-text)'] : c >= .7 ? ['var(--warning)', 'var(--warning-text)'] : ['var(--danger)', 'var(--danger-text)'];
