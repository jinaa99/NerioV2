import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { serverEnv } from '../env';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
/** Either the root client or a transaction handle; DAL helpers accept both. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

// Reuse one pool across dev hot reloads instead of leaking a new one per edit.
const globalForDb = globalThis as unknown as { nerioDb?: Database };

/** Lazily-created Drizzle client. Throws with a clear message if DATABASE_URL is missing. */
export function db(): Database {
  if (globalForDb.nerioDb) return globalForDb.nerioDb;
  const env = serverEnv();
  const client = postgres(env.DATABASE_URL, {
    max: env.DATABASE_POOL_MAX,
    // Transaction-mode poolers (PgBouncer, Supabase, Neon) don't support prepared statements.
    prepare: false,
    // Close idle sockets before managed poolers/NATs silently drop them (a dropped socket hangs until ETIMEDOUT).
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 15,
  });
  const instance = drizzle(client, { schema, casing: 'snake_case' });
  globalForDb.nerioDb = instance;
  return instance;
}
