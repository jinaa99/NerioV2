import 'server-only';
import sharp from 'sharp';

/**
 * Pixel-level speech balloon analysis. Vision models give rough text boxes; this module finds the real balloon
 * (or caption box) around each box so the original lettering can be erased cleanly and the translation laid out
 * inside the balloon's actual shape instead of an approximate rectangle.
 */

export type Rgb = [number, number, number];
export type PageRaster = { width: number; height: number; data: Buffer };
export type PixelBox = { x: number; y: number; w: number; h: number };
export type Balloon = {
  /** A closed balloon/caption was found; `rows` describe its interior. Otherwise the text sits on open artwork. */
  enclosed: boolean;
  /** Layout area in page pixels: the balloon interior, or the lettering area for free text. */
  box: PixelBox;
  /** Original lettering bounds in page pixels. */
  ink: PixelBox;
  /** Interior span per row of `box` ([left, right] page x, or -1 when the row is outside the balloon). */
  rows: Int32Array;
  /** Pixels to repaint when erasing the original lettering (page-sized offsets into `mask` within `maskBox`). */
  mask: Uint8Array;
  maskBox: PixelBox;
  fill: Rgb;
  inkColor: Rgb;
  /** Most of the surrounding background is flat colour (free text only). */
  flat: boolean;
};

export async function rasterize(image: Buffer): Promise<PageRaster> {
  const { data, info } = await sharp(image, { failOn: 'error', limitInputPixels: 2_000_000_000 }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

export async function encodeRaster(raster: PageRaster): Promise<Buffer> {
  return sharp(raster.data, { raw: { width: raster.width, height: raster.height, channels: 3 } }).png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer();
}

export function toPixels(box: { x: number; y: number; w: number; h: number }, width: number, height: number): PixelBox {
  const x = Math.max(0, Math.min(width - 1, Math.round(box.x * width)));
  const y = Math.max(0, Math.min(height - 1, Math.round(box.y * height)));
  return { x, y, w: Math.max(1, Math.min(width - x, Math.round(box.w * width))), h: Math.max(1, Math.min(height - y, Math.round(box.h * height))) };
}

const lum = (c: Rgb) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const dist = (d: Buffer, i: number, c: Rgb) => Math.max(Math.abs(d[i] - c[0]), Math.abs(d[i + 1] - c[1]), Math.abs(d[i + 2] - c[2]));

/** Dominant colour of a pixel set: the most populated 16-level bucket, refined to the mean of its members. */
function dominant(r: PageRaster, source: Iterable<number>): { color: Rgb; share: number } {
  const pixels = Array.from(source);
  const counts = new Map<number, number>(); let total = 0;
  for (const p of pixels) {
    const i = p * 3; const key = (r.data[i] >> 4) << 8 | (r.data[i + 1] >> 4) << 4 | r.data[i + 2] >> 4;
    counts.set(key, (counts.get(key) ?? 0) + 1); total++;
  }
  let best = 0, bestCount = 0;
  for (const [key, n] of counts) if (n > bestCount) { best = key; bestCount = n; }
  const centre: Rgb = [((best >> 8) & 15) * 16 + 8, ((best >> 4) & 15) * 16 + 8, (best & 15) * 16 + 8];
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (const p of pixels) {
    const i = p * 3;
    if (dist(r.data, i, centre) <= 16) { sr += r.data[i]; sg += r.data[i + 1]; sb += r.data[i + 2]; n++; }
  }
  return { color: n ? [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] : centre, share: total ? n / total : 0 };
}

function* boxPixels(r: PageRaster, b: PixelBox) {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) yield y * r.width + x;
}
function* ringPixels(r: PageRaster, b: PixelBox, t: number) {
  const x0 = Math.max(0, b.x - t), y0 = Math.max(0, b.y - t), x1 = Math.min(r.width, b.x + b.w + t), y1 = Math.min(r.height, b.y + b.h + t);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
    yield y * r.width + x;
  }
}

