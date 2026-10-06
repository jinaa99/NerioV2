import 'server-only';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import sharp, { type Metadata } from 'sharp';
import { serverEnv } from './env';

export type IngestPage = { filename: string; bytes: Buffer; width: number; height: number; hash: string };
export class IngestionError extends Error { constructor(readonly code: string, message: string) { super(message); } }
/** Progress of one ZIP through validation → safe extraction → sorting → image validation/normalization. */
export type IngestProgress = { phase: 'validating' | 'extracting' | 'sorting' | 'processing_images'; done: number; total: number };
type OnProgress = (progress: IngestProgress) => void;

/** yauzl's own path validation (absolute paths, "..", backslashes) surfaces as these messages. */
const UNSAFE_PATH_ERROR = /relative path|absolute path|invalid characters/i;
const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
function safeName(name: string) {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || /%(?:2e|2f|5c)/i.test(name)) return false;
  let decoded = name;
  try { for (let i = 0; i < 3; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } } catch { return false; }
  return !decoded.split('/').some(part => part === '..' || part === '.' || part === '') && !decoded.includes('\\');
}
function readZip(data: Buffer, onProgress?: OnProgress): Promise<{ name: string; data: Buffer }[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(UNSAFE_PATH_ERROR.test(err?.message ?? '') ? new IngestionError('unsafe_path', 'The ZIP contains an unsafe file path.') : new IngestionError('invalid_zip', 'The uploaded file is not a valid ZIP archive.'));
      const files: { name: string; data: Buffer }[] = [];
      let expanded = 0;
      const fail = (e: Error) => { zip.close(); reject(e); };
      zip.on('error', error => fail(UNSAFE_PATH_ERROR.test(error.message)
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
        // Zip-bomb heuristic: page images barely compress, so a large entry expanding >1000× is not a real page.
        if (entry.uncompressedSize > 10 * 1024 * 1024 && entry.uncompressedSize > Math.max(1, entry.compressedSize) * 1000) return fail(new IngestionError('archive_too_large', 'The archive has a suspicious compression ratio and was rejected.'));
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return fail(new IngestionError('invalid_zip', 'A file in the ZIP could not be read.'));
          const chunks: Buffer[] = []; let size = 0;
          stream.on('data', chunk => { size += chunk.length; if (size > serverEnv().CHAPTER_IMAGE_MAX_BYTES) stream.destroy(new Error('size')); else chunks.push(Buffer.from(chunk)); });
          stream.on('error', () => fail(new IngestionError('invalid_zip', 'A file in the ZIP could not be read.')));
          stream.on('end', () => { files.push({ name: entry.fileName, data: Buffer.concat(chunks) }); onProgress?.({ phase: 'extracting', done: files.length, total: zip.entryCount }); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolve(files));
      zip.readEntry();
    });
  });
}

/** Files browser extensions and OS archivers add next to the pages; they are skipped, not rejected. */
const IGNORED_ENTRY = /(^|\/)(__MACOSX|\.[^/]*)(\/|$)|(^|\/)(Thumbs\.db|desktop\.ini)$|\.(txt|json|xml|html?|nfo|url|md|csv|log|ini|db)$/i;
const IMAGE_ENTRY = /\.(jpe?g|jfif|png|webp|avif|gif|tiff?|bmp)$/i;

