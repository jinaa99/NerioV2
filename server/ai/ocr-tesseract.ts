import 'server-only';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Worker } from 'tesseract.js';
import { serverEnv } from '@/server/env';
import { clusterWords, tesseractLanguage, type OcrWord } from './ocr-layout';
import { mergeTileRegions, planTiles, type OCRProvider, type OCRRegion } from './providers';

/**
 * Local, open-source OCR (Tesseract LSTM via tesseract.js/WASM). No API key and no per-page cost. Language data is
 * downloaded once into TESSERACT_CACHE_DIR, or read from TESSERACT_LANG_PATH for fully offline installs.
 */
type Pool = { size: number; idle: Worker[]; waiting: ((worker: Worker) => void)[] };
const store = globalThis as typeof globalThis & { __nerioTesseract?: Map<string, Pool> };
const pools: Map<string, Pool> = (store.__nerioTesseract ??= new Map<string, Pool>());

async function createTesseractWorker(language: string): Promise<Worker> {
  const env = serverEnv();
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  const cachePath = path.resolve(env.TESSERACT_CACHE_DIR);
  await mkdir(cachePath, { recursive: true });
  const worker = await createWorker(language, OEM.LSTM_ONLY, {
    cachePath, ...(env.TESSERACT_LANG_PATH ? { langPath: env.TESSERACT_LANG_PATH } : {}),
    errorHandler: (error: unknown) => console.error('[ocr] tesseract worker error:', error instanceof Error ? error.message : error),
  });
  // Sparse text: comic lettering is scattered across the page instead of flowing in columns.
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1', user_defined_dpi: '300' });
  return worker;
}

/** Borrow a worker for `language` (at most OCR_WORKERS per language per process). */
async function withWorker<T>(language: string, task: (worker: Worker) => Promise<T>): Promise<T> {
  let pool = pools.get(language);
  if (!pool) { pool = { size: 0, idle: [], waiting: [] }; pools.set(language, pool); }
  let worker = pool.idle.pop();
  if (!worker && pool.size < serverEnv().OCR_WORKERS) {
    pool.size++;
    try { worker = await createTesseractWorker(language); }
    catch (error) { pool.size--; throw new Error(`Could not start local OCR for "${language}": ${error instanceof Error ? error.message : 'unknown error'}`); }
  }
  if (!worker) worker = await new Promise<Worker>(resolve => pool.waiting.push(resolve));
  try { return await task(worker); }
  finally {
    const next = pool.waiting.shift();
    if (next) next(worker); else pool.idle.push(worker);
  }
}

/**
 * Comic pages confuse Tesseract's layout analysis: a balloon outline around a short line makes it treat the whole
 * balloon as a picture, and big dark artwork swallows nearby text. Binarize for one text polarity and keep only
 * glyph-sized connected components, so the engine sees plain dark letters on white. Returns null when the polarity
 * has too few glyph candidates to be worth a pass.
 */
export function glyphMask(gray: Uint8Array, width: number, height: number, polarity: 'dark' | 'light', threshold = 128): { pixels: Uint8Array; components: number } | null {
  const n = width * height;
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) ink[i] = polarity === 'dark' ? (gray[i] < threshold ? 1 : 0) : (gray[i] > 255 - threshold * 0.6 ? 1 : 0);
  // 8-connected component labelling with union-find.
  const parent = new Int32Array(n).fill(-1);
  const find = (i: number) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!ink[i]) continue;
    parent[i] = i;
    if (x > 0 && ink[i - 1]) union(i, i - 1);
    if (y > 0) {
      const up = i - width;
      if (ink[up]) union(i, up);
      if (x > 0 && ink[up - 1]) union(i, up - 1);
      if (x < width - 1 && ink[up + 1]) union(i, up + 1);
    }
  }
  const minX = new Map<number, number>(), maxX = new Map<number, number>(), minY = new Map<number, number>(), maxY = new Map<number, number>(), area = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (!ink[i]) continue;
    const r = find(i), x = i % width, y = (i - x) / width;
    if (!area.has(r)) { minX.set(r, x); maxX.set(r, x); minY.set(r, y); maxY.set(r, y); area.set(r, 0); }
    area.set(r, area.get(r)! + 1);
    if (x < minX.get(r)!) minX.set(r, x); if (x > maxX.get(r)!) maxX.set(r, x);
    if (y < minY.get(r)!) minY.set(r, y); if (y > maxY.get(r)!) maxY.set(r, y);
  }
  // Glyphs are small; outlines, panel borders and artwork are not.
  const maxH = Math.max(24, width * 0.09), maxW = Math.max(24, width * 0.16);
  const keep = new Set<number>();
  for (const [r, a] of area) {
    const w = maxX.get(r)! - minX.get(r)! + 1, h = maxY.get(r)! - minY.get(r)! + 1;
    if (h <= maxH && w <= maxW && a >= 4 && !(w > maxH && h <= 3)) keep.add(r);
  }
  if (keep.size < (polarity === 'dark' ? 1 : 8)) return null;
  const pixels = new Uint8Array(n).fill(255);
  for (let i = 0; i < n; i++) if (ink[i] && keep.has(find(i))) pixels[i] = 0;
  return { pixels, components: keep.size };
}

