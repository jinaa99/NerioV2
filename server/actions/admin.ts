'use server';
/**
 * Server Actions for the admin area. Authorization is enforced again in each DAL function
 * (requireRole), so these are thin: call, translate expected errors, refresh admin views.
 */
import { revalidatePath } from 'next/cache';
import type { RoleKey } from '../auth/actor';
import { setUserRole, setUserStatus } from '../data/account';
import { confirmPayment, rejectPayment } from '../data/billing';
import { publishChapter, uploadChapter } from '../data/catalog';
import { approvePage, cancelJob, publishReviewed, queueChapter, retryJob, reviewSegment, sendBack } from '../data/pipeline';
import { resolveReport } from '../data/reports';
import { updateSettings, type SettingsInput } from '../data/settings';
import { DalError } from '../errors';
import type { UploadChapterInput, ReviewSegmentInput } from '@/lib/validation';

export type AdminResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fields?: Record<string, string[]> };

async function run<T>(fn: () => Promise<T>, revalidate: string[] = []): Promise<AdminResult<T>> {
  let data: T;
  try {
    data = await fn();
  } catch (err) {
    if (err instanceof DalError) return { ok: false, error: err.message, fields: err.fields };
    throw err;
  }
  // Nav badges and the dashboard live under the admin layout.
  revalidatePath('/admin', 'layout');
  for (const p of revalidate) revalidatePath(p);
  return { ok: true, data };
}

/* Pipeline */

export async function retryJobAction(jobId: string) {
  return run(() => retryJob(jobId));
}

export async function cancelJobAction(jobId: string) {
  return run(() => cancelJob(jobId));
}

export async function queueChapterAction(chapterId: string) {
  return run(() => queueChapter(chapterId));
}

export async function uploadChapterAction(input: UploadChapterInput) {
  return run(() => uploadChapter(input).then(r => r!));
}

export async function publishUploadedAction(chapterId: string) {
  return run(() => publishChapter(chapterId), ['/']);
}

/* Review */

export async function reviewSegmentAction(input: ReviewSegmentInput) {
  return run(() => reviewSegment(input));
}

export async function approvePageAction(jobId: string, pageNumber: number) {
  return run(() => approvePage(jobId, pageNumber));
}

export async function sendBackAction(jobId: string, note: string) {
  return run(() => sendBack(jobId, note));
}

export async function publishReviewedAction(jobId: string) {
  return run(() => publishReviewed(jobId), ['/']);
}

/* Users & payments */

export async function setUserRoleAction(userId: string, role: RoleKey, granted: boolean) {
  return run(() => setUserRole(userId, role, granted));
}

export async function setUserStatusAction(userId: string, status: 'active' | 'suspended') {
  return run(() => setUserStatus(userId, status));
}

export async function confirmPaymentAction(paymentId: string, externalReference: string) {
  return run(() => confirmPayment(paymentId, externalReference));
}

export async function rejectPaymentAction(paymentId: string, note: string) {
  return run(() => rejectPayment(paymentId, note));
}

/* Reports & settings */

export async function resolveReportAction(reportId: string, outcome: 'resolved' | 'dismissed', note: string) {
  return run(() => resolveReport(reportId, outcome, note));
}

export async function updateSettingsAction(patch: SettingsInput) {
  return run(() => updateSettings(patch), ['/premium']);
}