export async function inspectChapterZip(data: Buffer, originalName: string, claimedType: string, onProgress?: OnProgress): Promise<IngestPage[]> {
  const env = serverEnv();
  onProgress?.({ phase: 'validating', done: 0, total: 1 });
  if (data.length > env.CHAPTER_ZIP_MAX_BYTES) throw new IngestionError('zip_too_large', 'ZIP file exceeds the upload size limit.');
  if (!/\.(zip|cbz)$/i.test(originalName)) throw new IngestionError('unsupported_file', 'Choose a file with the .zip or .cbz extension.');
  if (claimedType && !['application/zip', 'application/x-zip-compressed', 'application/x-zip', 'application/vnd.comicbook+zip', 'application/x-cbz', 'application/octet-stream'].includes(claimedType)) throw new IngestionError('unsupported_file', 'The uploaded file type must be ZIP.');
  if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50) throw new IngestionError('invalid_zip', 'The uploaded file does not have a valid ZIP signature.');
  onProgress?.({ phase: 'validating', done: 1, total: 1 });
  const files = (await readZip(data, onProgress)).filter(f => !IGNORED_ENTRY.test(f.name));
  if (!files.length) throw new IngestionError('empty_archive', 'The ZIP archive contains no page images.');
  const unsupported = files.find(f => !IMAGE_ENTRY.test(f.name));
  if (unsupported) throw new IngestionError('unsupported_image', `Unsupported file in archive: ${unsupported.name.split('/').at(-1)}. Use JPG, PNG, WEBP, AVIF, GIF, TIFF or BMP images only.`);
  // Downloaders name pages "001.jpg", "Chapter 5 - 12.webp" or "p1_part2.png"; order by the full path with natural
  // number comparison so every numeric run (including folder names and split-part suffixes) is respected.
  const sorted = files.map(f => ({ ...f, base: f.name.split('/').at(-1)! }))
    .sort((a, b) => naturalCompare(a.name.replace(/\.[^.]+$/, ''), b.name.replace(/\.[^.]+$/, '')) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  onProgress?.({ phase: 'sorting', done: sorted.length, total: sorted.length });
  const pages: IngestPage[] = [];
  let processed = 0;
  for (const file of sorted) {
    onProgress?.({ phase: 'processing_images', done: processed++, total: sorted.length });
    if (file.data.length === 0) continue;
    if (file.data.length > env.CHAPTER_IMAGE_MAX_BYTES) throw new IngestionError('image_too_large', `${file.base} exceeds the individual image size limit.`);
    let meta: Metadata;
    try { meta = await sharp(file.data, { failOn: 'error', limitInputPixels: 2_000_000_000, animated: false }).metadata(); }
    catch {
      if (/\.bmp$/i.test(file.base)) throw new IngestionError('unsupported_image', `${file.base}: BMP pages are not supported by the image decoder. Convert them to PNG.`);
      throw new IngestionError('corrupt_image', `${file.base} is not a readable image.`);
    }
    if (!['jpeg', 'png', 'webp', 'avif', 'heif', 'gif', 'tiff'].includes(meta.format ?? '') || !meta.width || !meta.height) throw new IngestionError('unsupported_image', `${file.base} is not a supported image.`);
    // EXIF orientation 5–8 swaps width and height after rotate().
    const [width, height] = (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
    // Tiny spacer strips between webtoon panels are skipped instead of failing the chapter.
    if (width < env.CHAPTER_IMAGE_MIN_WIDTH || height < env.CHAPTER_IMAGE_MIN_HEIGHT) continue;
    if (width > env.CHAPTER_IMAGE_MAX_WIDTH || height > env.CHAPTER_IMAGE_MAX_HEIGHT) throw new IngestionError('dimensions_too_large', `${file.base} exceeds the maximum ${env.CHAPTER_IMAGE_MAX_WIDTH}×${env.CHAPTER_IMAGE_MAX_HEIGHT} pixels.`);
    const hash = createHash('sha256').update(file.data).digest('hex');
    // Decode and re-encode lossless to strip metadata, normalize orientation, colour space (CMYK, 16-bit, palette)
    // and transparency without reducing quality. Repeated pages (blank spacers) are kept: they are part of the layout.
    let output: Buffer;
    try {
      output = await sharp(file.data, { failOn: 'error', limitInputPixels: 2_000_000_000, animated: false })
        .rotate().toColourspace('srgb').flatten({ background: '#ffffff' }).png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer();
    } catch { throw new IngestionError('corrupt_image', `${file.base} could not be decoded.`); }
    pages.push({ filename: file.name, bytes: output, width, height, hash });
  }
  onProgress?.({ phase: 'processing_images', done: sorted.length, total: sorted.length });
  if (!pages.length) throw new IngestionError('empty_archive', 'The ZIP archive contains no page images large enough to read.');
  if (pages.length > MAX_PAGES) throw new IngestionError('too_many_files', `A chapter can have at most ${MAX_PAGES} pages.`);
  return pages;
}

const MAX_PAGES = 1000;