/** Stop every idle Tesseract worker (tests, graceful shutdown). */
export async function terminateOcrWorkers() {
  for (const pool of pools.values()) {
    const idle = pool.idle.splice(0);
    pool.size -= idle.length;
    await Promise.all(idle.map(worker => worker.terminate().catch(() => undefined)));
  }
}

export class TesseractOCRProvider implements OCRProvider {
  async recognize(image: Buffer, sourceLanguage: string): Promise<OCRRegion[]> {
    const env = serverEnv();
    const meta = await sharp(image, { limitInputPixels: 2_000_000_000 }).metadata();
    const width = meta.width ?? 0, height = meta.height ?? 0;
    if (!width || !height) throw new Error('Could not read page dimensions for OCR.');
    const language = tesseractLanguage(sourceLanguage);
    // Tall webtoon strips are read in overlapping slices; small lettering is upscaled because Tesseract reads
    // glyphs best at roughly 30px cap height.
    const tiles = planTiles(width, height);
    const scale = width < 1200 ? 2 : 1;
    const perTile: OCRRegion[][] = [];
    for (const tile of tiles) {
      const { data, info } = await sharp(image, { limitInputPixels: 2_000_000_000 }).extract({ left: 0, top: tile.top, width, height: tile.height })
        .resize({ width: width * scale, kernel: 'lanczos3' }).grayscale().normalise().raw().toBuffer({ resolveWithObject: true });
      const words: OcrWord[] = [];
      // Dark lettering (balloons, captions) and light lettering (white text on dark boxes) are read separately.
      for (const polarity of ['dark', 'light'] as const) {
        const mask = glyphMask(data, info.width, info.height, polarity);
        if (!mask) continue;
        const clean = await sharp(Buffer.from(mask.pixels.buffer), { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
        const result = await withWorker(language, (worker: Worker) => worker.recognize(clean, {}, { blocks: true, text: false }));
        for (const block of result.data.blocks ?? []) for (const paragraph of block.paragraphs) for (const line of paragraph.lines) for (const word of line.words) {
          words.push({ text: word.text, confidence: word.confidence, x0: word.bbox.x0 / scale, y0: word.bbox.y0 / scale, x1: word.bbox.x1 / scale, y1: word.bbox.y1 / scale });
        }
      }
      perTile.push(clusterWords(words, env.OCR_MIN_WORD_CONFIDENCE).map(region => {
        // Pad the tight word box a little so balloon detection seeds inside the lettering area.
        const pad = Math.min(8, (region.y1 - region.y0) * 0.15);
        const x0 = Math.max(0, region.x0 - pad), y0 = Math.max(0, region.y0 - pad);
        const x1 = Math.min(width, region.x1 + pad), y1 = Math.min(tile.height, region.y1 + pad);
        return { text: region.text, x: x0 / width, y: y0 / tile.height, w: (x1 - x0) / width, h: (y1 - y0) / tile.height,
          confidence: Math.min(1, Math.max(0, region.confidence)), kind: 'speech' as const, language: sourceLanguage };
      }));
    }
    return mergeTileRegions(tiles, perTile, height);
  }
}
