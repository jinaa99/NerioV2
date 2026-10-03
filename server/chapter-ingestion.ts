import 'server-only';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import sharp, { type Metadata } from 'sharp';
import { serverEnv } from './env';

export type IngestPage = { filename: string; bytes: Buffer; width: number; height: number; hash: string };
export class IngestionError extends Error { constructor(readonly code: string, message: string) { super(message); } }

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
function safeName(name: string) {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || /%(?:2e|2f|5c)/i.test(name)) return false;
  let decoded = name;
  try { for (let i = 0; i < 3; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } } catch { return false; }
  return !decoded.split('/').some(part => part === '..' || part === '.' || part === '') && !decoded.includes('\\');
}
function readZip(data: Buffer): Promise<{ name: string; data: Buffer }[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(new IngestionError(err?.message.toLowerCase().includes('relative path') ? 'unsafe_path' : 'invalid_zip', err?.message.toLowerCase().includes('relative path') ? 'The ZIP contains an unsafe file path.' : 'The uploaded file is not a valid ZIP archive.'));
      const files: { name: string; data: Buffer }[] = [];
      let expanded = 0;
      const fail = (e: Error) => { zip.close(); reject(e); };
      zip.on('error', error => fail(error.message.toLowerCase().includes('relative path')
        ? new IngestionError('unsafe_path', 'The ZIP contains an unsafe file path.')
        : new IngestionError('invalid_zip', 'The ZIP archive is malformed or damaged.')));
      zip.on('entry', entry => {
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        if (!safeName(entry.fileName)) return fail(new IngestionError('unsafe_path', 'The ZIP contains an unsafe file path.'));
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((unixMode & 0o170000) === 0o120000) return fail(new IngestionError('unsafe_entry', 'The ZIP contains a symbolic link, which is not allowed.'));
        if (files.length >= serverEnv().CHAPTER_ARCHIVE_MAX_ENTRIES) return fail(new IngestionError('too_many_files', 'The archive has too many files.'));
        expanded += entry.uncompressedSize;
        if (expanded > serverEnv().CHAPTER_ARCHIVE_MAX_EXPANDED_BYTES) return fail(new IngestionError('archive_too_large', 'The expanded archive exceeds the configured size limit.'));
        if (entry.uncompressedSize > serverEnv().CHAPTER_IMAGE_MAX_BYTES) return fail(new IngestionError('image_too_large', `${entry.fileName} exceeds the individual image size limit.`));
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return fail(new IngestionError('invalid_zip', 'A file in the ZIP could not be read.'));
          const chunks: Buffer[] = []; let size = 0;
          stream.on('data', chunk => { size += chunk.length; if (size > serverEnv().CHAPTER_IMAGE_MAX_BYTES) stream.destroy(new Error('size')); else chunks.push(Buffer.from(chunk)); });
          stream.on('error', () => fail(new IngestionError('invalid_zip', 'A file in the ZIP could not be read.')));
          stream.on('end', () => { files.push({ name: entry.fileName, data: Buffer.concat(chunks) }); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolve(files));
      zip.readEntry();
    });
  });
}

export async function inspectChapterZip(data: Buffer, originalName: string, claimedType: string): Promise<IngestPage[]> {
  const env = serverEnv();
  if (data.length > env.CHAPTER_ZIP_MAX_BYTES) throw new IngestionError('zip_too_large', 'ZIP file exceeds the upload size limit.');
  if (!/\.zip$/i.test(originalName)) throw new IngestionError('unsupported_file', 'Choose a file with the .zip extension.');
  if (claimedType && !['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(claimedType)) throw new IngestionError('unsupported_file', 'The uploaded file type must be ZIP.');
  if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50) throw new IngestionError('invalid_zip', 'The uploaded file does not have a valid ZIP signature.');
  const files = await readZip(data);
  if (!files.length) throw new IngestionError('empty_archive', 'The ZIP archive contains no page images.');
  const names = new Set<string>();
  const sorted = files.map(f => {
    const base = f.name.split('/').at(-1)!;
    if (!/\.(jpe?g|png|webp|avif)$/i.test(base)) throw new IngestionError('unsupported_image', `Unsupported file in archive: ${base}. Use JPG, PNG, WEBP or AVIF images only.`);
    const key = base.toLocaleLowerCase();
    if (names.has(key)) throw new IngestionError('duplicate_page', `Duplicate page filename: ${base}.`);
    names.add(key);
    const stem = base.replace(/\.[^.]+$/, '');
    const nums = stem.match(/\d+/g);
    if (!nums?.length) throw new IngestionError('ambiguous_order', `Cannot determine page order from ${base}; include page numbers in filenames.`);
    return { ...f, base, order: nums.at(-1)!, stem };
  }).sort((a, b) => naturalCompare(a.order, b.order) || naturalCompare(a.stem, b.stem));
  for (let i = 1; i < sorted.length; i++) {
    if (naturalCompare(sorted[i - 1].order, sorted[i].order) === 0) throw new IngestionError('ambiguous_order', `Page order is ambiguous between ${sorted[i - 1].base} and ${sorted[i].base}.`);
  }
  const hashes = new Set<string>();
  const pages: IngestPage[] = [];
  for (const file of sorted) {
    if (file.data.length === 0 || file.data.length > env.CHAPTER_IMAGE_MAX_BYTES) throw new IngestionError('image_too_large', `${file.base} is empty or exceeds the individual image size limit.`);
    let meta: Metadata;
    try { meta = await sharp(file.data, { failOn: 'error', limitInputPixels: 500_000_000 }).metadata(); }
    catch { throw new IngestionError('corrupt_image', `${file.base} is not a readable image.`); }
    if (!['jpeg', 'png', 'webp', 'avif'].includes(meta.format ?? '') || !meta.width || !meta.height) throw new IngestionError('unsupported_image', `${file.base} is not a supported image.`);
    const width = meta.width; const height = meta.height;
    if (width < env.CHAPTER_IMAGE_MIN_WIDTH || height < env.CHAPTER_IMAGE_MIN_HEIGHT) throw new IngestionError('dimensions_too_small', `${file.base} is smaller than the minimum ${env.CHAPTER_IMAGE_MIN_WIDTH}×${env.CHAPTER_IMAGE_MIN_HEIGHT} pixels.`);
    if (width > env.CHAPTER_IMAGE_MAX_WIDTH || height > env.CHAPTER_IMAGE_MAX_HEIGHT) throw new IngestionError('dimensions_too_large', `${file.base} exceeds the maximum ${env.CHAPTER_IMAGE_MAX_WIDTH}×${env.CHAPTER_IMAGE_MAX_HEIGHT} pixels.`);
    const hash = createHash('sha256').update(file.data).digest('hex');
    if (hashes.has(hash)) throw new IngestionError('duplicate_page', `${file.base} duplicates another page image.`);
    hashes.add(hash);
    // Decode and re-encode lossless to strip metadata and normalize orientation without reducing quality.
    const output = await sharp(file.data, { failOn: 'error', limitInputPixels: 500_000_000 }).rotate().png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer();
    const normalizedMeta = await sharp(output).metadata();
    pages.push({ filename: file.name, bytes: output, width: normalizedMeta.width!, height: normalizedMeta.height!, hash });
  }
  return pages;
}
