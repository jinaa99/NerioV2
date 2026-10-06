import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  batchStatus, canRerunOcr, evaluateChapter, formatPageText, isTranslated, nextUntranslated, pageComplete, parseBulkTranslation, shouldAutoPublish,
  type PageState, type SegmentState,
} from '@/lib/manual-translation';
import { DEFAULT_TYPESET_STYLE, resolveStyle } from '@/lib/typeset-style';
import { chapterFromName, naturalCompare } from '@/lib/chapter-files';
import { zip } from './test-zip';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.CHAPTER_ZIP_MAX_BYTES = '5242880';
process.env.CHAPTER_IMAGE_MIN_WIDTH = '64';
process.env.CHAPTER_IMAGE_MIN_HEIGHT = '16';

/* ZIP fixtures */

const png = (shade: number) => sharp({ create: { width: 300, height: 400, channels: 3, background: { r: shade, g: shade, b: shade } } }).png().toBuffer();
const inspect = async () => (await import('./chapter-ingestion')).inspectChapterZip;

/* Page order */

test('natural page ordering: numeric runs sort as numbers, not text', async () => {
  const files = ['10.jpg', '2.jpg', '1.jpg', '11.jpg', '3.jpg'];
  assert.deepEqual([...files].sort(naturalCompare), ['1.jpg', '2.jpg', '3.jpg', '10.jpg', '11.jpg']);
  const run = await inspect();
  const names = ['page_010.png', 'page_002.png', 'page_001.png'];
  const pages = await run(zip(await Promise.all(names.map(async (n, i) => [n, await png(10 + i)] as [string, Buffer]))), 'ch.zip', 'application/zip');
  assert.deepEqual(pages.map(p => p.filename), ['page_001.png', 'page_002.png', 'page_010.png']);
  const chapterStyle = ['chapter_01_010.png', 'chapter_01_001.png', 'chapter_01_002.png'];
  const ordered = await run(zip(await Promise.all(chapterStyle.map(async (n, i) => [n, await png(20 + i)] as [string, Buffer]))), 'ch.zip', 'application/zip');
  assert.deepEqual(ordered.map(p => p.filename), ['chapter_01_001.png', 'chapter_01_002.png', 'chapter_01_010.png']);
  const plain = ['10.png', '1.png', '2.png', '001.png'];
  const mixed = await run(zip(await Promise.all(plain.map(async (n, i) => [n, await png(30 + i)] as [string, Buffer]))), 'ch.zip', 'application/zip');
  // "001" and "1" are numerically equal: the tie is broken deterministically by the raw name.
  assert.deepEqual(mixed.map(p => p.filename), ['001.png', '1.png', '2.png', '10.png']);
});

test('chapter numbers are read from ZIP names', () => {
  assert.equal(chapterFromName('Chapter 001.zip'), 1);
  assert.equal(chapterFromName('Solo Leveling Ch_12.5.cbz'), 12.5);
  assert.equal(chapterFromName('045.zip'), 45);
  assert.equal(chapterFromName('extras.zip'), null);
});

/* Safe extraction */

test('ZIP validation rejects traversal, absolute paths, symlink-like names, bombs and unsupported files', async () => {
  const run = await inspect(); const image = await png(1);
  await assert.rejects(run(zip([['../../etc/passwd.png', image]]), 'c.zip', 'application/zip'), /unsafe file path/);
  await assert.rejects(run(zip([['/abs/page.png', image]]), 'c.zip', 'application/zip'), /unsafe file path/);
  await assert.rejects(run(zip([['..\\..\\evil.png', image]]), 'c.zip', 'application/zip'), /unsafe file path/);
  // Windows separators are normalized; names are only used for ordering, never as storage paths.
  assert.equal((await run(zip([['dir\\page.png', image]]), 'c.zip', 'application/zip'))[0].filename, 'dir/page.png');
  await assert.rejects(run(zip([['a/%2e%2e/page.png', image]]), 'c.zip', 'application/zip'), /unsafe file path/);
  await assert.rejects(run(zip([['page.svg', Buffer.from('<svg/>')]]), 'c.zip', 'application/zip'), /Unsupported file/);
  await assert.rejects(run(Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(64)]), 'c.zip', 'application/zip'), /not a valid ZIP|malformed|damaged/);
  // An entry that claims to expand to 900 MB from a few bytes is refused before anything is inflated.
  await assert.rejects(run(zip([['page.png', Buffer.alloc(1000)]], { lieSize: 900 * 1024 * 1024 }), 'c.zip', 'application/zip'), /size limit|exceeds/);
});

