import { and, eq, isNull, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { requireRole } from '@/server/auth/actor';
import { db } from '@/server/db/client';
import { chapterPages, chapters, series, translationJobs } from '@/server/db/schema';
import { IngestionError, inspectChapterZip } from '@/server/chapter-ingestion';
import { putImage, deleteImage } from '@/server/storage';
import { serverEnv } from '@/server/env';
import { recordAudit } from '@/server/data/audit';

export const runtime = 'nodejs';
export const maxDuration = 300;

const jsonError = (message: string, status: number, code: string) => Response.json({ error: message, code }, { status });

export async function POST(request: Request) {
  let actor;
  try { actor = await requireRole('editor'); }
  catch (error) { const e = error as { code?: string; message?: string }; return jsonError(e.code === 'UNAUTHENTICATED' ? 'Sign in to upload chapters.' : 'You do not have permission to upload chapters.', e.code === 'UNAUTHENTICATED' ? 401 : 403, e.code ?? 'FORBIDDEN'); }
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > serverEnv().CHAPTER_ZIP_MAX_BYTES + 1_000_000) return jsonError('ZIP file exceeds the upload size limit.', 413, 'zip_too_large');
  if (!request.body) return jsonError('Upload body is missing.', 400, 'invalid_upload');
  const reader = request.body.getReader();
  const bodyChunks: Uint8Array[] = [];
  let bodyLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bodyLength += chunk.value.byteLength;
      if (bodyLength > serverEnv().CHAPTER_ZIP_MAX_BYTES + 1_000_000) {
        await reader.cancel();
        return jsonError('ZIP file exceeds the upload size limit.', 413, 'zip_too_large');
      }
      bodyChunks.push(chunk.value);
    }
  } catch { return jsonError('Could not read the upload body.', 400, 'invalid_upload'); }
  let form: FormData;
  try { form = await new Response(Buffer.concat(bodyChunks.map(chunk => Buffer.from(chunk))), { headers: request.headers }).formData(); }
  catch { return jsonError('Could not read the upload. Send a multipart form with a ZIP file.', 400, 'invalid_upload'); }
  const file = form.get('file');
  const seriesId = String(form.get('seriesId') ?? '');
  const number = Number(form.get('number'));
  const title = String(form.get('title') ?? '').trim().slice(0, 200) || null;
  if (!(file instanceof File)) return jsonError('Choose a ZIP file to upload.', 400, 'missing_file');
  if (!/^[0-9a-f-]{36}$/i.test(seriesId) || !Number.isFinite(number) || number < 0 || number > 99999) return jsonError('Choose a valid series and chapter number.', 400, 'invalid_chapter');
  if (file.size > serverEnv().CHAPTER_ZIP_MAX_BYTES) return jsonError('ZIP file exceeds the upload size limit.', 413, 'zip_too_large');
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return jsonError('Upload origin is not allowed.', 403, 'invalid_origin');
  const zipData = Buffer.from(await file.arrayBuffer());
  let pages;
  try { pages = await inspectChapterZip(zipData, file.name, file.type); }
  catch (error) {
    if (error instanceof IngestionError) return jsonError(error.message, error.code === 'zip_too_large' ? 413 : 422, error.code);
    return jsonError('The ZIP could not be processed. Verify the archive and try again.', 422, 'invalid_zip');
  }
  const [seriesRow] = await db().select({ id: series.id, sourceLanguage: series.sourceLanguage }).from(series).where(and(eq(series.id, seriesId), isNull(series.deletedAt)));
  if (!seriesRow) return jsonError('Series not found.', 404, 'series_not_found');
  const operationKey = createHash('sha256').update(`${actor.userId}:${seriesId}:${number}:`).update(zipData).digest('hex');
  const [prior] = await db().select({ chapterId: translationJobs.chapterId, jobId: translationJobs.id, pageCount: chapters.pageCount }).from(translationJobs)
    .innerJoin(chapters, eq(chapters.id, translationJobs.chapterId)).where(sql`${translationJobs.options}->>'operationKey' = ${operationKey}`).limit(1);
  if (prior) return Response.json({ chapterId: prior.chapterId, jobId: prior.jobId, pageCount: prior.pageCount, replayed: true }, { status: 200 });
  const token = randomUUID();
  const keys = pages.map((_, i) => `chapters/${token}/${String(i + 1).padStart(4, '0')}.png`);
  const stored: string[] = [];
  try {
    for (let i = 0; i < pages.length; i++) { await putImage(keys[i], pages[i].bytes); stored.push(keys[i]); }
  } catch {
    await Promise.all(stored.map(deleteImage));
    return jsonError('Image storage failed while saving chapter pages. Try again.', 503, 'storage_error');
  }
  try {
    const result = await db().transaction(async tx => {
      const [chapter] = await tx.insert(chapters).values({ seriesId, number, title, status: 'processing', pageCount: pages.length, createdBy: actor.userId }).returning({ id: chapters.id, number: chapters.number });
      await tx.insert(chapterPages).values(pages.map((page, i) => ({ chapterId: chapter.id, pageNumber: i + 1, sourceKey: keys[i], originalFilename: page.filename.slice(-512), contentHash: page.hash, width: page.width, height: page.height, bytes: page.bytes.length })));
      const [job] = await tx.insert(translationJobs).values({ chapterId: chapter.id, sourceLanguage: seriesRow.sourceLanguage, requestedBy: actor.userId, options: { ingestion: true, operationKey } }).returning({ id: translationJobs.id });
      await recordAudit(tx, actor, { action: 'chapter.upload', targetType: 'chapter', targetId: chapter.id, metadata: { seriesId, number: chapter.number, pages: pages.length, mode: 'zip', jobId: job.id } });
      return { chapterId: chapter.id, jobId: job.id, pageCount: pages.length };
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    await Promise.all(stored.map(deleteImage));
    const cause = error as { code?: string; constraint?: string };
    if (cause.code === '23505') return jsonError('That chapter number already exists in this series.', 409, 'chapter_exists');
    return jsonError('Chapter records could not be saved. Check the series and try again.', 500, 'database_error');
  }
}
