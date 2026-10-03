import { pgEnum } from 'drizzle-orm/pg-core';

export const userStatus = pgEnum('user_status', ['active', 'suspended', 'deleted']);
export const roleKey = pgEnum('role_key', ['reader', 'translator', 'editor', 'admin']);

export const seriesStatus = pgEnum('series_status', ['draft', 'ongoing', 'completed', 'hiatus']);
export const chapterStatus = pgEnum('chapter_status', ['draft', 'processing', 'in_review', 'ready', 'published', 'failed']);
/** `early_access` chapters are Premium-only until `chapters.free_at`. */
export const chapterAccess = pgEnum('chapter_access', ['free', 'early_access']);

export const notificationType = pgEnum('notification_type', ['new_chapter', 'payment_confirmed', 'payment_rejected', 'report_update', 'system']);

/** Mirrors the admin pipeline in lib/admin-data.ts (STAGES). */
export const pipelineStage = pgEnum('pipeline_stage', ['validating', 'ocr', 'translating', 'cleaning', 'typesetting', 'optimizing', 'qa', 'ready', 'published']);
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'failed', 'ready', 'cancelled']);
export const segmentKind = pgEnum('segment_kind', ['speech', 'narration', 'sfx', 'sign', 'other']);
export const segmentReview = pgEnum('segment_review', ['pending', 'approved', 'edited', 'flagged']);

export const paymentMethod = pgEnum('payment_method', ['bank_transfer']);
export const paymentStatus = pgEnum('payment_status', ['pending', 'confirmed', 'rejected', 'refunded']);
export const premiumPlan = pgEnum('premium_plan', ['1m', '3m', '12m']);

export const reportKind = pgEnum('report_kind', ['wrong_translation', 'missing_page', 'text_overflow', 'image_quality', 'other']);
export const reportStatus = pgEnum('report_status', ['open', 'resolved', 'dismissed']);
