import { sql } from 'drizzle-orm';
import { char, check, index, integer, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_shared';
import { paymentMethod, paymentStatus, premiumPlan } from './enums';
import { users } from './identity';

/**
 * A Premium purchase. Today that is a manual bank transfer the reader starts and an admin confirms.
 * No payment processing happens in-app; this table only records state.
 */
export const paymentRecords = pgTable('payment_records', {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'restrict' }),
  plan: premiumPlan().notNull(),
  periodDays: integer().notNull(),
  /** Minor units (cents) to avoid floating-point money. */
  amountCents: integer().notNull(),
  currency: char({ length: 3 }).notNull().default('EUR'),
  method: paymentMethod().notNull().default('bank_transfer'),
  status: paymentStatus().notNull().default('pending'),
  /** Code the reader puts in the transfer memo, e.g. NER-7F3K2Q. */
  referenceCode: varchar({ length: 32 }).notNull().unique(),
  /** Bank/SEPA transaction id entered by the admin on confirmation. */
  externalReference: varchar({ length: 128 }),
  /** Reader-provided receipt/transaction reference; kept separate from the bank-verified reference. */
  submittedReference: varchar({ length: 128 }),
  reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: tstz(),
  /** Premium window granted by this payment (set on confirmation). */
  periodStart: tstz(),
  periodEnd: tstz(),
  notes: text(),
  ...timestamps(),
}, t => [
  index('payment_records_user_idx').on(t.userId, t.createdAt.desc()),
  index('payment_records_status_idx').on(t.status, t.createdAt),
  uniqueIndex('payment_records_pending_user_plan_uq').on(t.userId, t.plan).where(sql`${t.status} = 'pending'`),
  check('payment_records_amount_positive', sql`${t.amountCents} > 0`),
  check('payment_records_period_positive', sql`${t.periodDays} > 0`),
  check('payment_records_currency_upper', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  check('payment_records_period_order', sql`${t.periodEnd} is null or ${t.periodEnd} > ${t.periodStart}`),
]);
