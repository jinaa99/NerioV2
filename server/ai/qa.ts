export type PublicationCheck = {
  requiredPages: number;
  pageOutputs: (string | null)[];
  pageFlags: string[];
  segmentFlags: string[];
};

const blockingFlags = new Set([
  'cleanup_failed', 'cleanup_unavailable', 'missing_translation', 'missing_glyph', 'overflow', 'clipping',
  'outside_region', 'overlapping_text', 'unreadably_small_text', 'delivery_storage_failed', 'empty_translation',
  'untranslated_text', 'malformed_output', 'ocr_critical_failure', 'low_ocr_confidence',
  'low_translation_confidence', 'mock_provider_output',
]);

export function checkPublication({ requiredPages, pageOutputs, pageFlags, segmentFlags }: PublicationCheck) {
  const criticalFlags = [...new Set([...pageFlags, ...segmentFlags])]
    .filter(flag => blockingFlags.has(flag) || flag.startsWith('glossary_violation:') || flag.startsWith('character_name_inconsistent:'));
  const canAutoPublish = requiredPages > 0 && pageOutputs.length === requiredPages && pageOutputs.every(Boolean)
    && criticalFlags.length === 0 && segmentFlags.length === 0;
  return { canAutoPublish, criticalFlags };
}
