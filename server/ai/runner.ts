import 'server-only';
import { lookup } from 'node:dns/promises';
import { randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { db } from '@/server/db/client';
import { chapterPages, chapters, characters, glossaryTerms, series, translationJobLogs, translationJobs, translationSegments } from '@/server/db/schema';
import { deleteImage, getImage, putDeliveryImage } from '@/server/storage';
import { serverEnv } from '@/server/env';
import { DalError, parseInput } from '@/server/errors';
import { uuid } from '@/lib/validation';
import { requireRole, type Actor } from '@/server/auth/actor';
import { recordAudit } from '@/server/data/audit';
import { notifyFollowers } from '@/server/data/catalog';
import { getSettings } from '@/server/data/settings';
import { getImageCleanupProvider, getOCRProvider, getTranslationProvider, MalformedAIOutputError, type OCRRegion, type TranslationContext } from './providers';
import { renderMongolianText, type TextBox } from './typesetting';
import { analyzeBalloon, balloonArea, rasterize, sameBalloon, toPixels, type Balloon, type PageRaster } from './bubbles';
import { isUppercase, shouldTranslate, sourceLineCount, untranslated } from './segments';
import { checkPublication } from './qa';

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

export async function loadPage(source: string): Promise<{ bytes: Buffer; mime: string }> {
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
  if (output && untranslated(output, context.sourceLanguage, context.targetLanguage)) flags.push('untranslated_text');
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

type ProcessingStage = 'validating' | 'processing_images' | 'ocr' | 'translating' | 'cleaning' | 'typesetting' | 'qa';

async function log(jobId: string, attempt: number, stage: ProcessingStage | 'ready' | 'published' | 'failed', message: string, level: 'info' | 'warning' | 'error' = 'info', details: Record<string, unknown> = {}) {
  await db().insert(translationJobLogs).values({ jobId, attempt, stage, message: message.slice(0, 500), level, details });
}

async function setStage(jobId: string, attempt: number, stage: ProcessingStage, progress: number) {
  const [row] = await db().update(translationJobs).set({ stage, stageProgress: Math.min(100, Math.max(0, progress)) })
    .where(and(eq(translationJobs.id, jobId), eq(translationJobs.status, 'running'))).returning({ id: translationJobs.id, previousStage: translationJobs.stage });
  if (!row) throw new DalError('CONFLICT', 'This job was cancelled or changed while it was running.');
  if (row.previousStage !== stage && progress === 0) await log(jobId, attempt, stage, `Started ${stage.replaceAll('_', ' ')} stage.`);
}

/** Run `fn` over `items` with at most `limit` in flight, keeping result order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await fn(items[index], index); }
  }));
  return results;
}

type Region = OCRRegion & { lines: number };
/** Join OCR regions that sit in the same balloon, so each balloon is translated and lettered once. */
export function groupByBalloon(raster: PageRaster, regions: OCRRegion[]): { region: Region; balloon: Balloon }[] {
  const groups: { region: Region; balloon: Balloon }[] = [];
  for (const region of regions) {
    const pixels = toPixels(region, raster.width, raster.height);
    const owner = groups.find(group => sameBalloon(group.balloon, pixels));
    if (!owner) { groups.push({ region: { ...region, lines: sourceLineCount(region.text) }, balloon: analyzeBalloon(raster, pixels) }); continue; }
    const r = owner.region;
    const x = Math.min(r.x, region.x), y = Math.min(r.y, region.y);
    owner.region = { ...r, text: `${r.text}\n${region.text}`, x, y, w: Math.max(r.x + r.w, region.x + region.w) - x, h: Math.max(r.y + r.h, region.y + region.h) - y,
      confidence: Math.min(r.confidence, region.confidence), kind: r.kind === 'sfx' ? region.kind : r.kind, lines: r.lines + sourceLineCount(region.text) };
  }
  return groups;
}

/** Characters that fit the balloon at roughly the original lettering size; sent to the translator as a length budget. */
function capacity(balloon: Balloon, region: Region, pageWidth: number, sourceLength: number) {
  const env = serverEnv();
  const size = Math.max(env.TYPESET_MIN_FONT_SIZE, pageWidth * 0.022, Math.min(pageWidth * 0.075, balloon.ink.h / region.lines / env.TYPESET_LINE_HEIGHT));
  const area = balloonArea(balloon) * (balloon.enclosed ? 0.55 : 1.1);
  return Math.max(6, Math.round(Math.max(area / (size * 0.56 * size * env.TYPESET_LINE_HEIGHT), sourceLength * 0.9)));
}

type Segment = Region & { id: string; pageId: string; pageNumber: number; maxChars: number; uppercase: boolean; malformed?: boolean; translatedText?: string; translationConfidence?: number; qaFlags: string[] };
const textBox = (segment: { id: string; x: number; y: number; w: number; h: number; text: string; source: string }): TextBox => ({
  id: segment.id, x: segment.x, y: segment.y, w: segment.w, h: segment.h, text: segment.text, uppercase: isUppercase(segment.source), sourceLines: sourceLineCount(segment.source),
});
const VISUAL_FLAGS = ['cleanup_failed', 'cleanup_unavailable', 'missing_translation', 'missing_glyph', 'overflow', 'clipping', 'outside_region', 'overlapping_text', 'unreadably_small_text', 'delivery_storage_failed'];

/** Execute one existing queued job as the signed-in editor. */
export async function runTranslationJob(jobId: string) {
  return runTranslationJobAs(await requireRole('editor'), jobId);
}

/** Execute one existing queued job. Every write is keyed by job/segment ids so retries replace partial work. */
export async function runTranslationJobAs(actor: Actor, jobId: string) {
  const id = parseInput(uuid, jobId);
  const [claimed] = await db().transaction(async tx => {
    const [job] = await tx.select({ id: translationJobs.id, chapterId: translationJobs.chapterId, attempt: translationJobs.attempt }).from(translationJobs)
      .where(and(eq(translationJobs.id, id), eq(translationJobs.status, 'queued'), eq(translationJobs.workflow, 'ai'))).for('update');
    if (!job) throw new DalError('CONFLICT', 'Only queued translation jobs can be run.');
    await tx.update(translationJobs).set({ status: 'running', stage: 'validating', stageProgress: 0, startedAt: new Date(), finishedAt: null, errorCode: null, errorMessage: null }).where(eq(translationJobs.id, job.id));
    await tx.update(chapters).set({ status: 'processing' }).where(eq(chapters.id, job.chapterId));
    await tx.delete(translationSegments).where(eq(translationSegments.jobId, job.id));
    await tx.update(chapterPages).set({ outputKey: null, outputBytes: null, visualQaFlags: [] }).where(eq(chapterPages.chapterId, job.chapterId));
    await tx.insert(translationJobLogs).values({ jobId: job.id, attempt: job.attempt, stage: 'validating', message: 'Processing attempt started.' });
    return [job];
  });

  const storedOutputs: string[] = [];
  let activeStage: ProcessingStage = 'validating';
  try {
    const env = serverEnv();
    const [job] = await db().select({ id: translationJobs.id, chapterId: chapters.id, chapterNumber: chapters.number, chapterTitle: chapters.title,
      seriesId: series.id, seriesTitle: series.title, seriesDescription: series.description, sourceLanguage: translationJobs.sourceLanguage, targetLanguage: translationJobs.targetLanguage })
      .from(translationJobs).innerJoin(chapters, eq(chapters.id, translationJobs.chapterId)).innerJoin(series, eq(series.id, chapters.seriesId)).where(eq(translationJobs.id, claimed.id));
    if (!job) throw new Error('Chapter or translation job is no longer available.');
    const pages = await db().select({ id: chapterPages.id, pageNumber: chapterPages.pageNumber, sourceKey: chapterPages.sourceKey, width: chapterPages.width, height: chapterPages.height })
      .from(chapterPages).where(eq(chapterPages.chapterId, claimed.chapterId)).orderBy(asc(chapterPages.pageNumber));
    if (!pages.length) throw new Error('This chapter has no pages to process.');
    const [required] = await db().select({ count: chapters.pageCount }).from(chapters).where(eq(chapters.id, claimed.chapterId));
    if (!required || pages.length !== required.count || pages.some((page, index) => page.pageNumber !== index + 1)) throw new Error('Required chapter pages are missing or out of sequence.');
    await setStage(job.id, claimed.attempt, 'validating', 100);
    activeStage = 'processing_images';
    await setStage(job.id, claimed.attempt, 'processing_images', 0);
    for (const page of pages) {
      const bytes = await loadPage(page.sourceKey);
      const meta = await sharp(bytes.bytes, { failOn: 'error', limitInputPixels: 2_000_000_000 }).metadata();
      if (!meta.width || !meta.height || meta.width !== page.width || meta.height !== page.height) throw new Error(`Page ${page.pageNumber} is corrupted or its dimensions do not match the uploaded record.`);
    }
    await log(job.id, claimed.attempt, 'processing_images', `Validated ${pages.length} page images.`);
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

    activeStage = 'ocr';
    await setStage(job.id, claimed.attempt, 'ocr', 0);
    let ocrDone = 0; let skipped = 0;
    const byPage = new Map<string, Segment[]>();
    await pool(pages, 3, async page => {
      const { bytes } = await loadPage(page.sourceKey);
      let regions: OCRRegion[]; let malformedOCR = false;
      try { regions = await ocrProvider.recognize(bytes, job.sourceLanguage); }
      catch (error) {
        if (!(error instanceof MalformedAIOutputError)) throw error;
        malformedOCR = true; regions = [];
      }
      const raster = await rasterize(bytes);
      const groups = groupByBalloon(raster, regions.filter(region => region.text.trim()));
      const kept = groups.filter(group => {
        const decision = shouldTranslate(group.region.text, group.region.kind, job.sourceLanguage);
        if (!decision.translate) skipped++;
        return decision.translate;
      });
      const rows = kept.map(({ region, balloon }) => ({ region, maxChars: capacity(balloon, region, raster.width, region.text.length) }));
      // A page whose OCR output stays malformed after retries is held for a human with a full-page placeholder.
      if (malformedOCR) rows.push({ region: { text: '', x: 0, y: 0, w: 1, h: 1, confidence: 0, kind: 'other', lines: 1 }, maxChars: 0 });
      const inserted = rows.length ? await db().insert(translationSegments).values(rows.map(({ region }, position) => ({
        jobId: job.id, pageId: page.id, position, kind: region.kind, x: region.x, y: region.y, w: region.w, h: region.h,
        sourceText: region.text.trim(), confidence: null, ocrConfidence: region.confidence, translationConfidence: null, processingStatus: 'ocr_complete',
      }))).returning({ id: translationSegments.id }) : [];
      byPage.set(page.id, rows.map(({ region, maxChars }, i) => ({ ...region, id: inserted[i].id, pageId: page.id, pageNumber: page.pageNumber, maxChars,
        uppercase: isUppercase(region.text), malformed: malformedOCR && i === rows.length - 1, qaFlags: [] })));
      await setStage(job.id, claimed.attempt, 'ocr', Math.floor((++ocrDone / pages.length) * 100));
    });
    const all = pages.flatMap(page => byPage.get(page.id) ?? []);
    await log(job.id, claimed.attempt, 'ocr', `OCR found ${all.length} text regions to translate across ${pages.length} pages; left ${skipped} sound effects, single words and watermarks untouched.`);

    activeStage = 'translating';
    await setStage(job.id, claimed.attempt, 'translating', 0);
    const previousTranslations: { source: string; translation: string }[] = [];
    const contextFor = (pageIndex: number, sources: string[]): TranslationContext => {
      const keywords = sources.flatMap(text => text.toLocaleLowerCase().match(/\p{L}{4,}/gu) ?? []);
      const relevantMemory = translationMemory.flatMap(entry => {
        if (!entry.translation) return [];
        const source = entry.source.toLocaleLowerCase();
        return sources.some(text => text.toLocaleLowerCase() === source) || keywords.some(word => source.includes(word)) ? [{ source: entry.source.slice(0, 1000), translation: entry.translation.slice(0, 1500) }] : [];
      }).slice(0, 30);
      return {
        sourceLanguage: job.sourceLanguage, targetLanguage: job.targetLanguage,
        chapter: { number: job.chapterNumber, title: job.chapterTitle, pageNumber: pageIndex + 1, pageCount: pages.length },
        series: { title: job.seriesTitle, description: job.seriesDescription.slice(0, 1500) },
        characterNames: characterRows, glossary, previousTranslations: previousTranslations.slice(-40),
        upcomingDialogue: (byPage.get(pages[pageIndex + 1]?.id) ?? []).slice(0, 12).map(segment => segment.text.slice(0, 300)),
        translationMemory: relevantMemory,
      };
    };
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const segments = (byPage.get(pages[pageIndex].id) ?? []);
      const translatable = segments.filter(segment => !segment.malformed);
      const context = contextFor(pageIndex, translatable.map(segment => segment.text));
      let results = new Map<string, { text: string; confidence: number }>(); let malformedPage = false;
      if (translatable.length) {
        try {
          const output = await translationProvider.translatePage(translatable.map((segment, i) => ({ id: String(i + 1), text: segment.text, kind: segment.kind, maxChars: segment.maxChars })), context);
          results = new Map(output.map(item => [translatable[Number(item.id) - 1]?.id ?? '', item]));
        } catch (error) {
          if (error instanceof MalformedAIOutputError) malformedPage = true;
          else throw new Error(error instanceof Error && error.message.includes('AI_API_KEY') ? error.message : 'Translation provider request failed. Check provider settings and try again.');
        }
      }
      for (const segment of segments) {
        const result = results.get(segment.id);
        const translatedText = result?.text.trim() ?? ''; const translationConfidence = result?.confidence ?? 0;
        const qaFlags = qualityFlags(segment.text, translatedText, segment.confidence, translationConfidence, context);
        if (segment.malformed) qaFlags.push('malformed_output', 'ocr_critical_failure');
        else if (malformedPage) qaFlags.push('malformed_output');
        if (env.OCR_PROVIDER === 'mock' || env.TRANSLATION_PROVIDER === 'mock') qaFlags.push('mock_provider_output');
        segment.qaFlags = [...new Set(qaFlags)];
        segment.translatedText = translatedText; segment.translationConfidence = translationConfidence;
        await db().update(translationSegments).set({ translatedText, confidence: translationConfidence, translationConfidence,
          processingStatus: segment.qaFlags.length ? 'needs_review' : 'complete', qaFlags: segment.qaFlags, warning: segment.qaFlags.length ? segment.qaFlags.join(', ') : null,
          reviewStatus: segment.qaFlags.length ? 'flagged' : 'pending' }).where(eq(translationSegments.id, segment.id));
        if (translatedText) previousTranslations.push({ source: segment.text, translation: translatedText });
      }
      await setStage(job.id, claimed.attempt, 'translating', Math.floor(((pageIndex + 1) / pages.length) * 100));
    }
    await log(job.id, claimed.attempt, 'translating', `Translated ${all.length} text regions page by page with chapter context.`);

    const settings = await getSettings();
    const cleanupProvider = getImageCleanupProvider();
    const pageQA: { id: string; flags: string[]; outputKey: string | null; outputBytes: number | null }[] = [];
    const criticalVisualFlags = new Set(VISUAL_FLAGS);
    let shortened = 0;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const pageSegments = byPage.get(page.id) ?? [];
      activeStage = 'cleaning';
      await setStage(job.id, claimed.attempt, 'cleaning', Math.floor((pageIndex / pages.length) * 100));
      const master = await loadPage(page.sourceKey);
      let cleaned: Buffer | null = null;
      const pageFlags = new Set<string>();
      if (pageSegments.length && cleanupProvider) {
        try {
          const result = await cleanupProvider.clean(master.bytes, master.mime, pageSegments.map(({ x, y, w, h }) => ({ x, y, w, h })));
          if (result.inpainted) cleaned = result.image; else pageFlags.add('cleanup_unavailable');
        } catch {
          pageFlags.add('cleanup_failed');
        }
      }
      activeStage = 'typesetting';
      await setStage(job.id, claimed.attempt, 'typesetting', Math.floor((pageIndex / pages.length) * 100));
      const boxes = () => pageSegments.map(segment => textBox({ ...segment, text: segment.translatedText ?? '', source: segment.text }));
      let typeset = await renderMongolianText(master.bytes, boxes(), { font: settings.typesetFont, cleaned });
      // Lines that overflow their balloon get one concise re-translation before a human has to step in.
      const overflowing = pageSegments.filter(segment => segment.translatedText && typeset.flags.get(segment.id)?.some(flag => flag === 'overflow' || flag === 'unreadably_small_text'));
      if (overflowing.length) {
        try {
          const context = contextFor(pageIndex, overflowing.map(segment => segment.text));
          const output = await translationProvider.shorten(overflowing.map((segment, i) => ({ id: String(i + 1), source: segment.text,
            translation: segment.translatedText!, maxChars: Math.max(4, Math.min(segment.maxChars, Math.round(segment.translatedText!.length * 0.7))) })), context);
          for (const item of output) {
            const segment = overflowing[Number(item.id) - 1];
            if (!segment || !item.text.trim()) continue;
            segment.translatedText = item.text.trim(); shortened++;
            await db().update(translationSegments).set({ translatedText: segment.translatedText }).where(eq(translationSegments.id, segment.id));
          }
          typeset = await renderMongolianText(master.bytes, boxes(), { font: settings.typesetFont, cleaned });
        } catch (error) {
          if (!(error instanceof MalformedAIOutputError) && !(error instanceof Error && /AI provider/.test(error.message))) throw error;
        }
      }
      for (const visualFlag of typeset.pageFlags) pageFlags.add(visualFlag);
      for (const [segmentId, segmentFlags] of typeset.flags) if (segmentFlags.length) {
        const segment = pageSegments.find(item => item.id === segmentId);
        if (segment) segment.qaFlags.push(...segmentFlags);
      }
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
        segment.qaFlags = flags;
        await db().update(translationSegments).set({ qaFlags: flags, warning: flags.length ? flags.join(', ') : null,
          processingStatus: flags.length ? 'needs_review' : 'complete', reviewStatus: flags.length ? 'flagged' : 'pending' }).where(eq(translationSegments.id, segment.id));
      }
      await db().update(chapterPages).set({ outputKey, outputBytes, visualQaFlags: dbVisualFlags }).where(eq(chapterPages.id, page.id));
    }
    if (shortened) await log(job.id, claimed.attempt, 'typesetting', `Shortened ${shortened} translations to fit their balloons.`);
    activeStage = 'qa';
    await setStage(job.id, claimed.attempt, 'qa', 0);
    const allSegmentFlags = all.flatMap(segment => segment.qaFlags);
    const [pageCount] = await db().select({ count: chapters.pageCount }).from(chapters).where(eq(chapters.id, claimed.chapterId));
    const { canAutoPublish, criticalFlags } = checkPublication({
      requiredPages: pageCount?.count ?? 0,
      pageOutputs: pageQA.map(page => page.outputKey),
      pageFlags: pageQA.flatMap(page => page.flags),
      segmentFlags: allSegmentFlags,
    });
    await db().transaction(async tx => {
      const [stillRunning] = await tx.select({ id: translationJobs.id }).from(translationJobs)
        .where(and(eq(translationJobs.id, job.id), eq(translationJobs.status, 'running'))).for('update');
      if (!stillRunning) throw new DalError('CONFLICT', 'This job was cancelled or changed before completion.');
      if (canAutoPublish) {
        await tx.update(chapters).set({ status: 'published', publishedAt: new Date() }).where(eq(chapters.id, claimed.chapterId));
      } else {
        await tx.update(chapters).set({ status: 'in_review' }).where(eq(chapters.id, claimed.chapterId));
      }
      await tx.update(translationJobs).set({ status: 'ready', stage: canAutoPublish ? 'published' : 'ready', stageProgress: 100, finishedAt: new Date(),
        options: sql`jsonb_set(${translationJobs.options}, '{providers}', ${JSON.stringify({ ocr: env.OCR_PROVIDER, ocrModel: env.OCR_MODEL, translation: env.TRANSLATION_PROVIDER, translationModel: env.TRANSLATION_MODEL, cleanup: env.IMAGE_CLEANUP_PROVIDER, typesetting: `opentype-${settings.typesetFont}` })}::jsonb, true)` })
        .where(and(eq(translationJobs.id, job.id), eq(translationJobs.status, 'running')));
      const qaFlagCount = pageQA.reduce((total, page) => total + page.flags.length, 0);
      await tx.insert(translationJobLogs).values({ jobId: job.id, attempt: claimed.attempt, stage: 'qa', message: canAutoPublish ? 'Critical QA passed; chapter auto-published.' : 'QA finished; chapter held for human review.', details: { criticalFlags, flags: qaFlagCount, autoPublished: canAutoPublish } });
      if (canAutoPublish) {
        await tx.insert(translationJobLogs).values({ jobId: job.id, attempt: claimed.attempt, stage: 'published', message: 'Chapter published automatically after critical QA passed.' });
        const [chapter] = await tx.select({ id: chapters.id, seriesId: chapters.seriesId, number: chapters.number }).from(chapters).where(eq(chapters.id, claimed.chapterId));
        if (chapter) await notifyFollowers(tx, chapter);
      } else {
        await tx.insert(translationJobLogs).values({ jobId: job.id, attempt: claimed.attempt, stage: 'ready', message: 'Chapter is waiting for admin review.' });
      }
      await recordAudit(tx, actor, { action: canAutoPublish ? 'translation_job.auto_publish' : 'translation_job.complete', targetType: 'translation_job', targetId: job.id, metadata: { chapterId: job.chapterId, segments: all.length, visualFlags: qaFlagCount, autoPublished: canAutoPublish, criticalFlags, providers: [env.OCR_PROVIDER, env.TRANSLATION_PROVIDER, env.IMAGE_CLEANUP_PROVIDER] } });
    });
    return { id: job.id, segments: all.length, status: 'ready' as const, autoPublished: canAutoPublish };
  } catch (error) {
    const safeMessage = error instanceof DalError ? error.message : error instanceof Error ? error.message.slice(0, 500) : 'Translation job failed.';
    await Promise.all(storedOutputs.map(deleteImage));
    await db().transaction(async tx => {
      await tx.update(chapterPages).set({ outputKey: null, outputBytes: null }).where(eq(chapterPages.chapterId, claimed.chapterId));
      const [failed] = await tx.update(translationJobs).set({ status: 'failed', stage: 'failed', stageProgress: 0, errorCode: 'processing_failed', errorMessage: safeMessage, finishedAt: new Date() })
        .where(and(eq(translationJobs.id, claimed.id), eq(translationJobs.status, 'running'))).returning({ id: translationJobs.id });
      if (failed) {
        await tx.insert(translationJobLogs).values({ jobId: claimed.id, attempt: claimed.attempt, stage: 'failed', level: 'error', message: safeMessage, details: { failedAtStage: activeStage } });
        await tx.update(chapters).set({ status: 'failed' }).where(and(eq(chapters.id, claimed.chapterId), eq(chapters.status, 'processing')));
        await recordAudit(tx, actor, { action: 'translation_job.fail', targetType: 'translation_job', targetId: claimed.id, metadata: { chapterId: claimed.chapterId, message: safeMessage, failedAtStage: activeStage } });
      }
    });
    throw new DalError('CONFLICT', safeMessage);
  }
}

