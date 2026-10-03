import 'server-only';
/**
 * Bank-transfer Premium purchases. Nothing here moves money: readers start a transfer and an
 * admin confirms it against the bank statement, which grants Premium.
 */
import { randomBytes } from 'node:crypto';
import { and, count, desc, eq } from 'drizzle-orm';
import { createPaymentInput, pagination, type CreatePaymentInput, type Pagination } from '@/lib/validation';
import { z } from 'zod';
import { requireActor, requireRole } from '../auth/actor';
import { db } from '../db/client';
import { notifications, paymentRecords, profiles, users } from '../db/schema';
import { DalError, parseInput } from '../errors';
import { recordAudit } from './audit';

type Plan = (typeof paymentRecords.$inferSelect)['plan'];

/** Server-side price list. The client only ever sends a plan key; amounts are never taken from input. */
export const PLANS: Record<Plan, { periodDays: number; amountCents: number; currency: 'EUR' }> = {
  '1m': { periodDays: 30, amountCents: 499, currency: 'EUR' },
  '3m': { periodDays: 90, amountCents: 1299, currency: 'EUR' },
  '12m': { periodDays: 365, amountCents: 4499, currency: 'EUR' },
};

// Unambiguous alphabet (no 0/O, 1/I) for codes typed into bank transfer memos.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function referenceCode() {
  const bytes = randomBytes(6);
  return `NER-${Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('')}`;
}

const myPaymentColumns = {
  id: paymentRecords.id, plan: paymentRecords.plan, amountCents: paymentRecords.amountCents, currency: paymentRecords.currency,
  status: paymentRecords.status, referenceCode: paymentRecords.referenceCode, createdAt: paymentRecords.createdAt,
  periodStart: paymentRecords.periodStart, periodEnd: paymentRecords.periodEnd,
};

/** Start a bank-transfer purchase. Reuses an existing pending record so repeat clicks don't pile up. */
export async function createPendingPayment(input: CreatePaymentInput) {
  const actor = await requireActor();
  const { plan } = parseInput(createPaymentInput, input);
  const price = PLANS[plan];

  const [existing] = await db().select(myPaymentColumns).from(paymentRecords)
    .where(and(eq(paymentRecords.userId, actor.userId), eq(paymentRecords.status, 'pending'), eq(paymentRecords.plan, plan)));
  if (existing) return existing;

  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db().insert(paymentRecords)
      .values({ userId: actor.userId, plan, ...price, referenceCode: referenceCode() })
      .onConflictDoNothing({ target: paymentRecords.referenceCode })
      .returning(myPaymentColumns);
    if (row) return row;
  }
  throw new DalError('CONFLICT', 'Couldn’t create a payment reference. Try again.');
}

export async function listMyPayments() {
  const actor = await requireActor();
  return db().select(myPaymentColumns).from(paymentRecords).where(eq(paymentRecords.userId, actor.userId)).orderBy(desc(paymentRecords.createdAt));
}

const statuses = ['pending', 'confirmed', 'rejected', 'refunded'] as const;

export type AdminPaymentDTO = {
  id: string; plan: Plan; amountCents: number; currency: string; status: (typeof statuses)[number]; referenceCode: string;
  externalReference: string | null; createdAt: Date; reviewedAt: Date | null; periodEnd: Date | null; notes: string | null;
  userId: string; email: string; displayName: string | null;
};

export async function listPayments(input: Pagination & { status?: (typeof statuses)[number] } = {}) {
  await requireRole('admin');
  const { limit, offset, status } = parseInput(pagination.extend({ status: z.enum(statuses).optional() }), input);
  const where = status ? eq(paymentRecords.status, status) : undefined;
  const [items, [{ total }]] = await Promise.all([
    db()
      .select({
        id: paymentRecords.id, plan: paymentRecords.plan, amountCents: paymentRecords.amountCents, currency: paymentRecords.currency,
        status: paymentRecords.status, referenceCode: paymentRecords.referenceCode, externalReference: paymentRecords.externalReference,
        createdAt: paymentRecords.createdAt, reviewedAt: paymentRecords.reviewedAt, periodEnd: paymentRecords.periodEnd, notes: paymentRecords.notes,
        userId: users.id, email: users.email, displayName: profiles.displayName,
      })
      .from(paymentRecords)
      .innerJoin(users, eq(users.id, paymentRecords.userId))
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(where)
      // Oldest pending first (FIFO); otherwise newest first.
      .orderBy(status === 'pending' ? paymentRecords.createdAt : desc(paymentRecords.createdAt))
      .limit(limit)
      .offset(offset),
    db().select({ total: count() }).from(paymentRecords).where(where),
  ]);
  return { items: items as AdminPaymentDTO[], total, limit, offset };
}

const PLAN_LABEL: Record<Plan, string> = { '1m': '1 month', '3m': '3 months', '12m': '12 months' };

/**
 * Confirm a transfer that arrived. Premium is extended from the later of now or the current
 * expiry, so renewing early never loses days. Audited; the reader is notified.
 */
