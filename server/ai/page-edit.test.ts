import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutRows, eraseArea, regionAfterCut } from './page-edit';

const page = (width: number, height: number, color: (x: number, y: number) => [number, number, number]) => {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 3);
  return { width, height, data };
};
const at = (r: { width: number; data: Buffer }, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 3, (y * r.width + x) * 3 + 3)];

test('erasing on a flat background restores the background exactly', () => {
  const r = page(60, 60, (x, y) => x >= 20 && x < 40 && y >= 25 && y < 35 ? [0, 0, 0] : [255, 255, 255]);
  assert.equal(eraseArea(r, { x: 15, y: 20, w: 30, h: 20 }), 'clean');
  for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) assert.deepEqual(at(r, x, y), [255, 255, 255]);
});

test('erasing lettering in a balloon keeps the balloon outline that crosses the box', () => {
  // White page, a black outline along x = 10, lettering block in the middle; the box crosses the outline.
  const r = page(120, 120, (x, y) => x === 10 ? [0, 0, 0] : x >= 50 && x < 70 && y >= 55 && y < 65 ? [0, 0, 0] : [255, 255, 255]);
  assert.equal(eraseArea(r, { x: 5, y: 40, w: 80, h: 40 }), 'clean');
  assert.deepEqual(at(r, 10, 60), [0, 0, 0]);
  assert.deepEqual(at(r, 60, 60), [255, 255, 255]);
});

test('erasing blends between different surroundings without touching pixels outside the box', () => {
  const r = page(40, 40, (_x, y) => y < 20 ? [200, 0, 0] : [0, 0, 200]);
  r.data.set([9, 9, 9], (20 * 40 + 20) * 3);
  assert.equal(eraseArea(r, { x: 10, y: 15, w: 20, h: 10 }), 'smudged');
  assert.deepEqual(at(r, 5, 18), [200, 0, 0]);
  assert.deepEqual(at(r, 5, 22), [0, 0, 200]);
  const [red, , blue] = at(r, 20, 20);
  assert.ok(red > 9 && blue > 9, 'the dark pixel was filled from its surroundings');
});

test('erasing the whole page leaves it unchanged', () => {
  const r = page(10, 10, (x) => [x * 20, 0, 0]);
  const before = Buffer.from(r.data);
  assert.equal(eraseArea(r, { x: 0, y: 0, w: 10, h: 10 }), 'unchanged');
  assert.ok(r.data.equals(before));
});

test('cutting removes exactly the selected rows', () => {
  const r = page(4, 10, (_x, y) => [y, y, y]);
  const out = cutRows(r, 3, 7);
  assert.equal(out.height, 6);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(y => at(out, 0, y)[0]), [0, 1, 2, 7, 8, 9]);
});

const round = (v: { y: number; h: number } | null) => v && { y: Math.round(v.y * 1e6) / 1e6, h: Math.round(v.h * 1e6) / 1e6 };
test('regions follow the artwork when a strip is cut out', () => {
  // Page 1000px tall, rows 400–600 cut: 800px left.
  assert.deepEqual(round(regionAfterCut({ y: 0.1, h: 0.1 }, 1000, 400, 600)), { y: 0.125, h: 0.125 });
  assert.deepEqual(round(regionAfterCut({ y: 0.7, h: 0.1 }, 1000, 400, 600)), { y: 0.625, h: 0.125 });
  assert.equal(regionAfterCut({ y: 0.45, h: 0.1 }, 1000, 400, 600), null);
  assert.deepEqual(round(regionAfterCut({ y: 0.3, h: 0.2 }, 1000, 400, 600)), { y: 0.375, h: 0.125 });
});
