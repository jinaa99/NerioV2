import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { db } from '@/server/db/client';
import { chapterPages, chapters, characters, glossaryTerms, series, translationJobs, translationSegments } from '@/server/db/schema';
import { deleteImage, getImage, putDeliveryImage } from '@/server/storage';
import { serverEnv } from '@/server/env';
import { DalError } from '@/server/errors';
import { requireRole } from '@/server/auth/actor';
import { recordAudit } from '@/server/data/audit';
import { getImageCleanupProvider, getOCRProvider, getTranslationProvider, MalformedAIOutputError, type OCRRegion, type TranslationContext } from './providers';
import { renderMongolianText } from './typesetting';

function isPrivateAddress(address: string) {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 ||
      (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && (octets[1] === 168 || octets[1] === 0)) || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19));
  }
  const lower = address.toLowerCase();
  return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:') || lower.startsWith('::ffff:127.') || lower.startsWith('::ffff:10.') || lower.startsWith('::ffff:192.168.');
}

async function loadPage(source: string): Promise<{ bytes: Buffer; mime: string }> {
  if (!source.startsWith('https://')) {
    const bytes = await getImage(source);
    if (!bytes) throw new Error('Stored page image is missing or unreadable.');
    return { bytes, mime: 'image/png' };
  }
  const url = new URL(source);
  if (url.username || url.password || url.port && url.port !== '443') throw new Error('Chapter page URL is not allowed.');
  let resolved: { address: string }[];
  try { resolved = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true, verbatim: true }); }
  catch { throw new Error('Could not resolve the public page image host.'); }
  if (!resolved.length || resolved.some(host => isPrivateAddress(host.address))) throw new Error('Page image host is not publicly routable.');
  let response: Response;
  try { response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error('Could not retrieve a chapter page image.'); }
  if (!response.ok) throw new Error('Could not retrieve a chapter page image.');
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 40 * 1024 * 1024) throw new Error('Chapter page image exceeds the processing size limit.');
  if (!response.body) throw new Error('Could not retrieve a chapter page image.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 40 * 1024 * 1024) { await reader.cancel(); throw new Error('Chapter page image exceeds the processing size limit.'); }
    chunks.push(chunk.value);
  }
  const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
  if (!bytes.length) throw new Error('Could not retrieve a chapter page image.');
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
    : bytes.subarray(0, 4).toString() === 'RIFF' ? 'image/webp'
      : bytes[0] === 0x89 ? 'image/png'
        : bytes.subarray(4, 12).toString().includes('ftypavif') || bytes.subarray(4, 12).toString().includes('ftypavis') ? 'image/avif' : 'application/octet-stream';
  return { bytes, mime };
}

const contains = (haystack: string, needle: string) => haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
function qualityFlags(source: string, translated: string, ocrConfidence: number, translationConfidence: number, context: TranslationContext) {
  const flags: string[] = [];
  const output = translated.trim();
  if (!output) flags.push('empty_translation');
  if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(output)) flags.push('untranslated_text');
  if (output.length > 0 && output.length < Math.max(2, Math.ceil(source.trim().length * 0.25))) flags.push('suspiciously_short');
  if (output.length > Math.max(40, source.trim().length * 5)) flags.push('suspiciously_long');
  if (ocrConfidence < serverEnv().OCR_CONFIDENCE_MIN) flags.push('low_ocr_confidence');
  if (translationConfidence < serverEnv().TRANSLATION_CONFIDENCE_MIN) flags.push('low_translation_confidence');
  for (const item of context.glossary) if (contains(source, item.source) && !contains(output, item.target)) flags.push(`glossary_violation:${item.source}`);
  for (const person of context.characterNames) {
    const sourceNames = [person.nativeName, person.name, ...person.aliases].filter((name): name is string => !!name);
    if (sourceNames.some(name => contains(source, name)) && ![person.name, ...person.aliases].some(name => contains(output, name))) flags.push(`character_name_inconsistent:${person.name}`);
  }
  return [...new Set(flags)];
}

async function setStage(jobId: string, stage: 'ocr' | 'context_building' | 'translating' | 'cleaning' | 'typesetting' | 'optimizing' | 'qa', progress: number) {
  const [row] = await db().update(translationJobs).set({ stage, stageProgress: progress })
    .where(and(eq(translationJobs.id, jobId), eq(translationJobs.status, 'running'))).returning({ id: translationJobs.id });
  if (!row) throw new DalError('CONFLICT', 'This job was cancelled or changed while it was running.');
}

