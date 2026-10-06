import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '@/server/auth/actor';
import { db } from '@/server/db/client';
import { chapterPages, chapters, series, translationJobLogs, translationJobs } from '@/server/db/schema';
import { IngestionError, inspectChapterZip, type IngestProgress } from '@/server/chapter-ingestion';
import { putImage, deleteImage } from '@/server/storage';
import { serverEnv } from '@/server/env';
import { recordAudit } from '@/server/data/audit';

/**
 * One chapter ZIP → validated, extracted, naturally sorted, normalized pages in private storage → chapter, page and
 * job rows. Shared by the single-chapter and batch upload screens. Each call is independent: a failure removes only
 * the files this call stored, and re-sending the same ZIP for the same chapter replays the earlier result.
 */
export type IngestEvent = IngestProgress | { phase: 'storing'; done: number; total: number };
export type IngestResult = { chapterId: string; jobId: string; pageCount: number; replayed?: boolean; workflow: 'ai' | 'manual' };
export class IngestFailure extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }

const LANGUAGE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

export async function ingestChapterUpload(actor: Actor, form: FormData, onProgress: (event: IngestEvent) => void = () => {}): Promise<IngestResult> {
  const file = form.get('file');
  const seriesId = String(form.get('seriesId') ?? '');
  const number = Number(form.get('number'));
  const title = String(form.get('title') ?? '').trim().slice(0, 200) || null;
  const sourceLanguage = String(form.get('sourceLanguage') ?? '').trim();
  const targetLanguage = String(form.get('targetLanguage') ?? '').trim() || 'mn';
  const workflow = String(form.get('workflow') ?? 'ai') === 'manual' ? 'manual' : 'ai';
  if ((sourceLanguage && !LANGUAGE.test(sourceLanguage)) || !LANGUAGE.test(targetLanguage)) throw new IngestFailure(400, 'invalid_language', 'Choose valid source and target languages.');
  if (!(file instanceof File)) throw new IngestFailure(400, 'missing_file', 'Choose a ZIP file to upload.');
  if (!/^[0-9a-f-]{36}$/i.test(seriesId) || !Number.isFinite(number) || number < 0 || number > 99999) throw new IngestFailure(400, 'invalid_chapter', 'Choose a valid series and chapter number.');
  if (file.size > serverEnv().CHAPTER_ZIP_MAX_BYTES) throw new IngestFailure(413, 'zip_too_large', 'ZIP file exceeds the upload size limit.');
  const zipData = Buffer.from(await file.arrayBuffer());
  let pages;
  try { pages = await inspectChapterZip(zipData, file.name, file.type, onProgress); }
  catch (error) {
    if (error instanceof IngestionError) throw new IngestFailure(error.code === 'zip_too_large' ? 413 : 422, error.code, error.message);
    throw new IngestFailure(422, 'invalid_zip', 'The ZIP could not be processed. Verify the archive and try again.');
  }
  const [seriesRow] = await db().select({ id: series.id, sourceLanguage: series.sourceLanguage }).from(series).where(and(eq(series.id, seriesId), isNull(series.deletedAt)));
  if (!seriesRow) throw new IngestFailure(404, 'series_not_found', 'Series not found.');
  const operationKey = createHash('sha256').update(`${actor.userId}:${seriesId}:${number}:${sourceLanguage}:${targetLanguage}:${workflow === 'manual' ? 'manual:' : ''}`).update(zipData).digest('hex');
  const [prior] = await db().select({ chapterId: translationJobs.chapterId, jobId: translationJobs.id, pageCount: chapters.pageCount }).from(translationJobs)
    .innerJoin(chapters, eq(chapters.id, translationJobs.chapterId)).where(sql`${translationJobs.options}->>'operationKey' = ${operationKey}`).limit(1);
  if (prior) return { ...prior, replayed: true, workflow };
  const token = randomUUID();
  const keys = pages.map((_, i) => `chapters/${token}/${String(i + 1).padStart(4, '0')}.png`);
  const stored: string[] = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      await putImage(keys[i], pages[i].bytes); stored.push(keys[i]);
      onProgress({ phase: 'storing', done: i + 1, total: pages.length });
    }
  } catch {
    await Promise.all(stored.map(deleteImage));
    throw new IngestFailure(503, 'storage_error', 'Image storage failed while saving chapter pages. Try again.');
  }
  try {
    return await db().transaction(async tx => {
      const [chapter] = await tx.insert(chapters).values({ seriesId, number, title, status: 'processing', pageCount: pages.length, createdBy: actor.userId }).returning({ id: chapters.id, number: chapters.number });
      await tx.insert(chapterPages).values(pages.map((page, i) => ({ chapterId: chapter.id, pageNumber: i + 1, sourceKey: keys[i], originalFilename: page.filename.slice(-512), contentHash: page.hash, width: page.width, height: page.height, bytes: page.bytes.length })));
      const [job] = await tx.insert(translationJobs).values({ chapterId: chapter.id, sourceLanguage: sourceLanguage || seriesRow.sourceLanguage, targetLanguage, requestedBy: actor.userId, workflow,
        options: { ingestion: true, operationKey, sourceFilename: file.name.slice(-200) }, stage: 'queued' }).returning({ id: translationJobs.id });
      await tx.insert(translationJobLogs).values([
        { jobId: job.id, attempt: 1, stage: 'validating', message: 'ZIP structure and upload limits validated.' },
        { jobId: job.id, attempt: 1, stage: 'processing_images', message: `Extracted, sorted, decoded and normalized ${pages.length} page images.` },
        { jobId: job.id, attempt: 1, stage: 'queued', message: workflow === 'manual' ? `Saved ${pages.length} original pages; queued OCR for manual translation.` : `Saved ${pages.length} master pages; queued OCR and translation.` },
      ]);
      await recordAudit(tx, actor, { action: 'chapter.upload', targetType: 'chapter', targetId: chapter.id, metadata: { seriesId, number: chapter.number, pages: pages.length, mode: 'zip', workflow, jobId: job.id } });
      return { chapterId: chapter.id, jobId: job.id, pageCount: pages.length, workflow };
    });
  } catch (error) {
    await Promise.all(stored.map(deleteImage));
    const cause = error as { code?: string; cause?: { code?: string } };
    if (cause.code === '23505' || cause.cause?.code === '23505') throw new IngestFailure(409, 'chapter_exists', 'That chapter number already exists in this series.');
    throw new IngestFailure(500, 'database_error', 'Chapter records could not be saved. Check the series and try again.');
  }
}