test('extraction reports validating → extracting → sorting → processing progress', async () => {
  const run = await inspect();
  const phases: string[] = [];
  await run(zip([['2.png', await png(5)], ['1.png', await png(6)]]), 'c.zip', 'application/zip', event => { if (phases.at(-1) !== event.phase) phases.push(event.phase); });
  assert.deepEqual(phases, ['validating', 'extracting', 'sorting', 'processing_images']);
});

test('multiple ZIPs are processed independently: one corrupt archive does not affect the others', async () => {
  const run = await inspect();
  const good = zip([['1.png', await png(40)], ['2.png', await png(41)]]);
  const bad = zip([['1.png', Buffer.from('not an image')]]);
  const results = await Promise.allSettled([run(good, 'Chapter 001.zip', 'application/zip'), run(bad, 'Chapter 002.zip', 'application/zip'), run(good, 'Chapter 003.zip', 'application/zip')]);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal((results[0] as PromiseFulfilledResult<unknown[]>).value.length, 2);
});

/* Background queue */

test('job queue: bounded concurrency, de-duplication, failure isolation and coalesced re-runs', async () => {
  const { createJobQueue } = await import('./ai/job-queue');
  let active = 0, peak = 0; const ran: string[] = [];
  const queue = createJobQueue<{ fail?: boolean }>(`test-${Math.random()}`, () => 2, async (payload, key) => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--; ran.push(key);
    if (payload.fail) throw new Error('boom');
  });
  const errors = console.error; console.error = () => {};
  const { accepted, done } = queue.enqueue([{ key: 'a', payload: {} }, { key: 'b', payload: { fail: true } }, { key: 'c', payload: {} }, { key: 'a', payload: {} }, { key: 'd', payload: {} }]);
  // Once 'c' is running, a new request for it is coalesced into exactly one more run.
  await new Promise(resolve => setTimeout(resolve, 22));
  queue.enqueue([{ key: 'c', payload: {} }], { rerun: true });
  queue.enqueue([{ key: 'c', payload: {} }], { rerun: true });
  await done;
  await new Promise(resolve => setTimeout(resolve, 60));
  console.error = errors;
  assert.deepEqual(accepted, ['a', 'b', 'c', 'd']);
  assert.ok(peak <= 2, `peak concurrency ${peak}`);
  assert.ok(['a', 'c', 'd'].every(key => ran.includes(key)), 'a failing job must not stop the others');
  assert.equal(ran.filter(key => key === 'c').length, 2, 'a re-run requested while running is executed once more');
  assert.equal(queue.has('a'), false);
});

/* Workflow rules */

const page = (id: string, extra: Partial<PageState> = {}): PageState => ({ id, pageNumber: Number(id.replace(/\D/g, '')) || 1, ocrStatus: 'done', editVersion: 2, renderedVersion: 2, renderStatus: 'idle', hasOutput: true, ...extra });
const seg = (id: string, pageId: string, translationStatus: SegmentState['translationStatus'], typesetStatus: SegmentState['typesetStatus'] = 'rendered'): SegmentState => ({ id, pageId, translationStatus, typesetStatus });

test('page and chapter completion, and incomplete chapters cannot publish', () => {
  const pages = [page('p1'), page('p2'), page('p3', { hasOutput: false, editVersion: 0, renderedVersion: 0 })];
  const segments = [seg('s1', 'p1', 'translated'), seg('s2', 'p1', 'approved'), seg('s3', 'p2', 'draft', 'pending')];
  assert.equal(pageComplete(pages[0], segments.slice(0, 2)), true);
  assert.equal(pageComplete(pages[1], segments.slice(2)), false);
  assert.equal(pageComplete(pages[2], []), true, 'a page without text ships as the original image');
  const partial = evaluateChapter(pages, segments);
  assert.equal(partial.complete, false);
  assert.equal(partial.remaining, 1);
  assert.match(partial.blocking.join(' '), /1 segment still needs a translation/);
  assert.equal(shouldAutoPublish(true, partial), false);
  assert.equal(partial.percent, Math.floor((2 + 1) / 4 * 100));

  const done = evaluateChapter(pages, [segments[0], segments[1], seg('s3', 'p2', 'translated')]);
  assert.equal(done.complete, true);
  assert.deepEqual(done.blocking, []);
  assert.equal(shouldAutoPublish(false, done), false, 'auto-publish is off by default');
  assert.equal(shouldAutoPublish(true, done), true);
});

