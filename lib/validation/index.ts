/**
 * Input schemas shared by server and client. No secrets or DB imports here, so forms can
 * reuse them for client-side hints. The server always re-validates; client checks are UX only.
 */
import { z } from 'zod';

export const uuid = z.uuid();
export const slug = z.string().trim().toLowerCase().min(1).max(96).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes');
export const languageTag = z.string().trim().min(2).max(16).regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, 'Use a BCP-47 tag like ko or zh-Hant');
export const hue = z.number().int().min(0).max(360);
/** Relative in-app path only; blocks `//host` and `/\host` open redirects. */
export const relativeHref = z.string().max(500).regex(/^\/([^/\\]|$)/, 'Must be a relative path');

export const pagination = z.object({
  limit: z.number().int().min(1).max(100).default(24),
  offset: z.number().int().min(0).max(10_000).default(0),
});
export type Pagination = z.input<typeof pagination>;

/* Identity */

export const username = z.string().trim().regex(/^[A-Za-z0-9_.]{3,32}$/, '3–32 letters, numbers, dots or underscores');
export const email = z.email().trim().toLowerCase().max(320);

export const readerSettings = z.object({
  width: z.enum(['narrow', 'standard', 'wide', 'fit']),
  gap: z.enum(['none', 'small', 'large']),
  quality: z.enum(['auto', 'hd', 'saver']),
  bg: z.enum(['black', 'dim', 'paper']),
  autoHide: z.boolean(),
}).partial().strict();

export const updateProfileInput = z.object({
  displayName: z.string().trim().min(1).max(64),
  bio: z.string().trim().max(500).nullable(),
  locale: languageTag,
  readerSettings,
  emailOnNewChapter: z.boolean(),
  showActivity: z.boolean(),
}).partial().strict();
export type UpdateProfileInput = z.input<typeof updateProfileInput>;

export const roleKey = z.enum(['reader', 'translator', 'editor', 'admin']);

/* Catalog */

export const seriesStatus = z.enum(['draft', 'ongoing', 'completed', 'hiatus']);

export const createSeriesInput = z.object({
  slug,
  title: z.string().trim().min(1).max(200),
  altTitle: z.string().trim().max(300).nullish(),
  description: z.string().trim().max(5000).default(''),
  author: z.string().trim().min(1).max(120),
  artist: z.string().trim().max(120).nullish(),
  status: seriesStatus.default('draft'),
  sourceLanguage: languageTag.default('ko'),
  coverHue: hue.default(40),
  genreSlugs: z.array(slug).max(8).default([]),
}).strict();
export type CreateSeriesInput = z.input<typeof createSeriesInput>;

export const updateSeriesInput = createSeriesInput.omit({ slug: true }).partial().strict();
export type UpdateSeriesInput = z.input<typeof updateSeriesInput>;

export const listSeriesInput = pagination.extend({
  genre: slug.optional(),
  status: z.enum(['ongoing', 'completed', 'hiatus']).optional(),
  sort: z.enum(['popular', 'updated', 'new']).default('popular'),
  q: z.string().trim().max(100).optional(),
});
export type ListSeriesInput = z.input<typeof listSeriesInput>;

export const chapterNumber = z.number().min(0).max(99_999.99).multipleOf(0.01);

export const createChapterInput = z.object({
  seriesId: uuid,
  number: chapterNumber,
  title: z.string().trim().max(200).nullish(),
  access: z.enum(['free', 'early_access']).default('free'),
  freeAt: z.coerce.date().nullish(),
}).strict().refine(v => v.access === 'free' || v.freeAt, { message: 'Early-access chapters need a free date', path: ['freeAt'] });
export type CreateChapterInput = z.input<typeof createChapterInput>;

/* Reading */

export const saveProgressInput = z.object({
  chapterId: uuid,
  pageNumber: z.number().int().min(1).max(10_000),
  percent: z.number().int().min(0).max(100),
}).strict();
export type SaveProgressInput = z.input<typeof saveProgressInput>;

/* Translation (records only; the AI pipeline is not implemented) */

export const createTranslationJobInput = z.object({
  chapterId: uuid,
  targetLanguage: languageTag.default('en'),
  priority: z.number().int().min(-10).max(10).default(0),
}).strict();
export type CreateTranslationJobInput = z.input<typeof createTranslationJobInput>;

export const reviewSegmentInput = z.object({
  segmentId: uuid,
  translatedText: z.string().trim().min(1).max(2000).optional(),
  reviewStatus: z.enum(['approved', 'edited', 'flagged']),
}).strict();
export type ReviewSegmentInput = z.input<typeof reviewSegmentInput>;

export const glossaryTermInput = z.object({
  seriesId: uuid,
  sourceTerm: z.string().trim().min(1).max(200),
  targetTerm: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(1000).nullish(),
  caseSensitive: z.boolean().default(false),
}).strict();
export type GlossaryTermInput = z.input<typeof glossaryTermInput>;

export const characterInput = z.object({
  seriesId: uuid,
  name: z.string().trim().min(1).max(120),
  nativeName: z.string().trim().max(120).nullish(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  description: z.string().trim().max(2000).nullish(),
  voiceNotes: z.string().trim().max(1000).nullish(),
}).strict();
export type CharacterInput = z.input<typeof characterInput>;

/* Billing (records only; no payment processing) */

export const premiumPlan = z.enum(['1m', '3m', '12m']);
export const createPaymentInput = z.object({ plan: premiumPlan }).strict();
export type CreatePaymentInput = z.input<typeof createPaymentInput>;
