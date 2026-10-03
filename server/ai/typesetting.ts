import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, type Font } from 'opentype.js';
import sharp from 'sharp';
import { serverEnv } from '@/server/env';

export type TextBox = { id: string; x: number; y: number; w: number; h: number; text: string };
export type TypesetFlag = 'missing_translation' | 'missing_glyph' | 'overflow' | 'clipping' | 'outside_region' | 'overlapping_text' | 'unreadably_small_text';
export type TypesetResult = { image: Buffer; flags: Map<string, TypesetFlag[]>; pageFlags: TypesetFlag[]; fontSizes: Map<string, number> };
type Layout = { box: TextBox; x: number; y: number; width: number; height: number; fontSize: number; lines: string[]; top: number; pad: number; flags: TypesetFlag[] };
export type TypesetFont = 'shonen' | 'noto-sans';

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

function wrap(text: string, maxWidth: number, size: number, f: Font): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (f.getAdvanceWidth(candidate, size) <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      if (f.getAdvanceWidth(word, size) <= maxWidth) { line = word; continue; }
      let part = '';
      for (const char of Array.from(word)) {
        if (part && f.getAdvanceWidth(part + char, size) > maxWidth) { lines.push(part); part = char; }
        else part += char;
      }
      line = part;
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

function lineBounds(lines: string[], size: number, f: Font, lineHeight: number) {
  const paths = lines.map((line, index) => f.getPath(line, 0, size * 0.78 + index * lineHeight, size).getBoundingBox());
  const minX = Math.min(0, ...paths.map(bounds => bounds.x1));
  const maxX = Math.max(0, ...paths.map(bounds => bounds.x2));
  const minY = Math.min(0, ...paths.map(bounds => bounds.y1));
  const maxY = Math.max(0, ...paths.map(bounds => bounds.y2));
  return { paths, minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function layout(box: TextBox, pageWidth: number, pageHeight: number, f: Font, env: ReturnType<typeof serverEnv>): Layout {
  const raw = { x: box.x * pageWidth, y: box.y * pageHeight, w: box.w * pageWidth, h: box.h * pageHeight };
  const flags: TypesetFlag[] = [];
  if (raw.x < 0 || raw.y < 0 || raw.x + raw.w > pageWidth || raw.y + raw.h > pageHeight) flags.push('outside_region');
  const left = Math.max(0, raw.x), top = Math.max(0, raw.y);
  const right = Math.min(pageWidth, raw.x + raw.w), bottom = Math.min(pageHeight, raw.y + raw.h);
  const width = Math.max(1, right - left), height = Math.max(1, bottom - top);
  const pad = Math.max(3, Math.min(width, height) * env.TYPESET_BUBBLE_PADDING);
  const innerWidth = Math.max(1, width - pad * 2), innerHeight = Math.max(1, height - pad * 2);
  if (!box.text.trim()) flags.push('missing_translation');
  let fontSize = env.TYPESET_MIN_FONT_SIZE;
  let lines = wrap(box.text.trim(), innerWidth, fontSize, f);
  let lineHeight = fontSize * env.TYPESET_LINE_HEIGHT;
  let bounds = lineBounds(lines, fontSize, f, lineHeight);
  let textHeight = bounds.height;
  let fit = false;
  if (box.text.trim()) {
    for (let size = Math.max(env.TYPESET_MIN_FONT_SIZE, env.TYPESET_MAX_FONT_SIZE); size >= env.TYPESET_MIN_FONT_SIZE; size -= 1) {
      const candidate = wrap(box.text.trim(), innerWidth, size, f);
      const candidateLineHeight = size * env.TYPESET_LINE_HEIGHT;
      const candidateBounds = lineBounds(candidate, size, f, candidateLineHeight);
      if (candidateBounds.height <= innerHeight && candidateBounds.width <= innerWidth) {
        fontSize = size; lines = candidate; lineHeight = candidateLineHeight; bounds = candidateBounds; textHeight = candidateBounds.height; fit = true; break;
      }
    }
    if (!fit) flags.push('overflow');
    if (fontSize < 16) flags.push('unreadably_small_text');
    if (textHeight > innerHeight) flags.push('clipping');
    if ([...box.text].some(char => char.trim() && f.charToGlyph(char).index === 0)) flags.push('missing_glyph');
  }
  const topText = top + (height - textHeight) / 2 - bounds.minY;
  const x = env.TYPESET_ALIGNMENT === 'left' ? left + pad - bounds.minX : env.TYPESET_ALIGNMENT === 'right' ? right - pad - bounds.maxX : left + (width - bounds.width) / 2 - bounds.minX;
  return { box, x, y: topText, width: bounds.width, height: textHeight, fontSize, lines, top, pad, flags };
}

export async function renderMongolianText(image: Buffer, boxes: TextBox[], inpainted: boolean, fontName: TypesetFont = 'shonen'): Promise<TypesetResult> {
  const env = serverEnv(); const f = await font(fontName);
  const metadata = await sharp(image, { failOn: 'error' }).metadata();
  const pageWidth = metadata.width, pageHeight = metadata.height;
  if (!pageWidth || !pageHeight) throw new Error('Could not read image dimensions for typesetting.');
  const layouts = boxes.map(box => layout(box, pageWidth, pageHeight, f, env));
  const flags = new Map(layouts.map(item => [item.box.id, [...item.flags]]));
  const pageFlags = new Set<TypesetFlag>(layouts.flatMap(item => item.flags));
  const fontSizes = new Map(layouts.map(item => [item.box.id, item.fontSize]));
  for (let i = 0; i < layouts.length; i++) for (let j = i + 1; j < layouts.length; j++) {
    const a = layouts[i], b = layouts[j];
    const overlapW = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const overlapH = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    if (overlapW > 0 && overlapH > 0) {
      flags.get(a.box.id)!.push('overlapping_text'); flags.get(b.box.id)!.push('overlapping_text'); pageFlags.add('overlapping_text');
    }
  }
  const fragments: string[] = [];
  layouts.forEach((item, index) => {
    if (!item.box.text.trim()) return;
    const rawLeft = item.box.x * pageWidth, rawTop = item.box.y * pageHeight;
    const left = Math.max(0, rawLeft), top = Math.max(0, rawTop);
    const right = Math.min(pageWidth, rawLeft + item.box.w * pageWidth);
    const bottom = Math.min(pageHeight, rawTop + item.box.h * pageHeight);
    const width = Math.max(1, right - left);
    if (!inpainted) {
      const maskX = Math.max(0, Math.min(pageWidth, rawLeft - item.pad));
      const maskY = Math.max(0, Math.min(pageHeight, rawTop - item.pad));
      const maskRight = Math.max(maskX, Math.min(pageWidth, rawLeft + item.box.w * pageWidth + item.pad));
      const maskBottom = Math.max(maskY, Math.min(pageHeight, rawTop + item.box.h * pageHeight + item.pad));
      fragments.push(`<rect x="${maskX}" y="${maskY}" width="${maskRight - maskX}" height="${maskBottom - maskY}" rx="${Math.max(4, item.pad)}" fill="#fff" fill-opacity=".97"/>`);
    }
    const lineHeight = item.fontSize * env.TYPESET_LINE_HEIGHT;
    item.lines.forEach((line, lineIndex) => {
      const baselineOffset = item.fontSize * 0.78 + lineIndex * lineHeight;
      const relativeBounds = f.getPath(line, 0, baselineOffset, item.fontSize).getBoundingBox();
      const desiredInkLeft = env.TYPESET_ALIGNMENT === 'left' ? left + item.pad
        : env.TYPESET_ALIGNMENT === 'right' ? right - item.pad - (relativeBounds.x2 - relativeBounds.x1)
          : left + (width - (relativeBounds.x2 - relativeBounds.x1)) / 2;
      const baseline = item.y + baselineOffset;
      const glyphPath = f.getPath(line, desiredInkLeft - relativeBounds.x1, baseline, item.fontSize);
      const outline = glyphPath.toPathData(2);
      fragments.push(`<path data-region="${index}" d="${outline}" fill="#171717"/>`);
      const bounds = glyphPath.getBoundingBox();
      if (bounds.x1 < left + item.pad || bounds.x2 > right - item.pad || bounds.y1 < top + item.pad || bounds.y2 > bottom - item.pad) {
        if (!flags.get(item.box.id)!.includes('clipping')) flags.get(item.box.id)!.push('clipping');
        pageFlags.add('clipping');
      }
    });
  });
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}" height="${pageHeight}" viewBox="0 0 ${pageWidth} ${pageHeight}">${fragments.join('')}</svg>`);
  const output = await sharp(image, { failOn: 'error' }).composite([{ input: svg }]).png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer();
  return { image: output, flags, pageFlags: [...pageFlags], fontSizes };
}