/** Execute one existing queued job. Every write is keyed by job/segment ids so retries replace partial work. */
export async function runTranslationJob(jobId: string) {
  const actor = await requireRole('editor');
  const [claimed] = await db().transaction(async tx => {
    const [job] = await tx.select({ id: translationJobs.id, chapterId: translationJobs.chapterId, attempt: translationJobs.attempt }).from(translationJobs)
      .where(and(eq(translationJobs.id, jobId), eq(translationJobs.status, 'queued'))).for('update');
    if (!job) throw new DalError('CONFLICT', 'Only queued translation jobs can be run.');
    await tx.update(translationJobs).set({ status: 'running', stage: 'ocr', stageProgress: 0, startedAt: new Date(), finishedAt: null, errorCode: null, errorMessage: null }).where(eq(translationJobs.id, job.id));
    await tx.update(chapters).set({ status: 'processing' }).where(eq(chapters.id, job.chapterId));
    await tx.delete(translationSegments).where(eq(translationSegments.jobId, job.id));
    await tx.update(chapterPages).set({ outputKey: null, outputBytes: null, visualQaFlags: [] }).where(eq(chapterPages.chapterId, job.chapterId));
    return [job];
  });

  const storedOutputs: string[] = [];
  try {
    const [job] = await db().select({ id: translationJobs.id, chapterId: chapters.id, chapterNumber: chapters.number, chapterTitle: chapters.title,
      seriesId: series.id, seriesTitle: series.title, seriesDescription: series.description, sourceLanguage: translationJobs.sourceLanguage, targetLanguage: translationJobs.targetLanguage })
      .from(translationJobs).innerJoin(chapters, eq(chapters.id, translationJobs.chapterId)).innerJoin(series, eq(series.id, chapters.seriesId)).where(eq(translationJobs.id, claimed.id));
    if (!job) throw new Error('Chapter or translation job is no longer available.');
    const pages = await db().select({ id: chapterPages.id, pageNumber: chapterPages.pageNumber, sourceKey: chapterPages.sourceKey })
      .from(chapterPages).where(eq(chapterPages.chapterId, claimed.chapterId)).orderBy(asc(chapterPages.pageNumber));
    if (!pages.length) throw new Error('This chapter has no pages to process.');
    const [glossary, characterRows] = await Promise.all([
      db().select({ source: glossaryTerms.sourceTerm, target: glossaryTerms.targetTerm, notes: glossaryTerms.notes }).from(glossaryTerms).where(eq(glossaryTerms.seriesId, job.seriesId)).limit(500),
      db().select({ name: characters.name, nativeName: characters.nativeName, aliases: characters.aliases, voiceNotes: characters.voiceNotes }).from(characters).where(eq(characters.seriesId, job.seriesId)).limit(200),
    ]);
    // Translation memory is loaded across the same series from already reviewed work.
    const translationMemory = await db().select({ source: translationSegments.sourceText, translation: translationSegments.translatedText })
      .from(translationSegments).innerJoin(translationJobs, eq(translationJobs.id, translationSegments.jobId)).innerJoin(chapters, eq(chapters.id, translationJobs.chapterId))
      .where(and(eq(chapters.seriesId, job.seriesId), inArray(translationSegments.reviewStatus, ['approved', 'edited']), sql`${translationSegments.translatedText} is not null`))
      .orderBy(sql`${translationSegments.updatedAt} desc`).limit(500);
    const ocrProvider = getOCRProvider(); const translationProvider = getTranslationProvider();
    const byPage = new Map<string, (OCRRegion & { id: string; pageNumber: number; malformed?: boolean; translatedText?: string; translationConfidence?: number; qaFlags: string[] })[]>();
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      await setStage(job.id, 'ocr', Math.floor((pageIndex / pages.length) * 100));
      const page = pages[pageIndex];
      const { bytes, mime } = await loadPage(page.sourceKey);
      let regions: OCRRegion[]; let malformedOCR = false;
      try { regions = await ocrProvider.recognize(bytes, mime); }
      catch (error) {
        if (!(error instanceof MalformedAIOutputError)) throw error;
        malformedOCR = true;
        regions = [{ text: '', x: 0, y: 0, w: 1, h: 1, confidence: 0, kind: 'other' }];
      }
      const validRegions = regions.filter(region => region.text.trim().length > 0);
      if (malformedOCR || (regions.length > 0 && validRegions.length === 0)) {
        malformedOCR = true;
        validRegions.push({ text: '', x: 0, y: 0, w: 1, h: 1, confidence: 0, kind: 'other' });
      }
      const inserted = validRegions.length ? await db().insert(translationSegments).values(validRegions.map((region, position) => ({
        jobId: job.id, pageId: page.id, position, kind: region.kind, x: region.x, y: region.y, w: region.w, h: region.h,
        sourceText: region.text.trim(), confidence: null, ocrConfidence: region.confidence, translationConfidence: null, processingStatus: 'ocr_complete',
      }))).returning({ id: translationSegments.id }) : [];
      byPage.set(page.id, validRegions.map((region, i) => ({ ...region, id: inserted[i].id, pageNumber: page.pageNumber, malformed: malformedOCR && i === validRegions.length - 1, qaFlags: [] })));
    }
    await setStage(job.id, 'context_building', 100);
    const all = [...byPage.entries()].flatMap(([pageId, regions]) => regions.map(region => ({ pageId, ...region })));
    let processed = 0;
    const previousTranslations: { source: string; translation: string }[] = [];
    for (const item of all) {
      await setStage(job.id, 'translating', Math.floor((processed / Math.max(all.length, 1)) * 100));
      const samePage = byPage.get(item.pageId) ?? [];
      const idx = samePage.findIndex(segment => segment.id === item.id);
      const nearbyDialogue = samePage.slice(Math.max(0, idx - 3), idx).concat(samePage.slice(idx + 1, idx + 4)).map(segment => segment.text);
      const sourceWords = item.text.toLocaleLowerCase().match(/[가-힣]{2,}/g) ?? [];
      const relevantMemory = translationMemory.flatMap(entry => {
        if (!entry.translation) return [];
        const source = entry.source.toLocaleLowerCase();
        const overlap = source === item.text.toLocaleLowerCase() || sourceWords.some(word => source.includes(word));
        return overlap ? [{ source: entry.source.slice(0, 1000), translation: entry.translation.slice(0, 1500) }] : [];
      }).slice(0, 20);
      const context: TranslationContext = {
        targetLanguage: job.targetLanguage,
        currentPage: { pageNumber: item.pageNumber, detectedDialogue: samePage.slice(0, 80).map(segment => segment.text.slice(0, 400)) },
        chapter: { number: job.chapterNumber, title: job.chapterTitle, pageNumber: item.pageNumber },
        series: { title: job.seriesTitle, description: job.seriesDescription, sourceLanguage: job.sourceLanguage },
        nearbyDialogue, characterNames: characterRows, glossary, previousTranslations: previousTranslations.slice(-30),
        translationMemory: relevantMemory,
      };
      let translatedText = ''; let translationConfidence = 0; let malformed = !!item.malformed;
      try {
        if (item.malformed) throw new MalformedAIOutputError('OCR provider returned malformed structured output.');
        const result = await translationProvider.translate(item.text, context);
        translatedText = result.text; translationConfidence = result.confidence;
      } catch (error) {
        if (error instanceof MalformedAIOutputError) malformed = true;
        else throw new Error(error instanceof Error && error.message.includes('AI_API_KEY') ? error.message : 'Translation provider request failed. Check provider settings and try again.');
      }
      const qaFlags = qualityFlags(item.text, translatedText, item.confidence, translationConfidence, context);
      if (malformed) qaFlags.push('malformed_output');
      if (serverEnv().OCR_PROVIDER === 'mock' || serverEnv().TRANSLATION_PROVIDER === 'mock') qaFlags.push('mock_provider_output');
      const uniqueFlags = [...new Set(qaFlags)];
      item.qaFlags = uniqueFlags;
      await db().update(translationSegments).set({ translatedText, confidence: translationConfidence, translationConfidence,
        processingStatus: uniqueFlags.length ? 'needs_review' : 'complete', qaFlags: uniqueFlags, warning: uniqueFlags.length ? uniqueFlags.join(', ') : null,
        reviewStatus: uniqueFlags.length ? 'flagged' : 'pending' }).where(eq(translationSegments.id, item.id));
      item.translatedText = translatedText;
      previousTranslations.push({ source: item.text, translation: translatedText });
      processed++;
    }
    const cleanupProvider = getImageCleanupProvider();
    const pageQA: { id: string; flags: string[]; outputKey: string | null; outputBytes: number | null }[] = [];
    const criticalVisualFlags = new Set(['cleanup_failed', 'cleanup_unavailable', 'missing_translation', 'overflow', 'clipping', 'outside_region', 'overlapping_text', 'unreadably_small_text', 'delivery_storage_failed']);
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const pageSegments = all.filter(segment => segment.pageId === page.id);
      const boxes = pageSegments.map(segment => ({ id: segment.id, x: segment.x, y: segment.y, w: segment.w, h: segment.h, text: segment.translatedText ?? '' }));
      await setStage(job.id, 'cleaning', Math.floor((pageIndex / pages.length) * 100));
      const master = await loadPage(page.sourceKey);
      let cleanedImage = master.bytes;
      let inpainted = false;
      const pageFlags = new Set<string>();
      if (boxes.length) {
        try {
          const cleaned = await cleanupProvider.clean(master.bytes, master.mime, boxes.map(({ x, y, w, h }) => ({ x, y, w, h })));
          const [before, after] = await Promise.all([sharp(master.bytes).metadata(), sharp(cleaned.image, { failOn: 'error' }).metadata()]);
          if (before.width !== after.width || before.height !== after.height) throw new Error('Image cleanup changed page dimensions.');
          cleanedImage = cleaned.image; inpainted = cleaned.inpainted;
      if (!inpainted) pageFlags.add('cleanup_unavailable');
        } catch {
          pageFlags.add('cleanup_failed');
        }
      }
      await setStage(job.id, 'typesetting', Math.floor((pageIndex / pages.length) * 100));
      const typeset = await renderMongolianText(cleanedImage, boxes, inpainted);
      for (const visualFlag of typeset.pageFlags) pageFlags.add(visualFlag);
      for (const [segmentId, segmentFlags] of typeset.flags) if (segmentFlags.length) {
        const segment = pageSegments.find(item => item.id === segmentId);
        if (segment) segment.qaFlags.push(...segmentFlags);
      }
      await setStage(job.id, 'optimizing', Math.floor((pageIndex / pages.length) * 100));
      let outputKey: string | null = null; let outputBytes: number | null = null;
      if (![...pageFlags].some(flag => criticalVisualFlags.has(flag))) {
        const candidateKey = `chapters/${job.chapterId}/delivery-${claimed.attempt}-${String(page.pageNumber).padStart(4, '0')}.png`;
        try {
          await putDeliveryImage(candidateKey, typeset.image);
          storedOutputs.push(candidateKey);
          outputKey = candidateKey; outputBytes = typeset.image.length;
        } catch { pageFlags.add('delivery_storage_failed'); }
      }
      const dbVisualFlags = [...pageFlags];
      pageQA.push({ id: page.id, flags: dbVisualFlags, outputKey, outputBytes });
      for (const segment of pageSegments) {
        const flags = [...new Set([...segment.qaFlags, ...pageFlags])];
        await db().update(translationSegments).set({ qaFlags: flags, warning: flags.length ? flags.join(', ') : null,
          processingStatus: flags.length ? 'needs_review' : 'complete', reviewStatus: flags.length ? 'flagged' : 'pending' }).where(eq(translationSegments.id, segment.id));
      }
      await db().update(chapterPages).set({ outputKey, outputBytes, visualQaFlags: dbVisualFlags }).where(eq(chapterPages.id, page.id));
    }
    await setStage(job.id, 'qa', 100);
    await db().transaction(async tx => {
      const [stillRunning] = await tx.select({ id: translationJobs.id }).from(translationJobs)
        .where(and(eq(translationJobs.id, job.id), eq(translationJobs.status, 'running'))).for('update');
      if (!stillRunning) throw new DalError('CONFLICT', 'This job was cancelled or changed before completion.');
      await tx.update(chapters).set({ status: 'in_review' }).where(eq(chapters.id, claimed.chapterId));
      await tx.update(translationJobs).set({ status: 'ready', stage: 'ready', stageProgress: 100, finishedAt: new Date(),
        options: sql`jsonb_set(${translationJobs.options}, '{providers}', ${JSON.stringify({ ocr: serverEnv().OCR_PROVIDER, translation: serverEnv().TRANSLATION_PROVIDER, cleanup: serverEnv().IMAGE_CLEANUP_PROVIDER, typesetting: 'opentype-noto-sans' })}::jsonb, true)` })
        .where(and(eq(translationJobs.id, job.id), eq(translationJobs.status, 'running')));
      const qaFlagCount = pageQA.reduce((total, page) => total + page.flags.length, 0);
      await recordAudit(tx, actor, { action: 'translation_job.complete', targetType: 'translation_job', targetId: job.id, metadata: { chapterId: job.chapterId, segments: all.length, visualFlags: qaFlagCount, providers: [serverEnv().OCR_PROVIDER, serverEnv().TRANSLATION_PROVIDER, serverEnv().IMAGE_CLEANUP_PROVIDER] } });
    });
    return { id: job.id, segments: all.length, status: 'ready' as const };
  } catch (error) {
    const safeMessage = error instanceof DalError ? error.message : error instanceof Error ? error.message.slice(0, 500) : 'Translation job failed.';
    await Promise.all(storedOutputs.map(deleteImage));
    await db().transaction(async tx => {
      await tx.update(chapterPages).set({ outputKey: null, outputBytes: null }).where(eq(chapterPages.chapterId, claimed.chapterId));
      await tx.update(translationJobs).set({ status: 'failed', errorCode: 'processing_failed', errorMessage: safeMessage, finishedAt: new Date() })
        .where(and(eq(translationJobs.id, claimed.id), eq(translationJobs.status, 'running')));
      await tx.update(chapters).set({ status: 'failed' }).where(and(eq(chapters.id, claimed.chapterId), eq(chapters.status, 'processing')));
      await recordAudit(tx, actor, { action: 'translation_job.fail', targetType: 'translation_job', targetId: claimed.id, metadata: { chapterId: claimed.chapterId, message: safeMessage } });
    });
    throw new DalError('CONFLICT', safeMessage);
  }
}
