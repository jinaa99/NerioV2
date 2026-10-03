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

test('Shonen font renders Mongolian Cyrillic dialogue without missing glyphs or overflow', async () => {
  const rendered = await renderMongolianText(await image(), [
    { id: 'greeting', x: 0.1, y: 0.1, w: 0.8, h: 0.18, text: 'Өнөөдөр Үүрийн гэгээтэй сайхан өдөр байна.' },
  ], true, 'shonen');

  assert.deepEqual(rendered.pageFlags, []);
  assert.equal(rendered.flags.get('greeting')?.includes('missing_glyph'), false);
  assert.ok((rendered.fontSizes.get('greeting') ?? 0) >= 16);
  assert.deepEqual(await sharp(rendered.image).metadata().then(({ width, height }) => [width, height]), [1000, 1200]);
});

test('Noto Sans fallback also covers Mongolian Cyrillic', async () => {
  const rendered = await renderMongolianText(await image(), [
    { id: 'noto', x: 0.1, y: 0.1, w: 0.8, h: 0.18, text: 'Өнөөдөр Үүрийн гэгээтэй сайхан өдөр байна.' },
  ], true, 'noto-sans');
  assert.deepEqual(rendered.pageFlags, []);
});

test('text that cannot fit the bubble is flagged and blocks publication', async () => {
  const rendered = await renderMongolianText(await image(), [
    { id: 'long', x: 0.1, y: 0.1, w: 0.12, h: 0.035, text: 'Энэ маш урт өгүүлбэр жижигхэн ярианы бөмбөлөгт багтахгүй тул нийтлэх ёсгүй.' },
  ], true, 'shonen');

  assert.ok(rendered.pageFlags.includes('overflow'));
  assert.ok(rendered.pageFlags.includes('clipping') || rendered.pageFlags.includes('unreadably_small_text'));
});
