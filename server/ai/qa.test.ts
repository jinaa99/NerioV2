import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPublication } from './qa';
import { retryAttempt } from './retry';

test('publication gate accepts only complete pages with clean QA', () => {
  assert.deepEqual(checkPublication({ requiredPages: 2, pageOutputs: ['page-1.png', 'page-2.png'], pageFlags: [], segmentFlags: [] }), {
    canAutoPublish: true,
    criticalFlags: [],
  });
});

test('publication gate blocks missing pages, overflow, failed OCR and translation QA', () => {
  for (const input of [
    { requiredPages: 2, pageOutputs: ['page-1.png'], pageFlags: [], segmentFlags: [] },
    { requiredPages: 1, pageOutputs: [null], pageFlags: [], segmentFlags: [] },
    { requiredPages: 1, pageOutputs: ['page.png'], pageFlags: ['overflow'], segmentFlags: [] },
    { requiredPages: 1, pageOutputs: ['page.png'], pageFlags: ['missing_glyph'], segmentFlags: [] },
    { requiredPages: 1, pageOutputs: ['page.png'], pageFlags: ['unreadably_small_text'], segmentFlags: [] },
    { requiredPages: 1, pageOutputs: ['page.png'], pageFlags: [], segmentFlags: ['low_ocr_confidence'] },
    { requiredPages: 1, pageOutputs: ['page.png'], pageFlags: [], segmentFlags: ['untranslated_text'] },
  ]) assert.equal(checkPublication(input).canAutoPublish, false);
});

test('publication gate blocks glossary and character-name violations', () => {
  assert.ok(checkPublication({ requiredPages: 1, pageOutputs: ['page.png'], pageFlags: [], segmentFlags: ['glossary_violation:hero'] }).criticalFlags.length);
  assert.ok(checkPublication({ requiredPages: 1, pageOutputs: ['page.png'], pageFlags: [], segmentFlags: ['character_name_inconsistent:Ana'] }).criticalFlags.length);
});

test('failed and cancelled jobs advance exactly one retry attempt; other states cannot retry', () => {
  assert.equal(retryAttempt('failed', 1), 2);
  assert.equal(retryAttempt('cancelled', 4), 5);
  assert.equal(retryAttempt('queued', 1), null);
  assert.equal(retryAttempt('running', 1), null);
  assert.equal(retryAttempt('failed', 0), null);
});
