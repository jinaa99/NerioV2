import 'server-only';
/**
 * Translation records: jobs, segments, glossary and characters.
 * Only data access lives here; nothing runs OCR or models (the AI pipeline is a later phase).
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  characterInput, createTranslationJobInput, glossaryTermInput, pagination, reviewSegmentInput, uuid,
  type CharacterInput, type CreateTranslationJobInput, type GlossaryTermInput, type Pagination, type ReviewSegmentInput,
} from '@/lib/validation';
import { z } from 'zod';
import { requireRole } from '../auth/actor';
import { db } from '../db/client';
import { chapterPages, chapters, characters, glossaryTerms, series, translationJobs, translationSegments } from '../db/schema';
import { DalError, parseInput, rethrowUnique } from '../errors';
import { recordAudit } from './audit';

const jobStatuses = ['queued', 'running', 'failed', 'ready', 'cancelled'] as const;

export async function listTranslationJobs(input: Pagination & { status?: (typeof jobStatuses)[number][] } = {}) {
  await requireRole('editor');
  const { limit, offset, status } = parseInput(pagination.extend({ status: z.array(z.enum(jobStatuses)).optional() }), input);
  return db()
    .select({
      id: translationJobs.id, status: translationJobs.status, stage: translationJobs.stage, stageProgress: translationJobs.stageProgress,
      attempt: translationJobs.attempt, errorCode: translationJobs.errorCode, errorMessage: translationJobs.errorMessage,
      startedAt: translationJobs.startedAt, createdAt: translationJobs.createdAt,
      chapterId: chapters.id, chapterNumber: chapters.number, seriesSlug: series.slug, seriesTitle: series.title,
    })
    .from(translationJobs)
    .innerJoin(chapters, eq(chapters.id, translationJobs.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(status?.length ? inArray(translationJobs.status, status) : undefined)
    .orderBy(desc(translationJobs.createdAt))
    .limit(limit)
    .offset(offset);
}

/** Queue a job record. Workers that pick it up are not implemented yet. */
export async function createTranslationJob(input: CreateTranslationJobInput) {
  const actor = await requireRole('editor');
  const data = parseInput(createTranslationJobInput, input);
  return db().transaction(async tx => {
    const [ch] = await tx
      .select({ id: chapters.id, sourceLanguage: series.sourceLanguage })
      .from(chapters).innerJoin(series, eq(series.id, chapters.seriesId))
      .where(eq(chapters.id, data.chapterId));
    if (!ch) throw new DalError('NOT_FOUND', 'Chapter not found.');
    const [active] = await tx.select({ id: translationJobs.id }).from(translationJobs)
      .where(and(eq(translationJobs.chapterId, ch.id), inArray(translationJobs.status, ['queued', 'running'])));
    if (active) throw new DalError('CONFLICT', 'This chapter already has a job in progress.');
    const [job] = await tx.insert(translationJobs).values({
      chapterId: ch.id, sourceLanguage: ch.sourceLanguage, targetLanguage: data.targetLanguage, priority: data.priority, requestedBy: actor.userId,
    }).returning({ id: translationJobs.id });
    await tx.update(chapters).set({ status: 'processing' }).where(eq(chapters.id, ch.id));
    await recordAudit(tx, actor, { action: 'translation_job.create', targetType: 'translation_job', targetId: job.id, metadata: { chapterId: ch.id } });
    return job;
  });
}

export async function cancelTranslationJob(jobId: string) {
  const actor = await requireRole('editor');
  const id = parseInput(uuid, jobId);
  await db().transaction(async tx => {
    const [job] = await tx.update(translationJobs).set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(eq(translationJobs.id, id), inArray(translationJobs.status, ['queued', 'running'])))
      .returning({ id: translationJobs.id });
    if (!job) throw new DalError('CONFLICT', 'Only queued or running jobs can be cancelled.');
    await recordAudit(tx, actor, { action: 'translation_job.cancel', targetType: 'translation_job', targetId: id });
  });
}

/** Segments for the review screen, in page then reading order. */
export async function listSegmentsForReview(jobId: string) {
  await requireRole('translator');
  const id = parseInput(uuid, jobId);
  return db()
    .select({
      id: translationSegments.id, pageNumber: chapterPages.pageNumber, position: translationSegments.position, kind: translationSegments.kind,
      x: translationSegments.x, y: translationSegments.y, w: translationSegments.w, h: translationSegments.h,
      sourceText: translationSegments.sourceText, translatedText: translationSegments.translatedText,
      confidence: translationSegments.confidence, warning: translationSegments.warning, reviewStatus: translationSegments.reviewStatus,
    })
    .from(translationSegments)
    .innerJoin(chapterPages, eq(chapterPages.id, translationSegments.pageId))
    .where(eq(translationSegments.jobId, id))
    .orderBy(asc(chapterPages.pageNumber), asc(translationSegments.position));
}

export async function reviewSegment(input: ReviewSegmentInput) {
  const actor = await requireRole('translator');
  const data = parseInput(reviewSegmentInput, input);
  if (data.reviewStatus === 'edited' && !data.translatedText) throw new DalError('INVALID_INPUT', 'Edited segments need text.', { translatedText: ['Required'] });
  const [row] = await db().update(translationSegments)
    .set({ reviewStatus: data.reviewStatus, translatedText: data.translatedText, reviewedBy: actor.userId, reviewedAt: new Date() })
    .where(eq(translationSegments.id, data.segmentId))
    .returning({ id: translationSegments.id });
  if (!row) throw new DalError('NOT_FOUND', 'Segment not found.');
}

/* Glossary & characters: staff-only reference data per series. */

export async function listGlossary(seriesId: string) {
  await requireRole('translator');
  const id = parseInput(uuid, seriesId);
  return db()
    .select({ id: glossaryTerms.id, sourceTerm: glossaryTerms.sourceTerm, targetTerm: glossaryTerms.targetTerm, notes: glossaryTerms.notes, caseSensitive: glossaryTerms.caseSensitive })
    .from(glossaryTerms).where(eq(glossaryTerms.seriesId, id)).orderBy(asc(glossaryTerms.sourceTerm));
}

export async function upsertGlossaryTerm(input: GlossaryTermInput) {
  const actor = await requireRole('translator');
  const data = parseInput(glossaryTermInput, input);
  const [row] = await db().insert(glossaryTerms).values({ ...data, createdBy: actor.userId })
    .onConflictDoUpdate({ target: [glossaryTerms.seriesId, glossaryTerms.sourceTerm], set: { targetTerm: data.targetTerm, notes: data.notes, caseSensitive: data.caseSensitive } })
    .returning({ id: glossaryTerms.id });
  return row;
}

export async function deleteGlossaryTerm(termId: string) {
  await requireRole('translator');
  await db().delete(glossaryTerms).where(eq(glossaryTerms.id, parseInput(uuid, termId)));
}

export async function listCharacters(seriesId: string) {
  await requireRole('translator');
  const id = parseInput(uuid, seriesId);
  return db()
    .select({ id: characters.id, name: characters.name, nativeName: characters.nativeName, aliases: characters.aliases, description: characters.description, voiceNotes: characters.voiceNotes })
    .from(characters).where(eq(characters.seriesId, id)).orderBy(asc(characters.name));
}

export async function createCharacter(input: CharacterInput) {
  await requireRole('translator');
  const data = parseInput(characterInput, input);
  try {
    const [row] = await db().insert(characters).values(data).returning({ id: characters.id });
    return row;
  } catch (err) {
    rethrowUnique(err, 'A character with that name already exists in this series.');
  }
}
