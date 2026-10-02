import 'server-only';
import { z } from 'zod';

/**
 * Server-only environment. This is the only module that reads secrets from `process.env`;
 * importing it from a Client Component fails the build (`server-only`).
 * Parsed lazily so `next build` and pages that never touch the database work without a DB configured.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'DATABASE_URL must be a postgres:// or postgresql:// URL' }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
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
