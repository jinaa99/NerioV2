import 'server-only';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { pagination, slug as slugSchema, type Pagination } from '@/lib/validation';
import { z } from 'zod';
import { requireActor, requireRole } from '../auth/actor';
import { db } from '../db/client';
import { chapters, contentReports, notifications, profiles, series } from '../db/schema';
import { DalError, parseInput } from '../errors';
import { recordAudit } from './audit';

export const REPORT_KINDS = ['wrong_translation', 'missing_page', 'text_overflow', 'image_quality', 'other'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export type ReportStatus = 'open' | 'resolved' | 'dismissed';

const createReportInput = z.object({
  seriesSlug: slugSchema,
  chapterNumber: z.number().min(0).max(99_999.99).optional(),
  pageNumber: z.number().int().min(1).max(10_000).optional(),
  kind: z.enum(REPORT_KINDS),
  message: z.string().trim().min(3, 'Tell us a little more').max(2000),
}).strict();
export type CreateReportInput = z.input<typeof createReportInput>;

/** Reader: report a problem with a series or chapter. Limited to 20 reports per user per day. */
export async function createReport(input: CreateReportInput) {
  const actor = await requireActor();
  const data = parseInput(createReportInput, input);
  const [{ recent }] = await db().select({ recent: count() }).from(contentReports)
    .where(and(eq(contentReports.reporterId, actor.userId), gt(contentReports.createdAt, sql`now() - interval '1 day'`)));
  if (recent >= 20) throw new DalError('CONFLICT', 'You’ve sent a lot of reports today. Try again tomorrow.');
  const [s] = await db().select({ id: series.id }).from(series).where(and(eq(series.slug, data.seriesSlug), isNull(series.deletedAt)));
  if (!s) throw new DalError('NOT_FOUND', 'Series not found.');
  let chapterId: string | null = null;
  if (data.chapterNumber !== undefined) {
    const [c] = await db().select({ id: chapters.id }).from(chapters).where(and(eq(chapters.seriesId, s.id), eq(chapters.number, data.chapterNumber)));
    if (!c) throw new DalError('NOT_FOUND', 'Chapter not found.');
    chapterId = c.id;
  }
  const [row] = await db().insert(contentReports).values({
    reporterId: actor.userId, seriesId: s.id, chapterId, pageNumber: data.pageNumber ?? null, kind: data.kind, message: data.message,
  }).returning({ id: contentReports.id });
  return row;
}

export type AdminReportDTO = {
  id: string; kind: ReportKind; message: string; status: ReportStatus; pageNumber: number | null; createdAt: Date;
  resolvedAt: Date | null; resolutionNote: string | null;
  series: { title: string; slug: string }; chapterNumber: number | null; reporter: string | null;
};

export async function listReports(input: Pagination & { status?: ReportStatus } = {}) {
  await requireRole('editor');
  const q = parseInput(pagination.extend({ status: z.enum(['open', 'resolved', 'dismissed']).default('open') }), input);
  const where = eq(contentReports.status, q.status);
  const [rows, [{ total }]] = await Promise.all([
    db().select({
      id: contentReports.id, kind: contentReports.kind, message: contentReports.message, status: contentReports.status,
      pageNumber: contentReports.pageNumber, createdAt: contentReports.createdAt, resolvedAt: contentReports.resolvedAt, resolutionNote: contentReports.resolutionNote,
      seriesTitle: series.title, seriesSlug: series.slug, chapterNumber: chapters.number, reporter: profiles.username,
    })
      .from(contentReports)
      .innerJoin(series, eq(series.id, contentReports.seriesId))
      .leftJoin(chapters, eq(chapters.id, contentReports.chapterId))
      .leftJoin(profiles, eq(profiles.userId, contentReports.reporterId))
      .where(where)
      .orderBy(q.status === 'open' ? contentReports.createdAt : desc(contentReports.resolvedAt))
      .limit(q.limit).offset(q.offset),
    db().select({ total: count() }).from(contentReports).where(where),
  ]);
  return {
    items: rows.map(r => ({
      id: r.id, kind: r.kind, message: r.message, status: r.status, pageNumber: r.pageNumber, createdAt: r.createdAt,
      resolvedAt: r.resolvedAt, resolutionNote: r.resolutionNote, series: { title: r.seriesTitle, slug: r.seriesSlug },
      chapterNumber: r.chapterNumber, reporter: r.reporter,
    })) as AdminReportDTO[],
    total, limit: q.limit, offset: q.offset,
  };
}

/** Close a report as resolved (fixed) or dismissed (no action). Audited; the reporter is notified. */
export async function resolveReport(reportId: string, outcome: 'resolved' | 'dismissed', note: string) {
  const actor = await requireRole('editor');
  const id = parseInput(z.uuid(), reportId);
  const status = parseInput(z.enum(['resolved', 'dismissed']), outcome);
  const text = parseInput(z.string().trim().max(500), note);
  return db().transaction(async tx => {
    const [r] = await tx.update(contentReports).set({ status, resolvedBy: actor.userId, resolvedAt: new Date(), resolutionNote: text || null })
      .where(and(eq(contentReports.id, id), eq(contentReports.status, 'open')))
      .returning({ reporterId: contentReports.reporterId, seriesId: contentReports.seriesId, kind: contentReports.kind });
    if (!r) throw new DalError('CONFLICT', 'This report is already closed.');
    if (r.reporterId) {
      const [s] = await tx.select({ title: series.title, slug: series.slug }).from(series).where(eq(series.id, r.seriesId));
      await tx.insert(notifications).values({
        userId: r.reporterId, type: 'report_update',
        title: status === 'resolved' ? `Fixed: your report on ${s.title}` : `Reviewed: your report on ${s.title}`,
        body: text || (status === 'resolved' ? 'Thanks for flagging it. The issue has been fixed.' : 'Thanks for the report. We looked into it and didn’t change anything this time.'),
        href: `/series/${s.slug}`, data: { reportId: id },
      });
    }
    await recordAudit(tx, actor, { action: `report.${status === 'resolved' ? 'resolve' : 'dismiss'}`, targetType: 'report', targetId: id, metadata: { kind: r.kind, note: text || null } });
  });
}

export async function countOpenReports() {
  await requireRole('editor');
  const [row] = await db().select({ n: count() }).from(contentReports).where(eq(contentReports.status, 'open'));
  return row?.n ?? 0;
}
