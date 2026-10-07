import type { PageRaster, PixelBox } from './bubbles';

/**
 * Hand edits of a page's source image in the manual workflow: erasing a rectangle (watermarks, stray lettering)
 * and cutting a horizontal strip out of a tall webtoon page (ads, credits). Pure raster functions so they can be
 * tested without storage or a database.
 */

const dist = (d: Buffer, i: number, c: [number, number, number]) => Math.max(Math.abs(d[i] - c[0]), Math.abs(d[i + 1] - c[1]), Math.abs(d[i + 2] - c[2]));
const clip = (r: PageRaster, b: PixelBox): PixelBox => {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  return { x, y, w: Math.min(r.width, b.x + b.w) - x, h: Math.min(r.height, b.y + b.h) - y };
};

/** Most common colour inside `box` (16-level buckets, refined to their mean) and the share of pixels close to it. */
function dominant(r: PageRaster, box: PixelBox): { color: [number, number, number]; share: number } {
  const counts = new Map<number, number>();
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
    const i = (y * r.width + x) * 3, key = (r.data[i] >> 4) << 8 | (r.data[i + 1] >> 4) << 4 | r.data[i + 2] >> 4;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = 0, bestCount = 0;
  for (const [key, n] of counts) if (n > bestCount) { best = key; bestCount = n; }
  const centre: [number, number, number] = [((best >> 8) & 15) * 16 + 8, ((best >> 4) & 15) * 16 + 8, (best & 15) * 16 + 8];
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
    const i = (y * r.width + x) * 3;
    if (dist(r.data, i, centre) <= 24) { sr += r.data[i]; sg += r.data[i + 1]; sb += r.data[i + 2]; n++; }
  }
  return { color: n ? [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] : centre, share: n / Math.max(1, box.w * box.h) };
}

/**
 * Repaint the pixels of `mask` (laid over `win`) from the pixels around them, layer by layer from the outside in.
 * Returns false when nothing around the mask could be used (e.g. the mask covers the whole page).
 */
function fillMask(r: PageRaster, win: PixelBox, mask: Uint8Array): boolean {
  const { width: W, height: H, data } = r;
  const unknown = Uint8Array.from(mask);
  const isKnown = (px: number, py: number) => px < win.x || px >= win.x + win.w || py < win.y || py >= win.y + win.h || !unknown[(py - win.y) * win.w + px - win.x];
  let pending: number[] = [];
  mask.forEach((v, k) => { if (v) pending.push(k); });
  const total = pending.length;
  while (pending.length) {
    const filled: number[] = [], values: number[] = [], rest: number[] = [];
    for (const k of pending) {
      const px = win.x + k % win.w, py = win.y + Math.floor(k / win.w);
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const qx = px + dx, qy = py + dy;
        if ((!dx && !dy) || qx < 0 || qy < 0 || qx >= W || qy >= H || !isKnown(qx, qy)) continue;
        const weight = dx && dy ? 0.7 : 1, i = (qy * W + qx) * 3;
        sr += data[i] * weight; sg += data[i + 1] * weight; sb += data[i + 2] * weight; n += weight;
      }
      if (n) { filled.push(k); values.push(sr / n, sg / n, sb / n); } else rest.push(k);
    }
    if (!filled.length) break;
    filled.forEach((k, j) => {
      const i = ((win.y + Math.floor(k / win.w)) * W + win.x + k % win.w) * 3;
      data[i] = Math.round(values[j * 3]); data[i + 1] = Math.round(values[j * 3 + 1]); data[i + 2] = Math.round(values[j * 3 + 2]);
      unknown[k] = 0;
    });
    pending = rest;
  }
  return pending.length < total;
}

/**
 * Lettering on a flat background inside `box`: connected marks that differ from the background and stay within the
 * box (plus a small margin), grown by 3px for anti-aliasing. Lines that run out of that area — balloon outlines,
 * panel borders — are left alone. Returned over the margin-expanded window.
 */
