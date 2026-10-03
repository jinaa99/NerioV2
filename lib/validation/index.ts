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
// Browsers strip tabs/newlines from URLs, so `/\t/evil.com` would become `//evil.com`: reject all whitespace and backslashes.
export const relativeHref = z.string().max(500).regex(/^\/(?![/\\])[^\s\\]*$/, 'Must be a relative path');

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
  displayName: z.string().trim().min(1, 'Enter your name').max(64),
  username,
  bio: z.string().trim().max(500).nullable(),
  locale: languageTag,
  readerSettings,
  emailOnNewChapter: z.boolean(),
  showActivity: z.boolean(),
}).partial().strict();
export type UpdateProfileInput = z.input<typeof updateProfileInput>;

export const roleKey = z.enum(['reader', 'translator', 'editor', 'admin']);

/* Auth */

/** NIST 800-63B style: length over composition rules. The upper bound caps hashing cost. */
export const password = z.string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .refine(p => p.trim().length > 0, 'Password can’t be only spaces');

export const registerInput = z.object({
  displayName: z.string().trim().min(1, 'Enter your name').max(64),
  username,
  email,
  password,
}).strict();
export type RegisterInput = z.input<typeof registerInput>;

/** Login never reveals which field was wrong, so only basic shape checks here. */
export const loginInput = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Enter your email').max(320),
  password: z.string().min(1, 'Enter your password').max(128),
}).strict();
export type LoginInput = z.input<typeof loginInput>;

/** Post-login redirect target. Anything that isn't a same-site path falls back to `/`. */
export const safeNextPath = (value: unknown): string => {
  const parsed = relativeHref.safeParse(value);
  return parsed.success && !parsed.data.startsWith('/login') && !parsed.data.startsWith('/register') ? parsed.data : '/';
};

/* Catalog */

export const seriesStatus = z.enum(['draft', 'ongoing', 'completed', 'hiatus']);

/** Public https image URL, normalized so it is safe to embed in CSS `url("…")`. */
export const imageUrl = z.url({ protocol: /^https$/, error: 'Use an https:// image URL' }).max(1000).transform(u => new URL(u).href);

/** Genre/tag names: trimmed, de-duplicated (case-insensitive), order kept. */
const labelList = (max: number) => z.array(z.string().trim().min(1).max(64)).max(max)
  .transform(list => list.filter((v, i) => list.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i));

export const toSlug = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);

export const createSeriesInput = z.object({
  slug,
  title: z.string().trim().min(1, 'Enter a title').max(200),
  altTitles: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  description: z.string().trim().max(5000).default(''),
  author: z.string().trim().min(1, 'Enter the author').max(120),
  artist: z.string().trim().max(120).nullish().transform(v => v || null),
  status: seriesStatus.default('draft'),
  sourceLanguage: languageTag.default('ko'),
  coverHue: hue.default(40),
  coverUrl: imageUrl.nullish(),
  genres: labelList(8).default([]),
  tags: labelList(20).default([]),
}).strict();
export type CreateSeriesInput = z.input<typeof createSeriesInput>;

/** Full replace: the editor always submits every field (zod 4 `.partial()` would re-apply defaults). */
export const updateSeriesInput = createSeriesInput;
export type UpdateSeriesInput = z.input<typeof updateSeriesInput>;

export const seriesSort = z.enum(['popular', 'updated', 'new', 'rating', 'title']);

export const listSeriesInput = pagination.extend({
  genre: slug.optional(),
  status: z.enum(['ongoing', 'completed', 'hiatus']).optional(),
  sort: seriesSort.default('popular'),
  q: z.string().trim().max(100).optional(),
  excludeId: uuid.optional(),
});
export type ListSeriesInput = z.input<typeof listSeriesInput>;

export const adminListSeriesInput = pagination.extend({
  status: seriesStatus.optional(),
  q: z.string().trim().max(100).optional(),
});
export type AdminListSeriesInput = z.input<typeof adminListSeriesInput>;

export const chapterNumber = z.number().min(0).max(99_999.99).multipleOf(0.01);
/** Editors only toggle draft/published; the other states belong to the (future) processing pipeline. */
export const chapterPublishState = z.enum(['draft', 'published']);

const chapterFields = {
  number: chapterNumber,
  title: z.string().trim().max(200).nullish().transform(v => v || null),
  access: z.enum(['free', 'early_access']).default('free'),
  freeAt: z.coerce.date().nullish(),
  status: chapterPublishState.default('draft'),
  /** When the chapter goes live. A future date schedules it; null with `published` means now. */
  publishedAt: z.coerce.date().nullish(),
};
const earlyAccessNeedsDate = (v: { access?: string; freeAt?: Date | null }) => v.access !== 'early_access' || !!v.freeAt;

export const createChapterInput = z.object({ seriesId: uuid, ...chapterFields }).strict()
  .refine(earlyAccessNeedsDate, { message: 'Early-access chapters need a free date', path: ['freeAt'] });
export type CreateChapterInput = z.input<typeof createChapterInput>;

export const updateChapterInput = z.object(chapterFields).strict()
  .refine(earlyAccessNeedsDate, { message: 'Early-access chapters need a free date', path: ['freeAt'] });
export type UpdateChapterInput = z.input<typeof updateChapterInput>;

export const adminListChaptersInput = pagination.extend({
  seriesId: uuid,
  status: z.enum(['published', 'scheduled', 'draft', 'pipeline']).optional(),
});
export type AdminListChaptersInput = z.input<typeof adminListChaptersInput>;

export const publicChaptersInput = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(100_000).default(0),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().trim().max(100).optional(),
  /** Only chapters after this number (the "Unread" filter). */
  after: z.number().min(0).optional(),
});
export type PublicChaptersInput = z.input<typeof publicChaptersInput>;

export const addPagesInput = z.object({
  chapterId: uuid,
  pages: z.array(z.object({
    url: imageUrl,
    width: z.number().int().min(1).max(20_000),
    height: z.number().int().min(1).max(100_000),
  }).strict()).min(1).max(300),
}).strict();
export type AddPagesInput = z.input<typeof addPagesInput>;

export const reorderPagesInput = z.object({
  chapterId: uuid,
  /** Every page id of the chapter, in the new reading order. */
  pageIds: z.array(uuid).min(1).max(2000).refine(ids => new Set(ids).size === ids.length, 'Duplicate page'),
}).strict();
export type ReorderPagesInput = z.input<typeof reorderPagesInput>;

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
