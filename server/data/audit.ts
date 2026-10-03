import 'server-only';
import { and, count, desc, eq, ilike, like, or } from 'drizzle-orm';
import { z } from 'zod';
import { requireRole, type Actor } from '../auth/actor';
import { requestMeta } from '../auth/request';
import { db, type Executor } from '../db/client';
import { adminAuditLogs, profiles, users } from '../db/schema';
import { pagination, uuid, type Pagination } from '@/lib/validation';
import { parseInput } from '../errors';

type AuditEntry = { action: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> };

/** Write an audit row. Call inside the same transaction as the change so both commit or neither does. */
export async function recordAudit(tx: Executor, actor: Actor | null, entry: AuditEntry) {
  const { ipAddress, userAgent } = await requestMeta();
  await tx.insert(adminAuditLogs).values({
    actorId: actor?.userId ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
    ipAddress,
    userAgent,
  });
}

export const AUDIT_AREAS = ['series', 'chapter', 'translation_job', 'review', 'user', 'payment', 'report', 'settings'] as const;
export type AuditArea = (typeof AUDIT_AREAS)[number];

export type AuditLogDTO = {
  id: number; action: string; targetType: string; targetId: string | null; metadata: Record<string, unknown>;
  ipAddress: string | null; createdAt: Date; actor: { id: string; name: string | null; email: string } | null;
};

/** Admin: audit trail, newest first, filterable by area (action prefix) and actor. */
export async function listAuditLogs(input: Pagination & { area?: AuditArea; actorId?: string; q?: string } = {}) {
  await requireRole('admin');
  const { limit, offset, area, actorId, q } = parseInput(pagination.extend({
    area: z.enum(AUDIT_AREAS).optional(), actorId: uuid.optional(), q: z.string().trim().max(100).optional(),
  }), input);
  const where = and(
    area ? like(adminAuditLogs.action, `${area}.%`) : undefined,
    actorId ? eq(adminAuditLogs.actorId, actorId) : undefined,
    q ? or(ilike(adminAuditLogs.targetId, `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`), ilike(users.email, `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`)) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db()
      .select({
        id: adminAuditLogs.id, action: adminAuditLogs.action, targetType: adminAuditLogs.targetType, targetId: adminAuditLogs.targetId,
        metadata: adminAuditLogs.metadata, ipAddress: adminAuditLogs.ipAddress, createdAt: adminAuditLogs.createdAt,
        actorId: adminAuditLogs.actorId, actorEmail: users.email, actorName: profiles.displayName,
      })
      .from(adminAuditLogs)
      .leftJoin(users, eq(users.id, adminAuditLogs.actorId))
      .leftJoin(profiles, eq(profiles.userId, adminAuditLogs.actorId))
      .where(where)
      .orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id))
      .limit(limit)
      .offset(offset),
    db().select({ total: count() }).from(adminAuditLogs).leftJoin(users, eq(users.id, adminAuditLogs.actorId)).where(where),
  ]);
  return {
    items: rows.map(({ actorId: aid, actorEmail, actorName, ...r }) => ({ ...r, actor: aid && actorEmail ? { id: aid, name: actorName, email: actorEmail } : null })) as AuditLogDTO[],
    total, limit, offset,
  };
}