function letteringMask(r: PageRaster, box: PixelBox, bg: [number, number, number]): { win: PixelBox; mask: Uint8Array } {
  const margin = Math.max(6, Math.round(r.width * 0.01));
  const win = clip(r, { x: box.x - margin, y: box.y - margin, w: box.w + margin * 2, h: box.h + margin * 2 });
  const { w, h } = win;
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dist(r.data, ((win.y + y) * r.width + win.x + x) * 3, bg) > 20) ink[y * w + x] = 1;
  const mask = new Uint8Array(w * h), seen = new Uint8Array(w * h), queue = new Int32Array(w * h);
  const touchesWindowEdge = (x: number, y: number) =>
    (x === 0 && win.x > 0) || (y === 0 && win.y > 0) || (x === w - 1 && win.x + w < r.width) || (y === h - 1 && win.y + h < r.height);
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    let head = 0, tail = 0, escapes = false, inBox = false;
    seen[start] = 1; queue[tail++] = start;
    while (head < tail) {
      const k = queue[head++], x = k % w, y = (k - x) / w;
      if (touchesWindowEdge(x, y)) escapes = true;
      if (win.x + x >= box.x && win.x + x < box.x + box.w && win.y + y >= box.y && win.y + y < box.y + box.h) inBox = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, n = ny * w + nx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && ink[n] && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
      }
    }
    if (escapes || !inBox) continue;
    for (let q = 0; q < tail; q++) mask[queue[q]] = 1;
  }
  const grown = Uint8Array.from(mask);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) grown[ny * w + nx] = 1;
    }
  }
  return { win, mask: grown };
}

/**
 * Erase what is inside `box`. On a flat background (balloon interiors, gutters, caption boxes) only the lettering is
 * repainted, so outlines crossing the box survive and the result is exact ('clean'). Over detailed artwork the whole
 * box is filled from its edges and softened ('smudged'): a blur, not a reconstruction of the art.
 */
export function eraseArea(r: PageRaster, box: PixelBox): 'clean' | 'smudged' | 'unchanged' {
  const b = clip(r, box);
  if (b.w <= 0 || b.h <= 0) return 'unchanged';
  const background = dominant(r, b);
  if (background.share >= 0.6) {
    const { win, mask } = letteringMask(r, b, background.color);
    if (!mask.some(Boolean)) return 'unchanged';
    // Painting with the background colour itself; growing from the neighbours would carry the lettering's soft halo in.
    mask.forEach((v, k) => { if (v) r.data.set(background.color, ((win.y + Math.floor(k / win.w)) * r.width + win.x + k % win.w) * 3); });
    return 'clean';
  }
  if (!fillMask(r, b, new Uint8Array(b.w * b.h).fill(1))) return 'unchanged';
  // Onion peeling leaves streaks where layers meet; a few box-blur passes inside the box soften them.
  const { width: W, height: H, data } = r;
  for (let pass = 0; pass < 3; pass++) {
    const copy = Buffer.from(data.subarray(b.y * W * 3, (b.y + b.h) * W * 3));
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const qx = x + dx, qy = y + dy;
        if (qx < 0 || qx >= W || qy < 0 || qy >= H) continue;
        const inside = qy >= b.y && qy < b.y + b.h, i = (qy * W + qx) * 3 - (inside ? b.y * W * 3 : 0), src = inside ? copy : data;
        sr += src[i]; sg += src[i + 1]; sb += src[i + 2]; n++;
      }
      const i = (y * W + x) * 3;
      data[i] = Math.round(sr / n); data[i + 1] = Math.round(sg / n); data[i + 2] = Math.round(sb / n);
    }
  }
  return 'smudged';
}

/** A copy of the page without rows [top, bottom). */
export function cutRows(r: PageRaster, top: number, bottom: number): PageRaster {
  const stride = r.width * 3;
  return { width: r.width, height: r.height - (bottom - top), data: Buffer.concat([r.data.subarray(0, top * stride), r.data.subarray(bottom * stride)]) };
}

/**
 * Where a region (page fractions) lands after rows [top, bottom) of a page `height` pixels tall are cut out.
 * Regions inside the strip disappear (null); regions crossing it are clipped to what is left.
 */
export function regionAfterCut(region: { y: number; h: number }, height: number, top: number, bottom: number): { y: number; h: number } | null {
  const removed = bottom - top, next = height - removed;
  const map = (v: number) => v <= top ? v : v <= bottom ? top : v - removed;
  const y0 = map(region.y * height), y1 = map((region.y + region.h) * height);
  if (y1 - y0 < 2) return null;
  return { y: Math.min(1, Math.max(0, y0 / next)), h: Math.min(1, (y1 - y0) / next) };
}
