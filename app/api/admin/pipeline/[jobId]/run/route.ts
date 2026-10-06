import { after } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireRole } from '@/server/auth/actor';
import { db } from '@/server/db/client';
import { translationJobs } from '@/server/db/schema';
import { getSettings } from '@/server/data/settings';
import { enqueueTranslationJobs } from '@/server/ai/worker';

export const runtime = 'nodejs';
export const maxDuration = 800;

/** Start one queued job in the background. Progress is read from the job row. */
export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: 'Upload origin is not allowed.' }, { status: 403 });
  let actor;
  try { actor = await requireRole('editor'); }
  catch (error) {
    const unauthenticated = (error as { code?: string }).code === 'UNAUTHENTICATED';
    return Response.json({ error: unauthenticated ? 'Sign in to run translation jobs.' : 'You do not have permission to run translation jobs.' }, { status: unauthenticated ? 401 : 403 });
  }
  const { jobId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return Response.json({ error: 'Invalid job id.' }, { status: 400 });
  if ((await getSettings()).pausePipeline) return Response.json({ error: 'The pipeline is paused in Settings.' }, { status: 409 });
  const [job] = await db().select({ id: translationJobs.id }).from(translationJobs).where(and(eq(translationJobs.id, jobId), eq(translationJobs.status, 'queued')));
  if (!job) return Response.json({ error: 'Only queued translation jobs can be run.' }, { status: 409 });
  const { done } = await enqueueTranslationJobs(actor, [job.id]);
  after(() => done);
  return Response.json({ started: true, id: job.id }, { status: 202 });
}
