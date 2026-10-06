import { after } from 'next/server';
import { requireRole } from '@/server/auth/actor';
import { IngestFailure, ingestChapterUpload, type IngestEvent, type IngestResult } from '@/server/ingest';
import { serverEnv } from '@/server/env';
import { getSettings } from '@/server/data/settings';
import { enqueueTranslationJobs } from '@/server/ai/worker';
import { originMatchesUrl } from '@/server/security/origin';

export const runtime = 'nodejs';
export const maxDuration = 300;

const jsonError = (message: string, status: number, code: string) => Response.json({ error: message, code }, { status });

/**
 * Upload one chapter ZIP. Responds with JSON, or — when the client sends `Accept: application/x-ndjson` — streams
 * progress events (validating, extracting, sorting, processing_images, storing) followed by a result or error line.
 * Manual-workflow uploads start OCR in the background right away.
 */
export async function POST(request: Request) {
  let actor;
  try { actor = await requireRole('editor'); }
  catch (error) { const e = error as { code?: string; message?: string }; return jsonError(e.code === 'UNAUTHENTICATED' ? 'Sign in to upload chapters.' : 'You do not have permission to upload chapters.', e.code === 'UNAUTHENTICATED' ? 401 : 403, e.code ?? 'FORBIDDEN'); }
  if (!originMatchesUrl(request.headers.get('origin'), request.url)) return jsonError('Upload origin is not allowed.', 403, 'invalid_origin');
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > serverEnv().CHAPTER_ZIP_MAX_BYTES + 1_000_000) return jsonError('ZIP file exceeds the upload size limit.', 413, 'zip_too_large');
  let form: FormData;
  try { form = await request.formData(); }
  catch { return jsonError('Could not read the upload. Send a multipart form with a ZIP file.', 400, 'invalid_upload'); }

  const startOcr = async (result: IngestResult) => {
    if (result.workflow !== 'manual' || result.replayed || (await getSettings()).pausePipeline) return;
    const { done } = await enqueueTranslationJobs(actor, [result.jobId]);
    after(() => done);
  };

  if (!(request.headers.get('accept') ?? '').includes('application/x-ndjson')) {
    try {
      const result = await ingestChapterUpload(actor, form);
      await startOcr(result);
      return Response.json(result, { status: result.replayed ? 200 : 201 });
    } catch (error) {
      if (error instanceof IngestFailure) return jsonError(error.message, error.status, error.code);
      return jsonError('The ZIP could not be processed. Verify the archive and try again.', 500, 'ingest_failed');
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: object) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      // Extraction reports every entry; forward at most one event per phase step change to keep the stream small.
      let last = '';
      const progress = (event: IngestEvent) => {
        const key = `${event.phase}:${event.total ? Math.floor((event.done / event.total) * 20) : 0}`;
        if (key === last && event.done !== event.total) return;
        last = key; send({ type: 'progress', ...event });
      };
      try {
        const result = await ingestChapterUpload(actor, form, progress);
        await startOcr(result);
        send({ type: 'result', status: result.replayed ? 200 : 201, ...result });
      } catch (error) {
        const failure = error instanceof IngestFailure ? error : new IngestFailure(500, 'ingest_failed', 'The ZIP could not be processed. Verify the archive and try again.');
        send({ type: 'error', status: failure.status, code: failure.code, error: failure.message });
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
