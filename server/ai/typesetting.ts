import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, type Font } from 'opentype.js';
import sharp from 'sharp';
import { serverEnv } from '@/server/env';
import { DEFAULT_TYPESET_STYLE, type TypesetStyle } from '@/lib/typeset-style';
import { analyzeBalloon, balloonCentreY, encodeRaster, rasterize, spanBetween, toPixels, type Balloon, type Rgb } from './bubbles';
import { getTextRemovalProvider, type RemovalOutcome, type TextRemovalProvider } from './text-removal';

export type TextBox = {
  id: string; x: number; y: number; w: number; h: number; text: string;
  /** Source lettering was all caps; comic convention is to letter the translation the same way. */
  uppercase?: boolean;
  /** Line count of the original lettering, used to match the original type size. */
  sourceLines?: number;
  /** Per-region overrides of the page style. */
  style?: Partial<TypesetStyle>;
};
export type TypesetFlag = 'missing_translation' | 'missing_glyph' | 'overflow' | 'clipping' | 'outside_region' | 'overlapping_text' | 'unreadably_small_text';
export type TypesetResult = {
  image: Buffer; flags: Map<string, TypesetFlag[]>; pageFlags: TypesetFlag[]; fontSizes: Map<string, number>;
  /** Per lettered region: whether the original lettering was removed cleanly or needs a human look. */
  removal: Map<string, RemovalOutcome>;
};
export type TypesetFont = TypesetStyle['fontFamily'];
export type RenderOptions = {
  /** Shortcut for `style.fontFamily` (kept for the AI pipeline). */
  font?: TypesetFont;
  /** Page-wide base style; defaults come from the TYPESET_* environment. */
  style?: TypesetStyle;
  /** An externally inpainted copy of the page. Without it the original lettering is removed by `removal`. */
  cleaned?: Buffer | null;
  removal?: TextRemovalProvider;
};

/** Base lettering style from the environment (TYPESET_*) and the chosen font. */
export function envTypesetStyle(font: TypesetFont = 'shonen'): TypesetStyle {
  const env = serverEnv();
  return { ...DEFAULT_TYPESET_STYLE, fontFamily: font, minFontSize: env.TYPESET_MIN_FONT_SIZE, maxFontSize: env.TYPESET_MAX_FONT_SIZE,
    lineHeight: env.TYPESET_LINE_HEIGHT, padding: env.TYPESET_BUBBLE_PADDING, align: env.TYPESET_ALIGNMENT };
}

// Comic fonts ship Latin ligatures that also fire on look-alike Cyrillic glyphs (А+Х); letter every glyph as-is.
const shaping = (letterSpacing = 0) => ({ kerning: true, features: { liga: false, rlig: false }, ...(letterSpacing ? { letterSpacing } : {}) });
type Shaping = ReturnType<typeof shaping>;
const advance = (f: Font, text: string, size: number, opts: Shaping) => f.getAdvanceWidth(text, size, opts);

type Line = { text: string; left: number; right: number; top: number; width: number };
type Plan = { size: number; lineHeight: number; lines: Line[]; fits: boolean };
type Ctx = { f: Font; opts: Shaping; style: TypesetStyle };

const cachedFonts = new Map<TypesetFont, Font>();
async function font(name: TypesetFont) {
  const cached = cachedFonts.get(name);
  if (cached) return cached;
  const filename = name === 'shonen' ? 'ShonenNamikus-Regular.ttf' : 'NotoSans-Variable.ttf';
  const buffer = await readFile(path.join(process.cwd(), 'assets/fonts', filename));
  const array = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const loaded = parse(array);
  cachedFonts.set(name, loaded);
  return loaded;
}

/** Greedy word wrap into lines with individual widths; null when the words don't fit in `widths.length` lines. */
function wrapInto(words: string[], widths: number[], size: number, { f, opts }: Ctx): string[] | null {
  const lines: string[] = []; let line = ''; let i = 0;
  for (const word of words) {
    if (i >= widths.length) return null;
    const candidate = line ? `${line} ${word}` : word;
    if (advance(f, candidate, size, opts) <= widths[i]) { line = candidate; continue; }
    if (!line) return null;
    lines.push(line); i++; line = word;
    if (i >= widths.length || advance(f, word, size, opts) > widths[i]) return null;
  }
  if (line) lines.push(line);
  return lines;
}

