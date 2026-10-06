import type { RegionKind } from './providers';

/** Pure text rules for which detected lettering gets translated and how it is lettered back. */

const LETTER = /\p{L}/u;
const WATERMARK = /\b[\w-]+\.(com|net|org|io|me|xyz|site|online|top|to|cc|gg|app|mn)\b|https?:\/\/|\bscans?\b|\bscanlation\b|\bdiscord\b|\bpatreon\b|\bko-?fi\b/i;
/** Non-lexical sounds: hmm, hff, ugh, ahh, tsk, haha, eek, grr, zzz, ... */
const SOUND = /^(h+m+|m+h*m+|h+[fp]+h*|p+[fh]+t*|u+[gh]+h*|a+h+|a+r+g+h+|o+h+|o+o+f+|e+h+|e+e+k+|h+u+h+|h+e+h+|t+s+k+|g+r+|z+|s+h+|p+s+t+|w+h+e+w+|y+a+y+|w+o+w+|(h+[aeiou]+)+h*|(k+[aeiou]+)+|(ㅋ|ㅎ|ㅠ|ㅜ|흐|헉|윽|으)+|o+u*c+h+|a+w+|n+g+h*|e+r+m*|u+m+|uh+)$/i;

/** Scanlation credits, site addresses and similar watermarks; never part of the story. */
export const isWatermark = (text: string) => WATERMARK.test(text);

function words(text: string): string[] {
  return text.split(/[\s　]+/).map(token => token.replace(/[^\p{L}\p{N}'’-]/gu, '').toLowerCase()).filter(token => LETTER.test(token));
}

const noSpaces = (language: string) => /^(ja|zh)/i.test(language);

/**
 * Translate lettering with at least two real words. Single words, pure sounds ("hnnn", "hff", "ha ha ha"),
 * drawn sound effects and scanlation watermarks stay as they are in the artwork.
 */
export function shouldTranslate(text: string, kind: RegionKind, sourceLanguage: string): { translate: boolean; reason?: 'sfx' | 'watermark' | 'single_word' | 'sound' } {
  if (WATERMARK.test(text)) return { translate: false, reason: 'watermark' };
  if (kind === 'sfx') return { translate: false, reason: 'sfx' };
  if (noSpaces(sourceLanguage)) {
    const letters = [...text].filter(char => LETTER.test(char));
    if (letters.length < 3) return { translate: false, reason: 'single_word' };
    return new Set(letters).size <= 1 ? { translate: false, reason: 'sound' } : { translate: true };
  }
  const list = words(text);
  if (list.length < 2) return { translate: false, reason: list.length && SOUND.test(list[0]) ? 'sound' : 'single_word' };
  if (list.every(word => SOUND.test(word))) return { translate: false, reason: 'sound' };
  return { translate: true };
}

/** All-caps source lettering (ignoring scripts without case). */
export function isUppercase(text: string): boolean {
  const cased = [...text].filter(char => char.toLowerCase() !== char.toUpperCase());
  return cased.length >= 2 && cased.filter(char => char === char.toUpperCase()).length / cased.length >= 0.85;
}

export const sourceLineCount = (text: string) => Math.max(1, text.split(/\n+/).filter(line => line.trim()).length);

/** Untranslated source script left in the output (Hangul, kana/CJK, or Latin when the target uses Cyrillic). */
export function untranslated(output: string, sourceLanguage: string, targetLanguage: string): boolean {
  if (/[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ]/u.test(output) && !/^(ko|ja)/i.test(targetLanguage)) return true;
  if (/^mn/i.test(targetLanguage) && !/^mn/i.test(sourceLanguage)) {
    const latin = (output.match(/[A-Za-z]/g) ?? []).length, letters = (output.match(/\p{L}/gu) ?? []).length;
    return letters > 0 && latin / letters > 0.4;
  }
  return false;
}
