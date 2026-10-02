import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamps, tstz } from './_shared';
import { roleKey, userStatus } from './enums';

/** Account record. Credentials/auth provider data lives here; anything shown publicly belongs in `profiles`. */
export const users = pgTable('users', {
  id: id(),
  email: varchar({ length: 320 }).notNull(),
  emailVerifiedAt: tstz(),
  /** Nullable until an auth strategy is chosen (password, OAuth, magic link). Never select this into a DTO. */
  passwordHash: text(),
  status: userStatus().notNull().default('active'),
  lastSeenAt: tstz(),
  deletedAt: tstz(),
  ...timestamps(),
}, t => [
  uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
  index('users_status_idx').on(t.status),
]);

export type ReaderSettings = {
  width?: 'narrow' | 'standard' | 'wide' | 'fit';
  gap?: 'none' | 'small' | 'large';
  quality?: 'auto' | 'hd' | 'saver';
  bg?: 'black' | 'dim' | 'paper';
  autoHide?: boolean;
};

/** Public-facing profile, 1:1 with `users`. */
export const profiles = pgTable('profiles', {
  userId: uuid().primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  username: varchar({ length: 32 }).notNull(),
  displayName: varchar({ length: 64 }).notNull(),
  avatarUrl: text(),
  bio: varchar({ length: 500 }),
  locale: varchar({ length: 16 }).notNull().default('en'),
  readerSettings: jsonb().$type<ReaderSettings>().notNull().default({}),
  emailOnNewChapter: boolean().notNull().default(true),
  showActivity: boolean().notNull().default(false),
  /** Derived from confirmed `payment_records`; denormalized here for fast access checks. */
  premiumUntil: tstz(),
  ...timestamps(),
}, t => [
  uniqueIndex('profiles_username_lower_uq').on(sql`lower(${t.username})`),
  check('profiles_username_format', sql`${t.username} ~ '^[A-Za-z0-9_.]{3,32}$'`),
]);

export const roles = pgTable('roles', {
  id: id(),
  key: roleKey().notNull().unique(),
  name: varchar({ length: 64 }).notNull(),
  description: text(),
  ...timestamps(),
});

export const userRoles = pgTable('user_roles', {
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid().notNull().references(() => roles.id, { onDelete: 'cascade' }),
  grantedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [
  primaryKey({ columns: [t.userId, t.roleId] }),
  index('user_roles_role_idx').on(t.roleId),
]);