function contrastInk(fill: Rgb): Rgb { return lum(fill) > 140 ? [20, 20, 20] : [250, 250, 250]; }

/** Analyze the balloon around one OCR text box (page pixels). */
export function analyzeBalloon(r: PageRaster, text: PixelBox): Balloon {
  const { width: W, height: H, data } = r;
  const margin = Math.round(Math.max(text.w, text.h) * 1.1 + W * 0.04);
  const L = { x: Math.max(0, text.x - margin), y: Math.max(0, text.y - margin), w: 0, h: 0 };
  L.w = Math.min(W, text.x + text.w + margin) - L.x; L.h = Math.min(H, text.y + text.h + margin) - L.y;
  const bg = dominant(r, boxPixels(r, text)).color;
  const lw = L.w, lh = L.h;
  const queue = new Int32Array(lw * lh);
  const pageEdge = (lx: number, ly: number) => (L.x + lx === 0 || L.x + lx === W - 1 || L.y + ly === 0 || L.y + ly === H - 1);
  // Seeds must match the balloon colour closely; the flood itself tolerates gradients and anti-aliasing.
  const flood = (shrink: number) => {
    const state = new Uint8Array(lw * lh); // 1 = balloon background, 2 = outside, 3 = enclosed hole (lettering)
    let head = 0, tail = 0;
    const sx = text.x + Math.round(text.w * shrink), sy = text.y + Math.round(text.h * shrink);
    const ex = Math.max(sx + 1, text.x + text.w - Math.round(text.w * shrink)), ey = Math.max(sy + 1, text.y + text.h - Math.round(text.h * shrink));
    for (let y = sy; y < ey; y++) for (let x = sx; x < ex; x++) {
      const k = (y - L.y) * lw + x - L.x;
      if (!state[k] && dist(data, (y * W + x) * 3, bg) <= 14) { state[k] = 1; queue[tail++] = k; }
    }
    let leakedEdge = 0;
    while (head < tail) {
      const k = queue[head++]; const lx = k % lw, ly = (k - lx) / lw;
      if ((lx === 0 || ly === 0 || lx === lw - 1 || ly === lh - 1) && !pageEdge(lx, ly)) leakedEdge++;
      for (const n of [lx > 0 ? k - 1 : -1, lx < lw - 1 ? k + 1 : -1, ly > 0 ? k - lw : -1, ly < lh - 1 ? k + lw : -1]) {
        if (n < 0 || state[n]) continue;
        const nx = n % lw, ny = (n - nx) / lw;
        if (dist(data, ((L.y + ny) * W + L.x + nx) * 3, bg) <= 36) { state[n] = 1; queue[tail++] = n; }
      }
    }
    const enclosed = tail >= text.w * text.h * 0.25 && leakedEdge <= Math.max(4, (lw + lh) * 0.01);
    return { state, enclosed };
  };
  // A loose OCR box can poke out of the balloon; retry from its core before treating the text as free.
  let attempt = flood(0.1);
  if (!attempt.enclosed) { const core = flood(0.3); if (core.enclosed) attempt = core; }
  const { state, enclosed } = attempt;
  let head = 0, tail = 0;

  if (enclosed) {
    // Everything not reachable from the search border without crossing balloon background is lettering inside it.
    head = 0; tail = 0;
    for (let lx = 0; lx < lw; lx++) for (const ly of [0, lh - 1]) { const k = ly * lw + lx; if (!state[k]) { state[k] = 2; queue[tail++] = k; } }
    for (let ly = 0; ly < lh; ly++) for (const lx of [0, lw - 1]) { const k = ly * lw + lx; if (!state[k]) { state[k] = 2; queue[tail++] = k; } }
    while (head < tail) {
      const k = queue[head++]; const lx = k % lw, ly = (k - lx) / lw;
      for (const n of [lx > 0 ? k - 1 : -1, lx < lw - 1 ? k + 1 : -1, ly > 0 ? k - lw : -1, ly < lh - 1 ? k + lw : -1]) {
        if (n >= 0 && !state[n]) { state[n] = 2; queue[tail++] = n; }
      }
    }
    let minX = lw, minY = lh, maxX = -1, maxY = -1, iMinX = lw, iMinY = lh, iMaxX = -1, iMaxY = -1;
    const holes: number[] = [];
    for (let k = 0; k < state.length; k++) {
      if (!state[k]) state[k] = 3;
      if (state[k] === 2) continue;
      const lx = k % lw, ly = (k - lx) / lw;
      if (lx < minX) minX = lx; if (lx > maxX) maxX = lx; if (ly < minY) minY = ly; if (ly > maxY) maxY = ly;
      if (state[k] === 3) {
        holes.push((L.y + ly) * W + L.x + lx);
        if (lx < iMinX) iMinX = lx; if (lx > iMaxX) iMaxX = lx; if (ly < iMinY) iMinY = ly; if (ly > iMaxY) iMaxY = ly;
      }
    }
    const box = { x: L.x + minX, y: L.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    const rows = new Int32Array(box.h * 2).fill(-1);
    const mask = new Uint8Array(box.w * box.h);
    for (let y = 0; y < box.h; y++) {
      let left = -1, right = -1;
      for (let x = 0; x < box.w; x++) {
        if (state[(minY + y) * lw + minX + x] === 2) continue;
        mask[y * box.w + x] = 1;
        if (left < 0) left = x; right = x;
      }
      if (left >= 0) { rows[y * 2] = box.x + left; rows[y * 2 + 1] = box.x + right; }
    }
    // Lettering colour: the pixels furthest from the balloon fill.
    const sorted = holes.map(p => ({ p, d: dist(data, p * 3, bg) })).sort((a, b) => b.d - a.d).slice(0, Math.max(1, Math.floor(holes.length * 0.35)));
    const inkColor: Rgb = sorted.length && sorted[0].d > 60
      ? [0, 1, 2].map(c => Math.round(sorted.reduce((s, item) => s + data[item.p * 3 + c], 0) / sorted.length)) as Rgb
      : contrastInk(bg);
    const ink = iMaxX >= 0 ? { x: L.x + iMinX, y: L.y + iMinY, w: iMaxX - iMinX + 1, h: iMaxY - iMinY + 1 } : text;
    return { enclosed: true, box, ink, rows, mask, maskBox: box, fill: bg, inkColor: lum(inkColor) < 90 ? [20, 20, 20] : inkColor, flat: true };
  }

  // Free text on artwork or a panel gutter: refine the lettering bounds against the surrounding background.
  const ringBox = { x: Math.max(0, text.x - Math.round(text.w * 0.08)), y: Math.max(0, text.y - Math.round(text.h * 0.12)), w: 0, h: 0 };
  ringBox.w = Math.min(W, text.x + text.w + Math.round(text.w * 0.08)) - ringBox.x; ringBox.h = Math.min(H, text.y + text.h + Math.round(text.h * 0.12)) - ringBox.y;
  const ring = dominant(r, ringPixels(r, ringBox, Math.max(3, Math.round(Math.min(text.w, text.h) * 0.12))));
  const flat = ring.share > 0.7;
  let minX = W, minY = H, maxX = -1, maxY = -1; const inkPixels: number[] = [];
  for (const p of boxPixels(r, ringBox)) {
    if (dist(data, p * 3, ring.color) <= 70) continue;
    const x = p % W, y = (p - x) / W; inkPixels.push(p);
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const ink = flat && maxX >= 0 && inkPixels.length > 20 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : text;
  const pad = Math.round(Math.max(4, Math.min(ink.w, ink.h) * 0.12));
  const maskBox = { x: Math.max(0, ink.x - pad), y: Math.max(0, ink.y - pad), w: 0, h: 0 };
  maskBox.w = Math.min(W, ink.x + ink.w + pad) - maskBox.x; maskBox.h = Math.min(H, ink.y + ink.h + pad) - maskBox.y;
  const mask = new Uint8Array(maskBox.w * maskBox.h).fill(1);
  // Free text may grow a little sideways when the background around it is plain.
  const growX = flat ? Math.round(ink.w * 0.15) : 0;
  const box = { x: Math.max(0, ink.x - growX), y: ink.y, w: 0, h: ink.h };
  box.w = Math.min(W, ink.x + ink.w + growX) - box.x;
  const rows = new Int32Array(box.h * 2);
  for (let y = 0; y < box.h; y++) { rows[y * 2] = box.x; rows[y * 2 + 1] = box.x + box.w - 1; }
  let inkColor: Rgb = contrastInk(ring.color);
  if (inkPixels.length) {
    const far = inkPixels.map(p => ({ p, d: dist(data, p * 3, ring.color) })).sort((a, b) => b.d - a.d).slice(0, Math.max(1, Math.floor(inkPixels.length * 0.35)));
    inkColor = [0, 1, 2].map(c => Math.round(far.reduce((s, item) => s + data[item.p * 3 + c], 0) / far.length)) as Rgb;
  }
  return { enclosed: false, box, ink, rows, mask, maskBox, fill: ring.color, inkColor, flat };
}

/** True when the centre of `text` lies inside the interior of balloon `b` (both in page pixels). */
export function sameBalloon(b: Balloon, text: PixelBox): boolean {
  if (!b.enclosed) return false;
  const cx = Math.round(text.x + text.w / 2) - b.maskBox.x, cy = Math.round(text.y + text.h / 2) - b.maskBox.y;
  return cx >= 0 && cy >= 0 && cx < b.maskBox.w && cy < b.maskBox.h && b.mask[cy * b.maskBox.w + cx] === 1;
}

/** Paint the original lettering out with the balloon/background colour (in place). */
export function eraseLettering(r: PageRaster, balloons: Balloon[]) {
  for (const b of balloons) {
    const { x: bx, y: by, w: bw, h: bh } = b.maskBox;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (!b.mask[y * bw + x]) continue;
      const i = ((by + y) * r.width + bx + x) * 3;
      r.data[i] = b.fill[0]; r.data[i + 1] = b.fill[1]; r.data[i + 2] = b.fill[2];
    }
  }
}

/** Interior span shared by every row in [y0, y1] (page pixels), or null when any row is outside the balloon. */
export function spanBetween(b: Balloon, y0: number, y1: number): [number, number] | null {
  let left = -Infinity, right = Infinity;
  const from = Math.max(0, Math.floor(y0 - b.box.y)), to = Math.min(b.box.h - 1, Math.ceil(y1 - b.box.y));
  if (from > to) return null;
  for (let y = from; y <= to; y++) {
    const l = b.rows[y * 2], rr = b.rows[y * 2 + 1];
    if (l < 0) return null;
    if (l > left) left = l; if (rr < right) right = rr;
  }
  return right > left ? [left, right] : null;
}

/** Vertical centre of mass of the balloon interior, which keeps text out of the tail. */
export function balloonCentreY(b: Balloon): number {
  let sum = 0, weight = 0;
  for (let y = 0; y < b.box.h; y++) {
    const l = b.rows[y * 2]; if (l < 0) continue;
    const w = b.rows[y * 2 + 1] - l; sum += (b.box.y + y) * w * w; weight += w * w;
  }
  return weight ? sum / weight : b.box.y + b.box.h / 2;
}

export function balloonArea(b: Balloon): number {
  let area = 0;
  for (let y = 0; y < b.box.h; y++) if (b.rows[y * 2] >= 0) area += b.rows[y * 2 + 1] - b.rows[y * 2] + 1;
  return area;
}
