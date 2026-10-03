import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.CHAPTER_ZIP_MAX_BYTES = '1048576';

function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const byte of buf) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (-(c & 1) & 0xedb88320); }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(entries: [string, Buffer][]) {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const [name, data] of entries) {
    const filename = Buffer.from(name); const compressed = deflateRawSync(data); const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, filename); offset += local.length + filename.length + compressed.length;
  }
  const centralData = Buffer.concat(centrals); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralData, end]);
}
const img = (color: { r: number; g: number; b: number }) => sharp({ create: { width: 450, height: 600, channels: 3, background: color } }).png().toBuffer();
const load = async () => (await import('./chapter-ingestion')).inspectChapterZip;

test('valid numbered ZIP is naturally sorted and normalized', async () => {
  const inspect = await load();
  const input = zip([['page10.png', await img({ r: 10, g: 0, b: 0 })], ['page2.png', await img({ r: 20, g: 0, b: 0 })], ['page1.png', await img({ r: 30, g: 0, b: 0 })]]);
  const dir = await mkdtemp(path.join(tmpdir(), 'nerio-chapter-'));
  const samplePath = path.join(dir, 'sample-chapter.zip');
  await writeFile(samplePath, input);
  const pages = await inspect(await readFile(samplePath), 'sample-chapter.zip', 'application/zip');
  await rm(dir, { recursive: true, force: true });
  assert.deepEqual(pages.map(p => p.filename), ['page1.png', 'page2.png', 'page10.png']);
  assert.equal(pages[0].width, 450); assert.equal(pages[0].height, 600);
});

test('rejects a non-ZIP file, invalid archive and traversal paths', async () => {
  const inspect = await load();
  await assert.rejects(inspect(Buffer.from('nope'), 'chapter.zip', 'application/zip'), /valid ZIP signature/);
  await assert.rejects(inspect(zip([['../page1.png', await img({ r: 0, g: 0, b: 0 })]]), 'chapter.zip', 'application/zip'), /unsafe file path/);
  await assert.rejects(inspect(zip([['page1.png', Buffer.from('broken')]]), 'chapter.zip', 'application/zip'), /readable image/);
  await assert.rejects(inspect(zip([['page1.gif', await img({ r: 0, g: 0, b: 0 })]]), 'chapter.zip', 'application/zip'), /Unsupported file/);
});

test('rejects ambiguous ordering and duplicate image content', async () => {
  const inspect = await load(); const one = await img({ r: 0, g: 0, b: 0 });
  await assert.rejects(inspect(zip([['front.png', one]]), 'chapter.zip', 'application/zip'), /Cannot determine page order/);
  await assert.rejects(inspect(zip([['page1.png', one], ['page2.png', one]]), 'chapter.zip', 'application/zip'), /duplicates another page/);
});

test('rejects unsupported extension and forged claimed MIME type', async () => {
  const inspect = await load(); const data = zip([['page1.png', await img({ r: 1, g: 1, b: 1 })]]);
  await assert.rejects(inspect(data, 'chapter.rar', 'application/zip'), /\.zip extension/);
  await assert.rejects(inspect(data, 'chapter.zip', 'text/plain'), /file type must be ZIP/);
});

test('rejects oversized ZIP input and undersized page dimensions', async () => {
  const inspect = await load(); const data = zip([['page1.png', await img({ r: 1, g: 1, b: 1 })]]);
  await assert.rejects(inspect(Buffer.concat([data, Buffer.alloc(1_048_577)]), 'chapter.zip', 'application/zip'), /size limit/);
  const small = await sharp({ create: { width: 300, height: 600, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(inspect(zip([['page1.png', small]]), 'chapter.zip', 'application/zip'), /smaller than the minimum/);
});
