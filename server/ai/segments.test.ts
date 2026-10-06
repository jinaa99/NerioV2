import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isUppercase, shouldTranslate, untranslated } from './segments';

test('dialogue with two or more words is translated', () => {
  assert.equal(shouldTranslate('I ASKED THE CITIZENS\nOUT ON THE STREET!', 'speech', 'en').translate, true);
  assert.equal(shouldTranslate('No, no!', 'speech', 'en').translate, true);
  assert.equal(shouldTranslate('Where are you going?', 'narration', 'en').translate, true);
  assert.equal(shouldTranslate('그게 무슨 소리야?', 'speech', 'ko').translate, true);
});

test('single words, pure sounds, sound effects and watermarks are left alone', () => {
  for (const text of ['Hnnn...', 'HFF', 'What?!', 'Ha ha ha!', 'Hmm hmm', 'UGH...', 'ㅋㅋㅋ']) assert.equal(shouldTranslate(text, 'speech', 'en').translate, false, text);
  assert.equal(shouldTranslate('BAM BAM', 'sfx', 'en').translate, false);
  assert.equal(shouldTranslate('YOU CAN READ THE CHAPTER ON EN-THUNDERSCANS.COM', 'other', 'en').translate, false);
});

test('case and leftover source script detection', () => {
  assert.equal(isUppercase('I ASKED THE CITIZENS!'), true);
  assert.equal(isUppercase('I asked the citizens!'), false);
  assert.equal(untranslated('I asked them', 'en', 'mn'), true);
  assert.equal(untranslated('Бид асуулаа! OK', 'en', 'mn'), false);
});