test('blocking errors stop publishing: stale image, failed render, OCR failure, image review, required approval', () => {
  const ok = [seg('s1', 'p1', 'translated')];
  assert.equal(evaluateChapter([page('p1', { editVersion: 3, renderedVersion: 2 })], ok).complete, false, 'final image older than the last save');
  assert.match(evaluateChapter([page('p1', { renderStatus: 'failed' })], ok).blocking.join(' '), /Final image generation failed/);
  assert.match(evaluateChapter([page('p1'), page('p2', { ocrStatus: 'failed' })], ok).blocking.join(' '), /OCR failed on 1 page/);
  assert.match(evaluateChapter([page('p1')], [seg('s1', 'p1', 'translated', 'needs_review')]).blocking.join(' '), /image review/);
  assert.equal(evaluateChapter([page('p1')], [seg('s1', 'p1', 'translated', 'accepted')]).complete, true, 'an accepted image warning no longer blocks');
  assert.equal(evaluateChapter([page('p1', { hasOutput: false })], ok).complete, false, 'lettered pages need a stored final image');
  assert.equal(evaluateChapter([page('p1')], ok, true).complete, false, 'with approval required, saved is not enough');
  assert.equal(evaluateChapter([page('p1')], [seg('s1', 'p1', 'approved')], true).complete, true);
  assert.equal(evaluateChapter([], []).complete, false);
});

test('batch status labels follow the durable job and chapter state', () => {
  const ev = (segments: number, translated: number, complete = false) => ({ segments, translated, drafts: 0, remaining: segments - translated, complete });
  assert.equal(batchStatus({ status: 'queued', stage: 'queued' }, 'processing', ev(0, 0)), 'QUEUED');
  assert.equal(batchStatus({ status: 'running', stage: 'ocr' }, 'processing', ev(0, 0)), 'OCR_PROCESSING');
  assert.equal(batchStatus({ status: 'failed', stage: 'failed' }, 'failed', ev(0, 0)), 'FAILED');
  assert.equal(batchStatus({ status: 'cancelled', stage: 'ocr' }, 'draft', ev(0, 0)), 'CANCELLED');
  assert.equal(batchStatus({ status: 'ready', stage: 'translating' }, 'in_review', ev(10, 0)), 'TRANSLATION_PENDING');
  assert.equal(batchStatus({ status: 'ready', stage: 'translating' }, 'in_review', ev(10, 4)), 'TRANSLATION_IN_PROGRESS');
  assert.equal(batchStatus({ status: 'ready', stage: 'typesetting' }, 'in_review', ev(10, 10)), 'FINALIZATION');
  assert.equal(batchStatus({ status: 'ready', stage: 'ready' }, 'ready', ev(10, 10, true)), 'READY_TO_PUBLISH');
  assert.equal(batchStatus({ status: 'ready', stage: 'published' }, 'published', ev(10, 10, true)), 'COMPLETED');
});

test('copy all page text and bulk paste-back round-trip', () => {
  const copied = formatPageText(['WHERE DID YOU GO?', 'Meanwhile...', '  Hey!  ']);
  assert.equal(copied, '[SEGMENT_001]\nWHERE DID YOU GO?\n\n[SEGMENT_002]\nMeanwhile...\n\n[SEGMENT_003]\nHey!');
  const pasted = parseBulkTranslation('[SEGMENT_002]\nЭнэ хооронд...\n\n[SEGMENT_001]\nЧи хаашаа явсан бэ?\nӨчигдөр шөнө?\r\n\n[SEGMENT_003]\n\n');
  assert.deepEqual([...pasted.entries()].sort((a, b) => a[0] - b[0]), [[1, 'Чи хаашаа явсан бэ?\nӨчигдөр шөнө?'], [2, 'Энэ хооронд...']]);
  const numbered = parseBulkTranslation('1. Сайн уу\n2) Үгүй ээ\n');
  assert.deepEqual([...numbered.entries()], [[1, 'Сайн уу'], [2, 'Үгүй ээ']]);
  assert.equal(parseBulkTranslation('just text').size, 0);
});

