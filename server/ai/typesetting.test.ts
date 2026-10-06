import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { renderMongolianText } from './typesetting';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.TYPESET_MIN_FONT_SIZE = '12';
process.env.TYPESET_MAX_FONT_SIZE = '36';
process.env.TYPESET_LINE_HEIGHT = '1.18';
process.env.TYPESET_BUBBLE_PADDING = '0.1';
process.env.TYPESET_ALIGNMENT = 'center';

const image = () => sharp({ create: { width: 1000, height: 1200, channels: 3, background: '#eeeeee' } }).png().toBuffer();

// A white speech balloon with a black outline on a light grey scene, lettered with three black "lines" of text.
const W = 900, H = 1400, cx = 450, cy = 420, rx = 300, ry = 190;
const balloonPage = () => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="#d8dadc"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#ffffff" stroke="#111111" stroke-width="6"/>
  <path d="M${cx - 20} ${cy + ry - 4} L${cx} ${cy + ry + 120} L${cx + 30} ${cy + ry - 4} Z" fill="#ffffff" stroke="#111111" stroke-width="6"/>
  <rect x="${cx - 18}" y="${cy + ry - 12}" width="44" height="14" fill="#ffffff"/>
  <rect x="270" y="330" width="360" height="40" fill="#141414"/>
  <rect x="250" y="400" width="400" height="40" fill="#141414"/>
  <rect x="330" y="470" width="240" height="40" fill="#141414"/>
</svg>`)).png().toBuffer();
const insideBalloon = (x: number, y: number) => ((x - cx) / (rx - 4)) ** 2 + ((y - cy) / (ry - 4)) ** 2 <= 1;
// Outside the outer edge of the 6px outline.
const inTail = (x: number, y: number) => x > cx - 30 && x < cx + 40 && y > cy + ry - 12 && y < cy + ry + 126;
const outsideOutline = (x: number, y: number) => !inTail(x, y) && ((x - cx) / (rx + 4)) ** 2 + ((y - cy) / (ry + 4)) ** 2 > 1;

test('translation is lettered inside the detected balloon and the original lettering is erased', async () => {
  const page = await balloonPage();
  // Loose OCR box, as vision models return it.
  const rendered = await renderMongolianText(page, [
    { id: 'speech', x: 240 / W, y: 320 / H, w: 420 / W, h: 200 / H, text: 'Бид гудамжинд явах хүмүүсээс асуулаа!', uppercase: true, sourceLines: 3 },
  ]);
  assert.deepEqual(rendered.pageFlags, []);
  const [before, after] = await Promise.all([sharp(page).removeAlpha().raw().toBuffer({ resolveWithObject: true }), sharp(rendered.image).removeAlpha().raw().toBuffer({ resolveWithObject: true })]);
  let changedOutside = 0, inkInside = 0, oldInkLeft = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3, j = (y * W + x) * after.info.channels;
    const diff = Math.abs(before.data[i] - after.data[j]) + Math.abs(before.data[i + 1] - after.data[j + 1]) + Math.abs(before.data[i + 2] - after.data[j + 2]);
    const inBalloon = insideBalloon(x, y);
    if (outsideOutline(x, y) && diff > 0) changedOutside++;
    if (inBalloon && after.data[j] < 100) inkInside++;
  }
  // The old 40px-tall black bars must be gone: sample their left/right ends, which a centred translation can't cover fully.
  for (const [x, y] of [[272, 350], [628, 350], [252, 420], [648, 420]]) {
    const j = (y * W + x) * after.info.channels;
    if (after.data[j] < 100) oldInkLeft++;
  }
  assert.equal(changedOutside, 0, 'no pixel outside the balloon may change');
  assert.ok(inkInside > 2000, 'translation ink is drawn inside the balloon');
  assert.ok(oldInkLeft <= 1, 'original lettering is erased');
  assert.ok((rendered.fontSizes.get('speech') ?? 0) >= 20);
});

test('Shonen font renders Mongolian Cyrillic dialogue without missing glyphs or overflow', async () => {
  const rendered = await renderMongolianText(await image(), [
    { id: 'greeting', x: 0.1, y: 0.1, w: 0.8, h: 0.18, text: 'Өнөөдөр Үүрийн гэгээтэй сайхан өдөр байна.' },
  ], { font: 'shonen' });
  assert.deepEqual(rendered.pageFlags, []);
  assert.ok((rendered.fontSizes.get('greeting') ?? 0) >= 16);
  assert.deepEqual(await sharp(rendered.image).metadata().then(({ width, height }) => [width, height]), [1000, 1200]);
});

test('uppercase Mongolian, including Ө and Ү, has glyphs in both fonts', async () => {
  for (const font of ['shonen', 'noto-sans'] as const) {
    const rendered = await renderMongolianText(await image(), [
      { id: 'caps', x: 0.1, y: 0.1, w: 0.8, h: 0.18, text: 'Өнөөдөр үүр цайлаа', uppercase: true },
    ], { font });
    assert.equal(rendered.flags.get('caps')?.includes('missing_glyph'), false, font);
  }
});

test('text that cannot fit the bubble is flagged and blocks publication', async () => {
  const rendered = await renderMongolianText(await image(), [
    { id: 'long', x: 0.1, y: 0.1, w: 0.12, h: 0.035, text: 'Энэ маш урт өгүүлбэр жижигхэн ярианы бөмбөлөгт багтахгүй тул нийтлэх ёсгүй.' },
  ]);
  assert.ok(rendered.pageFlags.includes('overflow'));
});

test('very tall webtoon strips render without a page-sized overlay', async () => {
  const tall = await sharp({ create: { width: 720, height: 36000, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const rendered = await renderMongolianText(tall, [{ id: 'deep', x: 0.1, y: 0.9, w: 0.8, h: 0.01, text: 'Сайн байна уу' }]);
  assert.deepEqual(await sharp(rendered.image, { limitInputPixels: false }).metadata().then(({ width, height }) => [width, height]), [720, 36000]);
});
