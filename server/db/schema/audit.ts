import { bigint, index, jsonb, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';
import { users } from './identity';

/** Append-only record of privileged actions. Rows are never updated or deleted by the app. */
export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  /** Null if the actor was later deleted, or for system actions. */
  actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
  /** Dotted verb, e.g. `payment.confirm`, `chapter.publish`, `user.role.grant`. */
  action: varchar({ length: 64 }).notNull(),
  targetType: varchar({ length: 64 }).notNull(),
  targetId: varchar({ length: 64 }),
  /** Before/after values or other context. Must not contain secrets. */
  metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  ipAddress: varchar({ length: 64 }),
  userAgent: text(),
  createdAt: createdAt(),
}, t => [
  index('admin_audit_logs_created_idx').on(t.createdAt.desc()),
  index('admin_audit_logs_actor_idx').on(t.actorId, t.createdAt.desc()),
  index('admin_audit_logs_target_idx').on(t.targetType, t.targetId),
]);