test('next untranslated segment and OCR re-run protection of manual work', () => {
  const list = [{ id: 'a', translationStatus: 'translated' as const }, { id: 'b', translationStatus: 'pending' as const }, { id: 'c', translationStatus: 'draft' as const }];
  assert.equal(nextUntranslated(list, 'a')?.id, 'b');
  assert.equal(nextUntranslated(list, 'b')?.id, 'c');
  assert.equal(nextUntranslated(list, 'c')?.id, 'b', 'wraps around');
  assert.equal(nextUntranslated([{ id: 'a', translationStatus: 'approved' as const }], 'a'), null);
  assert.equal(isTranslated('translated'), true);
  assert.equal(isTranslated('translated', true), false);
  assert.equal(canRerunOcr([{ translatedText: null }, { translatedText: '  ' }]), true);
  assert.equal(canRerunOcr([{ translatedText: 'Сайн уу' }]), false, 'never overwrite a typed translation');
});

test('typesetting style: overrides merge, invalid stored values are ignored', () => {
  const style = resolveStyle(DEFAULT_TYPESET_STYLE, { align: 'left', fontSize: 30, bold: true }, { color: 'red' }, { unknown: 1 });
  assert.equal(style.align, 'left'); assert.equal(style.fontSize, 30); assert.equal(style.bold, true);
  assert.equal(style.color, null, 'an invalid colour override is dropped');
  assert.equal(resolveStyle(DEFAULT_TYPESET_STYLE, { minFontSize: 50, maxFontSize: 20 }).minFontSize, 20);
});

/* Typesetting */

const W = 800, H = 1000;
const balloonPage = (background = '#cfd3d6') => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="${background}"/>
  <ellipse cx="400" cy="300" rx="280" ry="170" fill="#ffffff" stroke="#111111" stroke-width="6"/>
  <rect x="260" y="250" width="280" height="30" fill="#141414"/><rect x="290" y="300" width="220" height="30" fill="#141414"/>
</svg>`)).png().toBuffer();
const box = { x: 250 / W, y: 240 / H, w: 300 / W, h: 100 / H };
const raw = (image: Buffer) => sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const inkBounds = async (image: Buffer) => {
  const { data, info } = await raw(image);
  let x0 = Infinity, x1 = -Infinity, n = 0;
  for (let y = 140; y < 460; y++) for (let x = 130; x < 670; x++) {
    const i = (y * info.width + x) * 3;
    if (((x - 400) / 270) ** 2 + ((y - 300) / 160) ** 2 > 1) continue;
    if (data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  }
  return { x0, x1, n, centre: (x0 + x1) / 2 };
};

test('Mongolian Cyrillic renders with every letter (incl. Ө ө Ү ү) inside the balloon; original stays untouched', async () => {
  const { renderMongolianText } = await import('./ai/typesetting');
  const master = await balloonPage();
  const before = createHash('sha256').update(master).digest('hex');
  const alphabet = 'АБВГДЕЁЖЗИЙКЛМНОӨПРСТУҮФХЦЧШЩЪЫЬЭЮЯ абвгдеёжзийклмноөпрстуүфхцчшщъыьэюя';
  for (const fontFamily of ['shonen', 'noto-sans'] as const) {
    const result = await renderMongolianText(master, [{ id: 's', ...box, text: alphabet, sourceLines: 2 }], { style: { ...DEFAULT_TYPESET_STYLE, fontFamily } });
    assert.ok(!result.flags.get('s')!.includes('missing_glyph'), `${fontFamily} must have every Mongolian Cyrillic glyph`);
    assert.equal(result.removal.get('s'), 'clean');
    assert.notEqual(createHash('sha256').update(result.image).digest('hex'), before, 'a separate final image is produced');
  }
  assert.equal(createHash('sha256').update(master).digest('hex'), before, 'the original buffer is never modified');
  // Pixels outside the balloon stay identical: only the text region is changed.
  const result = await renderMongolianText(master, [{ id: 's', ...box, text: 'Өнөөдөр бид үүнийг хийнэ.' }]);
  const [a, b] = await Promise.all([raw(master), raw(result.image)]);
  let changedOutside = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (((x - 400) / 290) ** 2 + ((y - 300) / 180) ** 2 <= 1) continue;
    const i = (y * W + x) * 3;
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) changedOutside++;
  }
  assert.equal(changedOutside, 0);
});

test('text fitting shrinks long translations, flags impossible ones, honours explicit size and alignment', async () => {
  const { renderMongolianText } = await import('./ai/typesetting');
  const master = await balloonPage();
  const short = await renderMongolianText(master, [{ id: 's', ...box, text: 'Тийм.', sourceLines: 2 }]);
  const long = await renderMongolianText(master, [{ id: 's', ...box, text: 'Бид өнөө орой гудамжинд гарч, хүмүүсээс юу болсныг нэг бүрчлэн асууж тодруулах хэрэгтэй байна шүү дээ.', sourceLines: 2 }]);
  assert.ok(long.fontSizes.get('s')! < short.fontSizes.get('s')!, 'longer text is set smaller');
  assert.ok(!long.flags.get('s')!.includes('overflow'));
  const impossible = await renderMongolianText(master, [{ id: 's', ...box, text: 'Маш урт текст '.repeat(60) }]);
  assert.ok(impossible.flags.get('s')!.includes('overflow'), 'text that cannot fit is flagged instead of silently overflowing');
  const fixed = await renderMongolianText(master, [{ id: 's', ...box, text: 'Тийм.', style: { fontSize: 22 } }]);
  assert.equal(fixed.fontSizes.get('s'), 22);
  const left = await inkBounds((await renderMongolianText(master, [{ id: 's', ...box, text: 'Тийм.', style: { align: 'left', fontSize: 28 } }])).image);
  const right = await inkBounds((await renderMongolianText(master, [{ id: 's', ...box, text: 'Тийм.', style: { align: 'right', fontSize: 28 } }])).image);
  assert.ok(right.centre - left.centre > 100, `right-aligned text sits further right (${left.centre} → ${right.centre})`);
  const regular = await inkBounds((await renderMongolianText(master, [{ id: 's', ...box, text: 'Тийм.', style: { fontSize: 28 } }])).image);
  const bold = await inkBounds((await renderMongolianText(master, [{ id: 's', ...box, text: 'Тийм.', style: { fontSize: 28, bold: true } }])).image);
  assert.ok(bold.n > regular.n * 1.1, 'bold adds ink');
});

test('text over detailed artwork is flagged for image review instead of silently patched', async () => {
  const { renderMongolianText } = await import('./ai/typesetting');
  // Thin lettering strokes drawn straight onto noisy, multi-colour artwork: no balloon and no flat colour to repaint with.
  const noise = Buffer.alloc(W * H * 3);
  let seed = 7;
  for (let i = 0; i < noise.length; i++) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; noise[i] = seed >>> 24; }
  const strokes = Array.from({ length: 6 }, (_, i) => `<rect x="${305 + i * 32}" y="600" width="6" height="40" fill="#000"/>`).join('');
  const art = await sharp(noise, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${strokes}</svg>`) }]).png().toBuffer();
  const result = await renderMongolianText(art, [{ id: 'free', x: 290 / W, y: 590 / H, w: 220 / W, h: 60 / H, text: 'Бум!' }]);
  assert.equal(result.removal.get('free'), 'needs_review');
});

