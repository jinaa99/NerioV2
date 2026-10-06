import 'server-only';
import { inArray } from 'drizzle-orm';
import type { Actor } from '@/server/auth/actor';
import { db } from '@/server/db/client';
import { translationJobs } from '@/server/db/schema';
import { serverEnv } from '@/server/env';
import { createJobQueue } from './job-queue';
import { runOcrJobAs } from './ocr-runner';
import { runTranslationJobAs } from './runner';

/**
 * In-process background queues so many chapters can be processed in one go without holding a request open.
 * AI-workflow jobs (OCR → machine translation) and manual-workflow OCR jobs run in separate bounded queues, so a
 * long OCR batch never blocks anything else; manual translation itself is plain request/response work.
 * Progress and failures are persisted on the job rows, so the admin UI polls the database, not these queues.
 */
type Item = { actor: Actor | null; jobId: string };
const aiQueue = createJobQueue<Item>('translation', () => serverEnv().TRANSLATION_JOB_CONCURRENCY, ({ actor, jobId }) => runTranslationJobAs(actor!, jobId));
const ocrQueue = createJobQueue<Item>('manual-ocr', () => serverEnv().OCR_JOB_CONCURRENCY, ({ actor, jobId }) => runOcrJobAs(actor, jobId));

/** Queue jobs for background processing; resolves when every job started from this call (and its followers) settles. */
export async function enqueueTranslationJobs(actor: Actor, jobIds: string[]): Promise<{ accepted: string[]; done: Promise<void> }> {
  if (!jobIds.length) return { accepted: [], done: Promise.resolve() };
  const rows = await db().select({ id: translationJobs.id, workflow: translationJobs.workflow }).from(translationJobs).where(inArray(translationJobs.id, jobIds));
  const manual = rows.filter(row => row.workflow === 'manual').map(row => row.id);
  const ai = rows.filter(row => row.workflow !== 'manual').map(row => row.id);
  const a = aiQueue.enqueue(ai.map(jobId => ({ key: jobId, payload: { actor, jobId } })));
  const m = ocrQueue.enqueue(manual.map(jobId => ({ key: jobId, payload: { actor, jobId } })));
  return { accepted: [...a.accepted, ...m.accepted], done: Promise.all([a.done, m.done]).then(() => undefined) };
}

export function queuedOrRunning(jobId: string): boolean {
  return aiQueue.has(jobId) || ocrQueue.has(jobId);
}
