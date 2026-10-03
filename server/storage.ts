import 'server-only';

/**
 * Resolve a stored image reference (`series.cover_key`, `chapter_pages.source_key`) to a URL the
 * browser can load. References are either public `https://` URLs (entered by editors) or
 * object-storage keys. Object storage isn't wired up yet, so keys resolve to null and the UI
 * falls back to the generated cover gradient / an empty page slot.
 */
export function imageSrc(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith('https://')) return ref;
  return null;
}
