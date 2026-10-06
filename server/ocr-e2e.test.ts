import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'opentype.js';
import sharp from 'sharp';
import { evaluateChapter, formatPageText, parseBulkTranslation, type PageState, type SegmentState } from '@/lib/manual-translation';
import { zip } from './test-zip';

/**
 * End-to-end without a database or any paid API: a small sample ZIP goes through safe extraction and natural
 * sorting, local Tesseract OCR, balloon grouping and reading order, "manual" translations pasted back in the bulk
 * format, deterministic typesetting into separate final images, and the publish gate.
 */
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.OCR_PROVIDER = 'tesseract';
process.env.TESSERACT_CACHE_DIR ??= './.cache/tesseract';

// Tesseract runs in worker threads; stop them so the test process can exit.
after(async () => { await (await import('./ai/ocr-tesseract')).terminateOcrWorkers(); });

const W = 800, H = 1200;
async function letteredPage(lines: { text: string[]; cx: number; cy: number; rx: number; ry: number }[], extra = '') {
  const buffer = await readFile(path.join(process.cwd(), 'assets/fonts/NotoSans-Variable.ttf'));
  const font = parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  const shapes = lines.map(b => {
    const paths = b.text.map((line, i) => {
      const width = font.getAdvanceWidth(line, 34);
      return `<path d="${font.getPath(line, b.cx - width / 2, b.cy - (b.text.length - 1) * 22 + i * 44 + 12, 34).toPathData(2)}" fill="#111"/>`;
    }).join('');
    return `<ellipse cx="${b.cx}" cy="${b.cy}" rx="${b.rx}" ry="${b.ry}" fill="#fff" stroke="#111" stroke-width="5"/>${paths}`;
  }).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#9aa7b4"/>${shapes}${extra}</svg>`)).png().toBuffer();
}

test('local Tesseract OCR finds each balloon (and white-on-black captions) as one segment in reading order', async () => {
  const { getOCRProvider } = await import('./ai/providers');
  const { readingOrder } = await import('./ai/ocr-layout');
  const buffer = await readFile(path.join(process.cwd(), 'assets/fonts/NotoSans-Variable.ttf'));
  const font = parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  const caption = `<rect x="80" y="980" width="640" height="110" fill="#111"/><path d="${font.getPath('MEANWHILE, AT THE CASTLE', 400 - font.getAdvanceWidth('MEANWHILE, AT THE CASTLE', 32) / 2, 1046, 32).toPathData(2)}" fill="#fff"/>`;
  const image = await letteredPage([
    { text: ['WHERE DID YOU', 'GO LAST NIGHT?'], cx: 260, cy: 250, rx: 220, ry: 130 },
    { text: ['I WAS AT HOME.'], cx: 560, cy: 700, rx: 210, ry: 100 },
  ], caption);
  const regions = readingOrder(await getOCRProvider().recognize(image, 'en'));
  assert.equal(regions.length, 3, JSON.stringify(regions.map(r => r.text)));
  assert.match(regions[0].text.replace(/\s+/g, ' '), /WHERE DID YOU GO LAST NIGHT\?/);
  assert.match(regions[1].text, /I WAS AT HOME/);
  assert.match(regions[2].text, /MEANWHILE, AT THE CASTLE/);
  assert.ok(regions[0].confidence > 0.6);
  assert.ok(regions.every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 && r.y + r.h <= 1));
});

