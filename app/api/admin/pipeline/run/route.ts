import { after } from 'next/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireRole } from '@/server/auth/actor';
import { db } from '@/server/db/client';
import { translationJobs } from '@/server/db/schema';
import { getSettings } from '@/server/data/settings';
import { enqueueTranslationJobs } from '@/server/ai/worker';
import { originMatchesUrl } from '@/server/security/origin';

export const runtime = 'nodejs';
export const maxDuration = 800;

const body = z.object({ jobIds: z.array(z.uuid()).max(200).optional() });

/** Start queued translation jobs in the background: the given ids, or every queued job when none are given. */
export async function POST(request: Request) {
  if (!originMatchesUrl(request.headers.get('origin'), request.url)) return Response.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  let actor;
  try { actor = await requireRole('editor'); }
  catch { return Response.json({ error: 'You do not have permission to run translation jobs.' }, { status: 403 }); }
  if ((await getSettings()).pausePipeline) return Response.json({ error: 'The pipeline is paused in Settings.' }, { status: 409 });
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: 'Send a list of job ids.' }, { status: 400 });
  const rows = await db().select({ id: translationJobs.id }).from(translationJobs)
    .where(parsed.data.jobIds?.length ? and(eq(translationJobs.status, 'queued'), inArray(translationJobs.id, parsed.data.jobIds)) : eq(translationJobs.status, 'queued'))
    .orderBy(asc(translationJobs.createdAt)).limit(200);
  const { accepted, done } = await enqueueTranslationJobs(actor, rows.map(row => row.id));
  // Keeps serverless functions alive until the batch settles; on a Node server the queue simply keeps running.
  after(() => done);
  return Response.json({ started: accepted.length, jobIds: accepted }, { status: 202 });
}
