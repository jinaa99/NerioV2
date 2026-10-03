/** Pipeline display constants shared by the admin dashboard, processing and upload screens. Client-safe. */
export const PIPELINE_STAGE_ORDER = ['validating', 'ocr', 'translating', 'cleaning', 'typesetting', 'optimizing', 'qa', 'ready', 'published'] as const;
export type Stage = (typeof PIPELINE_STAGE_ORDER)[number];
export const PIPELINE_STAGE_LABEL: Record<Stage, string> = {
  validating: 'VALIDATING', ocr: 'OCR', translating: 'TRANSLATING', cleaning: 'CLEANING', typesetting: 'TYPESETTING',
  optimizing: 'OPTIMIZING', qa: 'QA', ready: 'READY', published: 'PUBLISHED',
};
export const PIPELINE_STAGE_SHORT: Record<Stage, string> = {
  validating: 'VALID', ocr: 'OCR', translating: 'TRANS', cleaning: 'CLEAN', typesetting: 'TYPE', optimizing: 'OPTIM', qa: 'QA', ready: 'READY', published: 'PUB',
};
export const PIPELINE_STAGE_DESC: Record<Stage, string> = {
  validating: 'Checking page order and image integrity', ocr: 'Detecting text regions', translating: 'Translating regions with the series glossary',
  cleaning: 'Removing original lettering from bubbles and SFX', typesetting: 'Fitting translated text into bubbles', optimizing: 'Encoding pages for the reader',
  qa: 'Checking overflow, glossary terms and low-confidence regions', ready: 'Waiting for review or publish', published: 'Live for readers',
};
export const JOB_TONE = { queued: 'neutral', running: 'ember', failed: 'danger', ready: 'info', cancelled: 'neutral' } as const;

/** [line color, text color] for a 0–1 confidence score. */
export const confColors = (c: number): [string, string] =>
  c >= .85 ? ['var(--success)', 'var(--success-text)'] : c >= .7 ? ['var(--warning)', 'var(--warning-text)'] : ['var(--danger)', 'var(--danger-text)'];