test('sample ZIP → OCR → manual translation → final images → publish gate, with no translation API calls', async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { calls.push(String(input instanceof Request ? input.url : input)); return realFetch(input, init); }) as typeof fetch;
  try {
    const { inspectChapterZip } = await import('./chapter-ingestion');
    const { getOCRProvider } = await import('./ai/providers');
    const { readingOrder } = await import('./ai/ocr-layout');
    const { groupByBalloon } = await import('./ai/runner');
    const { rasterize } = await import('./ai/bubbles');
    const { renderMongolianText } = await import('./ai/typesetting');

    const page1 = await letteredPage([{ text: ['HELLO THERE,', 'FRIEND!'], cx: 400, cy: 300, rx: 260, ry: 140 }]);
    const page2 = await letteredPage([{ text: ['SEE YOU', 'TOMORROW.'], cx: 400, cy: 600, rx: 240, ry: 130 }]);
    const blank = await sharp({ create: { width: W, height: H, channels: 3, background: '#9aa7b4' } }).png().toBuffer();
    const archive = zip([['Chapter 7/10.png', blank], ['Chapter 7/2.png', page2], ['Chapter 7/1.png', page1], ['__MACOSX/._1.png', Buffer.from('junk')]]);
    const pages = await inspectChapterZip(archive, 'Chapter 007.zip', 'application/zip');
    assert.deepEqual(pages.map(p => p.filename.split('/').at(-1)), ['1.png', '2.png', '10.png']);

    const ocr = getOCRProvider();
    const segments: { id: string; pageIndex: number; position: number; x: number; y: number; w: number; h: number; source: string }[] = [];
    for (const [pageIndex, page] of pages.entries()) {
      const raster = await rasterize(page.bytes);
      const merged = groupByBalloon(raster, await ocr.recognize(page.bytes, 'en')).map(group => group.region);
      readingOrder(merged).forEach((region, i) => segments.push({ id: `p${pageIndex}-s${i + 1}`, pageIndex, position: i + 1, x: region.x, y: region.y, w: region.w, h: region.h, source: region.text }));
    }
    assert.deepEqual(segments.map(s => s.pageIndex), [0, 1], 'one balloon per lettered page, none on the blank page');
    assert.match(segments[0].source, /HELLO/);

    // The translator copies page text, translates outside, and pastes it back.
    const translations = new Map<string, string>([['HELLO', 'Сайн уу, найз минь!'], ['SEE', 'Маргааш уулзъя. Өглөө ирээрэй, Үүрээр.']]);
    const finals: Buffer[] = []; const states: PageState[] = []; const segmentStates: SegmentState[] = [];
    for (const [pageIndex, page] of pages.entries()) {
      const onPage = segments.filter(s => s.pageIndex === pageIndex);
      const copied = parseBulkTranslation(formatPageText(onPage.map(s => s.source)));
      assert.equal(copied.size, onPage.length, 'every segment is in the copied page text');
      // Translate each copied block "externally" and paste the result back in the same tagged format.
      const external = [...copied].map(([n, text]) => `[SEGMENT_${String(n).padStart(3, '0')}]\n${[...translations].find(([k]) => text.toUpperCase().includes(k))?.[1] ?? `UNMATCHED ${text}`}`).join('\n\n');
      const pasted = parseBulkTranslation(external);
      const before = createHash('sha256').update(page.bytes).digest('hex');
      const rendered = onPage.length ? await renderMongolianText(page.bytes, onPage.map((s, i) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h, text: pasted.get(i + 1) ?? '', uppercase: true, sourceLines: 2 }))) : null;
      assert.equal(createHash('sha256').update(page.bytes).digest('hex'), before, 'original page bytes untouched');
      for (const s of onPage) {
        const flags = rendered!.flags.get(s.id)!;
        assert.deepEqual(flags.filter(f => f === 'missing_glyph' || f === 'overflow' || f === 'missing_translation'), [], `${s.id}: ${flags.join(',')}`);
        segmentStates.push({ id: s.id, pageId: `page-${pageIndex}`, translationStatus: 'translated', typesetStatus: rendered!.removal.get(s.id) === 'clean' ? 'rendered' : 'needs_review' });
      }
      if (rendered) { finals.push(rendered.image); assert.notEqual(createHash('sha256').update(rendered.image).digest('hex'), before, 'final image stored separately'); }
      states.push({ id: `page-${pageIndex}`, pageNumber: pageIndex + 1, ocrStatus: 'done', editVersion: onPage.length ? 1 : 0, renderedVersion: onPage.length ? 1 : 0, renderStatus: 'idle', hasOutput: !!rendered });
    }
    assert.equal(finals.length, 2);
    const evaluation = evaluateChapter(states, segmentStates);
    assert.equal(evaluation.complete, true, evaluation.blocking.join(' '));
    assert.equal(evaluation.percent, 100);
    // An untranslated segment would keep the chapter unpublishable.
    assert.equal(evaluateChapter(states, [...segmentStates.slice(1), { ...segmentStates[0], translationStatus: 'draft' }]).complete, false);
    assert.deepEqual(calls.filter(url => /openai|anthropic|googleapis|generativelanguage|dashscope|deepl|translate/i.test(url)), [], 'no translation API was called');
  } finally {
    globalThis.fetch = realFetch;
  }
});
