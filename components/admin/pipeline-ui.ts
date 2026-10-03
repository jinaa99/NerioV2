/** Pipeline display constants shared by the admin dashboard, processing and upload screens. Client-safe. */
export const PIPELINE_STAGE_ORDER = ['validating', 'extracting', 'sorting', 'validating_images', 'optimizing_images', 'uploading', 'creating_records', 'ocr', 'context_building', 'translating', 'cleaning', 'typesetting', 'optimizing', 'qa', 'ready', 'published'] as const;
export type Stage = (typeof PIPELINE_STAGE_ORDER)[number];
export const PIPELINE_STAGE_LABEL: Record<Stage, string> = {
  validating: 'VALIDATING', extracting: 'EXTRACTING', sorting: 'SORTING', validating_images: 'CHECKING IMAGES', optimizing_images: 'OPTIMIZING IMAGES', uploading: 'UPLOADING', creating_records: 'SAVING RECORDS', ocr: 'OCR', context_building: 'BUILDING CONTEXT', translating: 'TRANSLATING', cleaning: 'CLEANING', typesetting: 'TYPESETTING',
  optimizing: 'OPTIMIZING', qa: 'QA', ready: 'READY', published: 'PUBLISHED',
};
export const PIPELINE_STAGE_SHORT: Record<Stage, string> = {
  validating: 'VALID', extracting: 'EXTRACT', sorting: 'SORT', validating_images: 'IMAGES', optimizing_images: 'OPTIM', uploading: 'UPLOAD', creating_records: 'SAVE', ocr: 'OCR', context_building: 'CTX', translating: 'TRANS', cleaning: 'CLEAN', typesetting: 'TYPE', optimizing: 'OPTIM', qa: 'QA', ready: 'READY', published: 'PUB',
};
export const PIPELINE_STAGE_DESC: Record<Stage, string> = {
  validating: 'Checking upload format and limits', extracting: 'Safely extracting archive entries', sorting: 'Ordering pages by filename', validating_images: 'Checking image integrity and dimensions', optimizing_images: 'Normalizing image orientation and quality', uploading: 'Saving images to storage', creating_records: 'Saving chapter and page records', ocr: 'Detecting text regions', context_building: 'Loading nearby dialogue, series terms and translation memory', translating: 'Translating regions with the series glossary',
  cleaning: 'Removing original lettering from bubbles and SFX', typesetting: 'Fitting translated text into bubbles', optimizing: 'Encoding pages for the reader',
  qa: 'Checking overflow, glossary terms and low-confidence regions', ready: 'Waiting for review or publish', published: 'Live for readers',
};
export const JOB_TONE = { queued: 'neutral', running: 'ember', failed: 'danger', ready: 'info', cancelled: 'neutral' } as const;

/** [line color, text color] for a 0–1 confidence score. */
export const confColors = (c: number): [string, string] =>
  c >= .85 ? ['var(--success)', 'var(--success-text)'] : c >= .7 ? ['var(--warning)', 'var(--warning-text)'] : ['var(--danger)', 'var(--danger-text)'];
