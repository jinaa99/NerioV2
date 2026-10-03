import 'server-only';
import { z } from 'zod';

/**
 * Server-only environment. This is the only module that reads secrets from `process.env`;
 * importing it from a Client Component fails the build (`server-only`).
 * Parsed lazily so `next build` and pages that never touch the database work without a DB configured.
 */
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
  CHAPTER_IMAGE_MIN_WIDTH: z.coerce.number().int().min(1).default(400),
  CHAPTER_IMAGE_MIN_HEIGHT: z.coerce.number().int().min(1).default(500),
  CHAPTER_IMAGE_MAX_WIDTH: z.coerce.number().int().max(50_000).default(12_000),
  CHAPTER_IMAGE_MAX_HEIGHT: z.coerce.number().int().max(100_000).default(40_000),
  CHAPTER_ARCHIVE_MAX_ENTRIES: z.coerce.number().int().min(1).max(2000).default(500),
  CHAPTER_ARCHIVE_MAX_EXPANDED_BYTES: z.coerce.number().int().min(1_048_576).max(2_147_483_648).default(1_000_000_000),
  NERIO_STORAGE_DIR: z.string().min(1).default('./private-storage'),
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