/** Break words wider than `max` with hyphens; only used once the smallest readable size still overflows. */
function hyphenate(words: string[], max: number, size: number, { f, opts }: Ctx): string[] {
  return words.flatMap(word => {
    if (advance(f, word, size, opts) <= max) return [word];
    const parts: string[] = []; let part = '';
    for (const char of Array.from(word)) {
      if (part.length > 1 && advance(f, `${part}${char}-`, size, opts) > max) { parts.push(`${part}-`); part = char; }
      else part += char;
    }
    return [...parts, part];
  });
}

function blockTop(b: Balloon, blockHeight: number, padY: number, align: TypesetStyle['verticalAlign']) {
  const min = b.box.y + padY, max = b.box.y + b.box.h - padY - blockHeight;
  if (align === 'top') return min;
  if (align === 'bottom') return Math.max(min, max);
  return Math.min(Math.max(balloonCentreY(b) - blockHeight / 2, min), max);
}

function planAt(b: Balloon, words: string[], size: number, ctx: Ctx, padX: number): Plan | null {
  const lineHeight = size * ctx.style.lineHeight;
  const padY = Math.max(2, size * 0.2);
  const usable = b.box.h - padY * 2;
  const maxLines = Math.floor(usable / lineHeight);
  for (let n = 1; n <= Math.min(maxLines, words.length); n++) {
    const blockHeight = n * lineHeight;
    const top = blockTop(b, blockHeight, padY, ctx.style.verticalAlign);
    const spans: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      // Glyph ink sits roughly in the middle 80% of the line box.
      const span = spanBetween(b, top + i * lineHeight + lineHeight * 0.1, top + (i + 1) * lineHeight - lineHeight * 0.1);
      if (!span || span[1] - span[0] - padX * 2 <= size) { spans.length = 0; break; }
      spans.push([span[0] + padX, span[1] - padX]);
    }
    if (spans.length !== n) continue;
    const widths = spans.map(([l, r]) => r - l);
    let lines = wrapInto(words, widths, size, ctx);
    if (!lines) continue;
    // Balance the rag: shrink the measure while the text still fits in the same number of lines.
    for (let factor = 0.95; factor >= 0.5; factor -= 0.05) {
      const tighter = wrapInto(words, widths.map(w => w * factor), size, ctx);
      if (!tighter || tighter.length !== lines.length) break;
      lines = tighter;
    }
    const offset = ctx.style.verticalAlign === 'middle' ? (n - lines.length) * lineHeight / 2 : ctx.style.verticalAlign === 'bottom' ? (n - lines.length) * lineHeight : 0;
    return {
      size, lineHeight, fits: true,
      lines: lines.map((text, i) => ({ text, left: spans[i][0], right: spans[i][1], top: top + offset + i * lineHeight, width: advance(ctx.f, text, size, ctx.opts) })),
    };
  }
  return null;
}

/**
 * Fit text into the balloon: start at the preferred size (an explicit style size, else the original lettering size),
 * wrap, check the balloon shape, and shrink until it fits. An explicit size is kept as-is and flagged if it overflows.
 */
function plan(b: Balloon, text: string, ctx: Ctx, pageWidth: number, sourceLines: number | undefined): Plan {
  const { style } = ctx;
  const words = text.split(/\s+/).filter(Boolean);
  const minSize = style.fontSize ?? Math.max(style.minFontSize, Math.round(pageWidth * 0.022));
  const maxSize = style.fontSize ?? Math.max(style.maxFontSize, Math.round(pageWidth * 0.075));
  // Start at the original lettering size and shrink until the translation fits the balloon.
  const lines = Math.max(1, sourceLines ?? Math.round(b.ink.h / (pageWidth * 0.05)));
  const original = b.ink.h / lines / style.lineHeight;
  const start = Math.round(Math.min(maxSize, Math.max(minSize, original)));
  const padX = b.enclosed ? Math.max(3, b.box.w * style.padding * 0.8) : 0;
  for (let size = start; size >= minSize; size -= Math.max(1, Math.round(size * 0.04))) {
    const result = planAt(b, words, size, ctx, padX);
    if (result) return result;
  }
  const widest = Math.max(1, b.box.w - padX * 2);
  const broken = planAt(b, hyphenate(words, widest * 0.8, minSize, ctx), minSize, ctx, padX);
  if (broken) return broken;
  // Overflow: lay out at the minimum size around the centre so reviewers can see the problem.
  const lineHeight = minSize * style.lineHeight;
  const wrapped: string[] = []; let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && advance(ctx.f, candidate, minSize, ctx.opts) > widest) { wrapped.push(line); line = word; } else line = candidate;
  }
  if (line) wrapped.push(line);
  const top = balloonCentreY(b) - wrapped.length * lineHeight / 2;
  const left = b.box.x + padX, right = b.box.x + b.box.w - padX;
  return { size: minSize, lineHeight, fits: false, lines: wrapped.map((text, i) => ({ text, left, right, top: top + i * lineHeight, width: advance(ctx.f, text, minSize, ctx.opts) })) };
}

