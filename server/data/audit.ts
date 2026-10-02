import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { requireRole, type Actor } from '../auth/actor';
import { db, type Executor } from '../db/client';
import { adminAuditLogs } from '../db/schema';
import { pagination, uuid, type Pagination } from '@/lib/validation';
import { parseInput } from '../errors';

type AuditEntry = { action: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> };

/** Write an audit row. Call inside the same transaction as the change so both commit or neither does. */
export async function recordAudit(tx: Executor, actor: Actor | null, entry: AuditEntry) {
  let ipAddress: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ipAddress = h.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) ?? null;
    userAgent = h.get('user-agent')?.slice(0, 500) ?? null;
  } catch {
    // Outside a request (scripts, background jobs): no headers available.
  }
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

export async function listAuditLogs(input: Pagination & { actorId?: string } = {}) {
  await requireRole('admin');
  const { limit, offset, actorId } = parseInput(pagination.extend({ actorId: uuid.optional() }), input);
  return db()
    .select({
      id: adminAuditLogs.id,
      actorId: adminAuditLogs.actorId,
      action: adminAuditLogs.action,
      targetType: adminAuditLogs.targetType,
      targetId: adminAuditLogs.targetId,
      metadata: adminAuditLogs.metadata,
      createdAt: adminAuditLogs.createdAt,
    })
    .from(adminAuditLogs)
    .where(actorId ? eq(adminAuditLogs.actorId, actorId) : undefined)
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(limit)
    .offset(offset);
}
