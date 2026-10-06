/** Helpers for chapter archive file names. Client-safe. */

/** "Solo Leveling Chapter 12.zip", "ch_012.cbz", "045.zip" → 12 / 12 / 45; null when the name has no number. */
export function chapterFromName(name: string): number | null {
  const stem = name.replace(/\.(zip|cbz)$/i, '');
  const tagged = stem.match(/(?:chapter|chap|ch|episode|ep|#|화|話|第)[\s._-]*(\d+(?:\.\d+)?)/i);
  const value = tagged?.[1] ?? stem.match(/\d+(?:\.\d+)?/g)?.at(-1);
  return value === undefined ? null : Number(value);
}

/** Natural order: "2" before "10", case-insensitive, with a deterministic tie-break. */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
