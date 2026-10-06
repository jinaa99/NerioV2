import 'server-only';
import { z } from 'zod';

/**
 * Server-only environment. This is the only module that reads secrets from `process.env`;
 * importing it from a Client Component fails the build (`server-only`).
 * Parsed lazily so `next build` and pages that never touch the database work without a DB configured.
 */
const unsetIfBlank = (v: unknown) => (typeof v === 'string' && !v.trim() ? undefined : v);
const flag = (fallback: boolean) => z.preprocess(unsetIfBlank, z.stringbool().default(fallback));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: issue => issue.input === undefined || issue.input === ''
      ? 'not set. Copy .env.example to .env.local, set DATABASE_URL to your Postgres connection string, then restart the dev server'
      : 'must be a postgres:// or postgresql:// URL',
  }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  CHAPTER_ZIP_MAX_BYTES: z.coerce.number().int().min(1_048_576).max(1_073_741_824).default(250 * 1024 * 1024),
  CHAPTER_IMAGE_MAX_BYTES: z.coerce.number().int().min(1_048_576).max(200 * 1024 * 1024).default(40 * 1024 * 1024),
  CHAPTER_IMAGE_MIN_WIDTH: z.coerce.number().int().min(1).default(64),
  CHAPTER_IMAGE_MIN_HEIGHT: z.coerce.number().int().min(1).default(16),
  CHAPTER_IMAGE_MAX_WIDTH: z.coerce.number().int().max(50_000).default(20_000),
  CHAPTER_IMAGE_MAX_HEIGHT: z.coerce.number().int().max(200_000).default(120_000),
  CHAPTER_ARCHIVE_MAX_ENTRIES: z.coerce.number().int().min(1).max(5000).default(1500),
  CHAPTER_ARCHIVE_MAX_EXPANDED_BYTES: z.coerce.number().int().min(1_048_576).max(2_147_483_648).default(1_000_000_000),
  NERIO_STORAGE_DIR: z.string().min(1).default('./private-storage'),
  /** tesseract = local open-source OCR (default, free); openai_compatible = optional external vision model; mock = fixed fake output. */
  OCR_PROVIDER: z.enum(['tesseract', 'mock', 'openai_compatible']).default('tesseract'),
  /** Where tesseract.js keeps downloaded language data. Point TESSERACT_LANG_PATH at a folder of *.traineddata(.gz) to run fully offline. */
  TESSERACT_CACHE_DIR: z.string().min(1).default('./.cache/tesseract'),
  TESSERACT_LANG_PATH: z.preprocess(unsetIfBlank, z.string().optional()),
  /** Words Tesseract is less sure about than this (0–100) are treated as noise on artwork. */
  OCR_MIN_WORD_CONFIDENCE: z.coerce.number().min(0).max(100).default(50),
  /** Chapters OCR'd at the same time in the manual workflow, and Tesseract workers per process. */
  OCR_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  OCR_WORKERS: z.coerce.number().int().min(1).max(8).default(2),
  /** Final page images rendered at the same time after manual translations are saved. */
  FINALIZE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  /** Publish manually translated chapters as soon as every page is finalized without blocking errors. */
  AUTO_PUBLISH_TRANSLATED_CHAPTERS: flag(false),
  /** Saved manual translations count as approved (no separate approval pass). */
  MANUAL_TRANSLATION_AUTO_APPROVE: flag(true),
  TRANSLATION_PROVIDER: z.enum(['mock', 'openai_compatible']).default('mock'),
  AI_API_BASE_URL: z.url({ protocol: /^https$/ }).default('https://api.openai.com/v1'),
  AI_API_KEY: z.string().optional(),
  OCR_MODEL: z.string().min(1).default('gpt-4o-mini'),
  TRANSLATION_MODEL: z.string().min(1).default('gpt-4o-mini'),
  OCR_CONFIDENCE_MIN: z.coerce.number().min(0).max(1).default(0.65),
  TRANSLATION_CONFIDENCE_MIN: z.coerce.number().min(0).max(1).default(0.65),
  /** Concurrent OCR/translation requests across the whole server process. */
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  /** Chapters translated at the same time by the in-process worker. */
  TRANSLATION_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  /** local = erase lettering from detected balloon shapes; http_json = external inpainting service; mock = none. */
  IMAGE_CLEANUP_PROVIDER: z.enum(['local', 'mock', 'http_json']).default('local'),
  IMAGE_CLEANUP_URL: z.string().optional(),
  TYPESET_MIN_FONT_SIZE: z.coerce.number().int().min(8).max(24).default(12),
  TYPESET_MAX_FONT_SIZE: z.coerce.number().int().min(12).max(72).default(36),
  TYPESET_LINE_HEIGHT: z.coerce.number().min(1).max(2).default(1.18),
  TYPESET_BUBBLE_PADDING: z.coerce.number().min(0).max(0.3).default(0.1),
  TYPESET_ALIGNMENT: z.enum(['left', 'center', 'right']).default('center'),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Report variable names only, never values.
    const vars = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid server environment: ${vars}`);
  }
  cached = parsed.data;
  return cached;
}

/** `FOO=` in an env file means "not set". */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v);

const oauthSchema = z.object({
  /** Public origin used to build OAuth redirect URIs, e.g. https://nerio.app. */
  NEXT_PUBLIC_APP_URL: z.preprocess(blankToUndefined, z.url({ protocol: /^https?$/ }).default('http://localhost:3000')),
  GOOGLE_CLIENT_ID: z.preprocess(blankToUndefined, z.string().optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
});

export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

/** Google sign-in settings, or null when not configured (the Google button is then hidden). */
export function googleOAuthConfig(): GoogleOAuthConfig | null {
  const parsed = oauthSchema.safeParse(process.env);
  if (!parsed.success) throw new Error(`Invalid OAuth environment: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, NEXT_PUBLIC_APP_URL: appUrl } = parsed.data;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: new URL('/auth/google/callback', appUrl).toString() };
}