export async function confirmPayment(paymentId: string, externalReference: string) {
  const actor = await requireRole('admin');
  const id = parseInput(z.uuid(), paymentId);
  const bankRef = parseInput(z.string().trim().min(1, 'Enter the bank transaction reference').max(128), externalReference);
  return db().transaction(async tx => {
    const [p] = await tx.select({ userId: paymentRecords.userId, periodDays: paymentRecords.periodDays, plan: paymentRecords.plan, amountCents: paymentRecords.amountCents })
      .from(paymentRecords).where(and(eq(paymentRecords.id, id), eq(paymentRecords.status, 'pending'))).for('update');
    if (!p) throw new DalError('CONFLICT', 'This payment isn’t pending anymore.');
    const [prof] = await tx.select({ until: profiles.premiumUntil }).from(profiles).where(eq(profiles.userId, p.userId)).for('update');
    const now = new Date();
    const start = prof?.until && prof.until > now ? prof.until : now;
    const end = new Date(start.getTime() + p.periodDays * 86_400_000);
    await tx.update(paymentRecords).set({ status: 'confirmed', externalReference: bankRef, reviewedBy: actor.userId, reviewedAt: now, periodStart: start, periodEnd: end })
      .where(eq(paymentRecords.id, id));
    await tx.update(profiles).set({ premiumUntil: end }).where(eq(profiles.userId, p.userId));
    await tx.insert(notifications).values({
      userId: p.userId, type: 'payment_confirmed', title: 'Premium is active',
      body: `Your ${PLAN_LABEL[p.plan]} transfer arrived. Premium runs until ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`,
      href: '/premium', data: { paymentId: id },
    });
    await recordAudit(tx, actor, { action: 'payment.confirm', targetType: 'payment', targetId: id, metadata: { userId: p.userId, plan: p.plan, amountCents: p.amountCents, bankRef, premiumUntil: end.toISOString() } });
    return { premiumUntil: end };
  });
}

/** Mark a claimed transfer as not received. Audited; the reader is notified. */
export async function rejectPayment(paymentId: string, note: string) {
  const actor = await requireRole('admin');
  const id = parseInput(z.uuid(), paymentId);
  const reason = parseInput(z.string().trim().max(500), note);
  return db().transaction(async tx => {
    const [p] = await tx.update(paymentRecords).set({ status: 'rejected', reviewedBy: actor.userId, reviewedAt: new Date(), notes: reason || null })
      .where(and(eq(paymentRecords.id, id), eq(paymentRecords.status, 'pending')))
      .returning({ userId: paymentRecords.userId, referenceCode: paymentRecords.referenceCode });
    if (!p) throw new DalError('CONFLICT', 'This payment isn’t pending anymore.');
    await tx.insert(notifications).values({
      userId: p.userId, type: 'payment_rejected', title: 'We couldn’t find your transfer',
      body: reason || `No transfer with reference ${p.referenceCode} has arrived. Check the reference code and try again.`,
      href: '/premium', data: { paymentId: id },
    });
    await recordAudit(tx, actor, { action: 'payment.reject', targetType: 'payment', targetId: id, metadata: { userId: p.userId, note: reason || null } });
  });
}

export async function countPendingPayments() {
  await requireRole('admin');
  const [row] = await db().select({ n: count() }).from(paymentRecords).where(eq(paymentRecords.status, 'pending'));
  return row?.n ?? 0;
}


/* Reader side */

export type MyPremiumStateDTO = {
  premiumUntil: Date | null;
  /** Most recent payment, if any. */
  latest: { id: string; plan: Plan; amountCents: number; currency: string; status: (typeof statuses)[number]; referenceCode: string; submittedReference: string | null; createdAt: Date; periodEnd: Date | null; notes: string | null } | null;
};

export async function getMyPremiumState(): Promise<MyPremiumStateDTO> {
  const actor = await requireActor();
  const [[prof], [latest]] = await Promise.all([
    db().select({ until: profiles.premiumUntil }).from(profiles).where(eq(profiles.userId, actor.userId)),
    db().select({
      id: paymentRecords.id, plan: paymentRecords.plan, amountCents: paymentRecords.amountCents, currency: paymentRecords.currency, status: paymentRecords.status,
      referenceCode: paymentRecords.referenceCode, submittedReference: paymentRecords.externalReference, createdAt: paymentRecords.createdAt,
      periodEnd: paymentRecords.periodEnd, notes: paymentRecords.notes,
    }).from(paymentRecords).where(eq(paymentRecords.userId, actor.userId)).orderBy(desc(paymentRecords.createdAt)).limit(1),
  ]);
  return { premiumUntil: prof?.until ?? null, latest: latest ?? null };
}

/** Reader: record the bank's transaction reference for their own pending payment, so admins can match it. */
export async function submitTransfer(paymentId: string, reference: string) {
  const actor = await requireActor();
  const id = parseInput(z.uuid(), paymentId);
  const ref = parseInput(z.string().trim().min(6, 'Enter the reference from your bank receipt (at least 6 characters).').max(128), reference);
  const [row] = await db().update(paymentRecords).set({ externalReference: ref })
    .where(and(eq(paymentRecords.id, id), eq(paymentRecords.userId, actor.userId), eq(paymentRecords.status, 'pending')))
    .returning({ id: paymentRecords.id });
  if (!row) throw new DalError('NOT_FOUND', 'Payment not found.');
  return row;
}
