import { revalidatePath } from 'next/cache';
import { DalError } from '@/server/errors';
import { runTranslationJob } from '@/server/data/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: 'Upload origin is not allowed.' }, { status: 403 });
  const { jobId } = await context.params;
  try {
    const result = await runTranslationJob(jobId);
    revalidatePath('/admin', 'layout');
    revalidatePath('/admin/processing');
    revalidatePath('/admin/queue');
    return Response.json(result);
  } catch (error) {
    if (error instanceof DalError) {
      const status = error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_INPUT' ? 400 : 409;
      return Response.json({ error: error.message }, { status });
    }
    return Response.json({ error: 'Translation job failed. Check the job details and provider configuration.' }, { status: 500 });
  }
}