/** Re-clean and re-typeset a manually corrected review page before it can be published. */
export async function rerenderReviewedPage(jobId: string, pageId: string): Promise<string[]> {
  const [page] = await db().select({ chapterId: chapterPages.chapterId, pageNumber: chapterPages.pageNumber, sourceKey: chapterPages.sourceKey,
    outputKey: chapterPages.outputKey, width: chapterPages.width, height: chapterPages.height, attempt: translationJobs.attempt })
    .from(chapterPages).innerJoin(translationJobs, eq(translationJobs.chapterId, chapterPages.chapterId))
    .where(and(eq(chapterPages.id, pageId), eq(translationJobs.id, jobId), eq(translationJobs.status, 'ready')));
  if (!page) throw new DalError('NOT_FOUND', 'Review page is no longer available.');
  const segments = await db().select({ id: translationSegments.id, x: translationSegments.x, y: translationSegments.y, w: translationSegments.w, h: translationSegments.h,
    text: translationSegments.translatedText, source: translationSegments.sourceText, qaFlags: translationSegments.qaFlags, status: translationSegments.reviewStatus })
    .from(translationSegments).where(and(eq(translationSegments.jobId, jobId), eq(translationSegments.pageId, pageId))).orderBy(asc(translationSegments.position));
  const visualFlags = new Set(VISUAL_FLAGS);
  const flags = new Set<string>();
  const oldOutputKey = page.outputKey;
  let rendered: Awaited<ReturnType<typeof renderMongolianText>> | null = null;
  try {
    if (segments.some(segment => !segment.text?.trim())) flags.add('missing_translation');
    const master = await loadPage(page.sourceKey);
    const meta = await sharp(master.bytes, { limitInputPixels: 2_000_000_000 }).metadata();
    if (meta.width !== page.width || meta.height !== page.height) throw new Error('Page dimensions changed during cleanup.');
    const cleanupProvider = getImageCleanupProvider();
    let cleaned: Buffer | null = null;
    if (cleanupProvider && segments.length) {
      const result = await cleanupProvider.clean(master.bytes, master.mime, segments.map(({ x, y, w, h }) => ({ x, y, w, h })));
      if (result.inpainted) cleaned = result.image; else flags.add('cleanup_unavailable');
    }
    const settings = await getSettings();
    rendered = await renderMongolianText(master.bytes, segments.map(segment => textBox({ ...segment, text: segment.text ?? '' })), { font: settings.typesetFont, cleaned });
    rendered.pageFlags.forEach(flag => flags.add(flag));
    if (flags.size === 0) {
      const key = `chapters/${page.chapterId}/delivery-${page.attempt}-${String(page.pageNumber).padStart(4, '0')}-${randomInt(1000, 9999)}.png`;
      await putDeliveryImage(key, rendered.image);
      await db().update(chapterPages).set({ outputKey: key, outputBytes: rendered.image.length, visualQaFlags: [] }).where(eq(chapterPages.id, pageId));
      if (oldOutputKey && oldOutputKey !== key) await deleteImage(oldOutputKey);
    }
    for (const segment of segments) {
      const previous = segment.qaFlags.filter(flag => !visualFlags.has(flag));
      const next = [...new Set([...previous, ...(rendered.flags.get(segment.id) ?? []), ...flags])];
      await db().update(translationSegments).set({ qaFlags: next, warning: next.join(', ') || null,
        processingStatus: next.length ? 'needs_review' : 'complete' }).where(eq(translationSegments.id, segment.id));
    }
  } catch (error) {
    flags.add(error instanceof Error && error.message.includes('cleanup') ? 'cleanup_failed' : 'delivery_storage_failed');
  }
  if (flags.size) {
    await db().update(chapterPages).set({ outputKey: null, outputBytes: null, visualQaFlags: [...flags] }).where(eq(chapterPages.id, pageId));
    if (oldOutputKey) await deleteImage(oldOutputKey);
    await db().insert(translationJobLogs).values({ jobId, attempt: page.attempt, stage: 'qa', level: 'warning', message: 'Corrected review text could not pass visual QA.', details: { pageNumber: page.pageNumber, flags: [...flags] } });
  } else {
    await db().insert(translationJobLogs).values({ jobId, attempt: page.attempt, stage: 'typesetting', message: `Re-rendered page ${page.pageNumber} after manual text correction.` });
  }
  return [...flags];
}
