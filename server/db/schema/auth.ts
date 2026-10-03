import { index, integer, pgTable, primaryKey, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, tstz } from './_shared';
import { users } from './identity';

/**
 * Server-side sessions. The browser holds a random 256-bit token in an httpOnly cookie;
 * only its SHA-256 hash is stored here, so a database leak can't be replayed as live sessions.
 */
export const sessions = pgTable('sessions', {
  /** hex(SHA-256(token)). */
  id: varchar({ length: 64 }).primaryKey(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: tstz().notNull(),
  lastUsedAt: tstz().notNull().defaultNow(),
  ipAddress: varchar({ length: 64 }),
  userAgent: text(),
  createdAt: createdAt(),
}, t => [
  index('sessions_user_idx').on(t.userId),
  index('sessions_expires_idx').on(t.expiresAt),
]);

/** Fixed-window counters for auth endpoints (login, registration), shared by every app instance. */
export const authRateLimits = pgTable('auth_rate_limits', {
  /** e.g. `login:email:<sha256>` or `login:ip:<ip>`. */
  key: varchar({ length: 128 }).primaryKey(),
  attempts: integer().notNull().default(0),
  resetAt: tstz().notNull(),
}, t => [
  index('auth_rate_limits_reset_idx').on(t.resetAt),
]);

/** External identities (Sign in with Google). One provider account maps to exactly one user. */
export const oauthAccounts = pgTable('oauth_accounts', {
  provider: varchar({ length: 32 }).notNull(),
  /** The provider's stable user id (`sub` claim), never the email. */
  providerUserId: varchar({ length: 255 }).notNull(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  email: varchar({ length: 320 }),
  createdAt: createdAt(),
  lastUsedAt: tstz().notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.provider, t.providerUserId] }),
  uniqueIndex('oauth_accounts_user_provider_uq').on(t.userId, t.provider),
]);
