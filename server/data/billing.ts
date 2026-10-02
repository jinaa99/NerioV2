import 'server-only';
/**
 * Payment records only. Nothing here moves money or grants Premium; confirming a transfer
 * (and extending `profiles.premium_until`) belongs to the payments phase.
 */
import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { createPaymentInput, pagination, type CreatePaymentInput, type Pagination } from '@/lib/validation';
import { z } from 'zod';
import { requireActor, requireRole } from '../auth/actor';
import { db } from '../db/client';
import { paymentRecords, profiles, users } from '../db/schema';
import { DalError, parseInput } from '../errors';

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

export async function listPayments(input: Pagination & { status?: (typeof statuses)[number][] } = {}) {
  await requireRole('admin');
  const { limit, offset, status } = parseInput(pagination.extend({ status: z.array(z.enum(statuses)).optional() }), input);
  return db()
    .select({ ...myPaymentColumns, externalReference: paymentRecords.externalReference, userId: users.id, email: users.email, displayName: profiles.displayName })
    .from(paymentRecords)
    .innerJoin(users, eq(users.id, paymentRecords.userId))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(status?.length ? inArray(paymentRecords.status, status) : undefined)
    .orderBy(desc(paymentRecords.createdAt))
    .limit(limit)
    .offset(offset);
}