/* OCR segment creation */

test('OCR words become one region per balloon with line breaks; artefacts are dropped', async () => {
  const { clusterWords } = await import('./ai/ocr-layout');
  const w = (text: string, x0: number, y0: number, confidence = 95, width = text.length * 18) => ({ text, x0, y0, x1: x0 + width, y1: y0 + 30, confidence });
  const regions = clusterWords([
    w('SEE', 300, 100, 30), w('YOU', 370, 100, 30), w('TOMORROW.', 280, 140, 66),
    w('I', 600, 600), w('WAS', 620, 600), w('HOME.', 700, 600),
    w('|||', 50, 900, 90), w('~', 60, 950, 99), w('x', 400, 990, 40), w('Zq#%', 500, 990, 35),
  ]);
  assert.deepEqual(regions.map(r => r.text), ['SEE YOU\nTOMORROW.', 'I WAS HOME.']);
  assert.equal(regions[0].lines, 2);
  assert.ok(regions[0].confidence < regions[1].confidence, 'low OCR certainty stays visible for review');
});

test('segment reading order is deterministic: rows top to bottom, left-to-right (right-to-left for Japanese)', async () => {
  const { readingOrder, readingDirection } = await import('./ai/ocr-layout');
  const b = (id: string, x: number, y: number) => ({ id, x, y, w: 0.2, h: 0.05 });
  const regions = [b('bottom', 0.1, 0.8), b('top-right', 0.6, 0.1), b('top-left', 0.1, 0.11), b('middle', 0.4, 0.4)];
  assert.deepEqual(readingOrder(regions, 'ltr').map(r => r.id), ['top-left', 'top-right', 'middle', 'bottom']);
  assert.deepEqual(readingOrder(regions, readingDirection('ja')).map(r => r.id), ['top-right', 'top-left', 'middle', 'bottom']);
  assert.deepEqual(readingOrder([...regions].reverse(), 'ltr').map(r => r.id), readingOrder(regions, 'ltr').map(r => r.id));
});
