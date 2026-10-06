/**
 * Pure layout rules for turning OCR words into dialogue regions and ordering regions the way a reader reads them.
 * No I/O, so the rules are unit-tested directly.
 */

export type OcrWord = { text: string; x0: number; y0: number; x1: number; y1: number; confidence: number };
export type WordRegion = { text: string; x0: number; y0: number; x1: number; y1: number; confidence: number; lines: number };
type Box = { x: number; y: number; w: number; h: number };

const LETTER = /[\p{L}\p{N}]/u;
/** Characters OCR engines read out of panel borders, speed lines and screentone. */
const NOISE = /^[\s|\\/_\-–—~=+*^`'".,:;!?()[\]{}<>«»#@$%&]+$/u;

function usable(word: OcrWord, minConfidence: number) {
  const text = word.text.trim();
  if (!text || NOISE.test(text) || !LETTER.test(text)) return false;
  if (word.x1 <= word.x0 || word.y1 <= word.y0) return false;
  // A lone letter needs to be read with high confidence; otherwise it's almost always a texture artefact.
  const letters = [...text].filter(char => LETTER.test(char)).length;
  if (letters === 1) return word.confidence >= Math.max(minConfidence, 80);
  // A clean word (letters with ordinary punctuation) is rarely produced by artwork, so it may be read with less
  // certainty; its low confidence stays visible in OCR review.
  const clean = /^[\p{L}\p{N}'’.,!?…\-]+$/u.test(text);
  return word.confidence >= (clean ? Math.min(minConfidence, 25) : minConfidence);
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Group words into lettering regions: words on one line join when the gap is about a word space, and lines join the
 * region above when they are stacked close together with a similar letter height (how balloon text is lettered).
 */
export function clusterWords(input: OcrWord[], minConfidence = 50): WordRegion[] {
  const words = input.filter(word => usable(word, minConfidence));
  const parent = words.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  const height = (w: OcrWord) => w.y1 - w.y0;
  for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) {
    const a = words[i], b = words[j];
    const ha = height(a), hb = height(b), h = Math.min(ha, hb), hMax = Math.max(ha, hb);
    if (hMax / h > 2.2) continue;
    const vOverlap = overlap(a.y0, a.y1, b.y0, b.y1);
    const hGap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
    // Same line: share most of their height and sit about a word space apart.
    if (vOverlap >= h * 0.5 && hGap <= hMax * 1.6) { union(i, j); continue; }
    // Stacked lines of one balloon: small vertical gap and horizontally overlapping (centred lettering drifts a bit).
    const vGap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
    const hOverlap = overlap(a.x0, a.x1, b.x0, b.x1);
    const centres = Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2);
    if (vGap >= -h * 0.3 && vGap <= hMax * 0.95 && (hOverlap > 0 || centres <= hMax * 2)) union(i, j);
  }
  const groups = new Map<number, OcrWord[]>();
  words.forEach((word, i) => { const root = find(i); groups.set(root, [...(groups.get(root) ?? []), word]); });
  const regions: WordRegion[] = [];
  for (const members of groups.values()) {
    // Lines inside the region: words whose vertical centre falls within the running line band.
    const sorted = [...members].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
    const lines: OcrWord[][] = [];
    for (const word of sorted) {
      const centre = (word.y0 + word.y1) / 2;
      const line = lines.find(candidate => { const y0 = Math.min(...candidate.map(w => w.y0)), y1 = Math.max(...candidate.map(w => w.y1)); return centre >= y0 && centre <= y1; });
      if (line) line.push(word); else lines.push([word]);
    }
    lines.sort((a, b) => Math.min(...a.map(w => w.y0)) - Math.min(...b.map(w => w.y0)));
    const text = lines.map(line => line.sort((a, b) => a.x0 - b.x0).map(w => w.text.trim()).join(' ')).join('\n');
    const letters = [...text].filter(char => LETTER.test(char)).length;
    if (letters < 2) continue;
    regions.push({
      text, lines: lines.length,
      x0: Math.min(...members.map(w => w.x0)), y0: Math.min(...members.map(w => w.y0)),
      x1: Math.max(...members.map(w => w.x1)), y1: Math.max(...members.map(w => w.y1)),
      confidence: members.reduce((sum, w) => sum + w.confidence, 0) / members.length / 100,
    });
  }
  return regions;
}

/** Japanese manga reads right to left; Korean/Chinese webtoons and Western comics left to right. */
export const readingDirection = (language: string): 'ltr' | 'rtl' => (/^ja/i.test(language) ? 'rtl' : 'ltr');

/**
 * Deterministic reading order: regions are grouped into rows (a region joins a row when it shares most of its height
 * with it), rows top to bottom, and regions within a row in the reading direction. Ties fall back to position.
 */
export function readingOrder<T extends Box>(regions: T[], direction: 'ltr' | 'rtl' = 'ltr'): T[] {
  const rows: { y0: number; y1: number; items: T[] }[] = [];
  for (const region of [...regions].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(r => overlap(r.y0, r.y1, region.y, region.y + region.h) >= Math.min(r.y1 - r.y0, region.h) * 0.5);
    if (row) { row.items.push(region); row.y0 = Math.min(row.y0, region.y); row.y1 = Math.max(row.y1, region.y + region.h); }
    else rows.push({ y0: region.y, y1: region.y + region.h, items: [region] });
  }
  rows.sort((a, b) => a.y0 - b.y0);
  return rows.flatMap(row => row.items.sort((a, b) => direction === 'rtl' ? (b.x + b.w) - (a.x + a.w) || a.y - b.y : a.x - b.x || a.y - b.y));
}

/** Tesseract traineddata names for the source languages the admin can pick. */
export function tesseractLanguage(language: string): string {
  const code = language.toLowerCase();
  if (code.startsWith('zh-hant') || code === 'zh-tw' || code === 'zh-hk') return 'chi_tra';
  const map: Record<string, string> = { en: 'eng', ko: 'kor', ja: 'jpn', zh: 'chi_sim', ru: 'rus', es: 'spa', id: 'ind', mn: 'mon', fr: 'fra', de: 'deu', vi: 'vie', th: 'tha' };
  return map[code.split('-')[0]] ?? 'eng';
}
