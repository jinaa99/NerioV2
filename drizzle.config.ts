import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs outside Next.js, so it reads DATABASE_URL straight from the shell or .env.local.
// Only `migrate`/`studio`/`push` need it; `generate` works offline.
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local: rely on the shell environment.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