/** opentype.js's own toPathData rounds tiny fractions (1e-10) into NaN, which silently drops glyph contours. */
function pathData(p: { commands: { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[] }): string {
  const n = (v: number | undefined) => (Math.round((v ?? 0) * 100) / 100).toString();
  return p.commands.map(c => c.type === 'Z' ? 'Z' : c.type === 'Q' ? `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`
    : c.type === 'C' ? `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}` : `${c.type}${n(c.x)} ${n(c.y)}`).join('');
}

const hex = (c: Rgb) => `#${c.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
const ITALIC_SKEW = -12;

/**
 * Letter translations into a page. Works on a decoded copy: `master` is never modified. Only the regions being
 * lettered are repainted (original lettering removed) and the text is composited as small per-region overlays.
 */
export async function renderMongolianText(master: Buffer, boxes: TextBox[], options: RenderOptions = {}): Promise<TypesetResult> {
  const base = options.style ?? envTypesetStyle(options.font ?? 'shonen');
  const original = await rasterize(master);
  const { width: pageWidth, height: pageHeight } = original;
  const balloons = boxes.map(box => analyzeBalloon(original, toPixels(box, pageWidth, pageHeight)));
  const lettered = boxes.flatMap((box, i) => box.text.trim() ? [{ id: box.id, balloon: balloons[i] }] : []);
  let canvas = original;
  let removal: Map<string, RemovalOutcome>;
  if (options.cleaned) {
    canvas = await rasterize(options.cleaned);
    if (canvas.width !== pageWidth || canvas.height !== pageHeight) throw new Error('Image cleanup changed page dimensions.');
    removal = new Map(lettered.map(region => [region.id, 'clean']));
  } else {
    removal = (options.removal ?? getTextRemovalProvider()).remove(canvas, lettered);
  }

  const flags = new Map<string, TypesetFlag[]>(boxes.map(box => [box.id, []]));
  const pageFlags = new Set<TypesetFlag>();
  const fontSizes = new Map<string, number>();
  const blocks: { id: string; x0: number; y0: number; x1: number; y1: number }[] = [];
  const overlays: { input: Buffer; left: number; top: number }[] = [];
  const add = (id: string, flag: TypesetFlag) => { const list = flags.get(id)!; if (!list.includes(flag)) list.push(flag); pageFlags.add(flag); };

  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    const b = balloons[index];
    const style: TypesetStyle = box.style ? { ...base, ...box.style } : base;
    const f = await font(style.fontFamily);
    const ctx: Ctx = { f, opts: shaping(style.letterSpacing), style };
    if (box.x < 0 || box.y < 0 || box.x + box.w > 1.001 || box.y + box.h > 1.001) add(box.id, 'outside_region');
    const raw = box.text.trim().replace(/\s+/g, ' ');
    if (!raw) { add(box.id, 'missing_translation'); continue; }
    const text = box.uppercase ? raw.toLocaleUpperCase('mn') : raw;
    if ([...text].some(char => char.trim() && f.charToGlyph(char).index === 0)) add(box.id, 'missing_glyph');
    const layout = plan(b, text, ctx, pageWidth, box.sourceLines);
    fontSizes.set(box.id, layout.size);
    if (!layout.fits) add(box.id, 'overflow');
    if (layout.size < Math.max(12, pageWidth * 0.018)) add(box.id, 'unreadably_small_text');
    const capHeight = ((f.tables.os2 as { sCapHeight?: number } | undefined)?.sCapHeight || f.ascender * 0.7) / (f.unitsPerEm || 1000);
    const fill = style.color ?? hex(b.inkColor);
    const stroke = style.strokeWidth > 0 ? { color: style.strokeColor ?? hex(b.fill), width: layout.size * style.strokeWidth * 2 }
      : !b.enclosed && !b.flat ? { color: hex(b.fill), width: layout.size * 0.18 } : null;
    const shadow = style.shadow ? Math.max(1, layout.size * 0.06) : 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const fragments: string[] = [];
    for (const line of layout.lines) {
      const baseline = line.top + (layout.lineHeight + capHeight * layout.size) / 2 + style.offsetY;
      const x = (style.align === 'left' ? line.left : style.align === 'right' ? line.right - line.width : (line.left + line.right) / 2 - line.width / 2) + style.offsetX;
      const glyphs = f.getPath(line.text, x, baseline, layout.size, ctx.opts);
      const d = pathData(glyphs);
      const skew = style.italic ? ` transform="translate(${x.toFixed(1)} ${baseline.toFixed(1)}) skewX(${ITALIC_SKEW}) translate(${(-x).toFixed(1)} ${(-baseline).toFixed(1)})"` : '';
      const parts: string[] = [];
      if (shadow) parts.push(`<path d="${d}" fill="${style.shadowColor}" fill-opacity="0.6" transform="translate(${shadow.toFixed(1)} ${shadow.toFixed(1)})"/>`);
      if (stroke) parts.push(`<path d="${d}" fill="none" stroke="${stroke.color}" stroke-width="${stroke.width.toFixed(1)}" stroke-linejoin="round"/>`);
      parts.push(`<path data-region="${index}" d="${d}" fill="${fill}"${style.bold ? ` stroke="${fill}" stroke-width="${(layout.size * 0.06).toFixed(1)}" stroke-linejoin="round"` : ''}/>`);
      fragments.push(skew ? `<g${skew}>${parts.join('')}</g>` : parts.join(''));
      const bounds = glyphs.getBoundingBox();
      if (!Number.isFinite(bounds.x1)) continue;
      // Italic leans the tops of glyphs right by up to tan(12°) of their height above the baseline.
      const lean = style.italic ? Math.tan(-ITALIC_SKEW * Math.PI / 180) * Math.max(0, baseline - bounds.y1) : 0;
      x0 = Math.min(x0, bounds.x1); y0 = Math.min(y0, bounds.y1); x1 = Math.max(x1, bounds.x2 + lean); y1 = Math.max(y1, bounds.y2);
      const span = spanBetween(b, bounds.y1, bounds.y2);
      const tolerance = b.enclosed ? 1 : layout.size * 0.5;
      if (!span || bounds.x1 < span[0] - tolerance || bounds.x2 + lean > span[1] + tolerance) add(box.id, 'clipping');
    }
    if (!Number.isFinite(x0)) continue;
    blocks.push({ id: box.id, x0, y0, x1, y1 });
    // One small overlay per balloon: a single page-sized SVG breaks on very tall webtoon strips.
    const m = Math.ceil(layout.size * 0.2 + (stroke?.width ?? 0) + shadow) + 2;
    const left = Math.max(0, Math.floor(x0) - m), top = Math.max(0, Math.floor(y0) - m);
    const w = Math.min(pageWidth, Math.ceil(x1) + m) - left, h = Math.min(pageHeight, Math.ceil(y1) + m) - top;
    if (w > 0 && h > 0) overlays.push({ left, top, input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${left} ${top} ${w} ${h}">${fragments.join('')}</svg>`) });
  }
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const a = blocks[i], c = blocks[j];
    if (Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0) > 1 && Math.min(a.y1, c.y1) - Math.max(a.y0, c.y0) > 1) { add(a.id, 'overlapping_text'); add(c.id, 'overlapping_text'); }
  }
  const output = await encodeRaster(canvas);
  const image = overlays.length ? await sharp(output, { limitInputPixels: 2_000_000_000 }).composite(overlays).png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer() : output;
  return { image, flags, pageFlags: [...pageFlags], fontSizes, removal };
}
