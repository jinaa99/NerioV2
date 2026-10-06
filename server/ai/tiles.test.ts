import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeTileRegions, planTiles } from './providers';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

test('tall strips are split into overlapping tiles that cover the whole page', () => {
  const tiles = planTiles(720, 15000);
  assert.ok(tiles.length > 5);
  assert.equal(tiles[0].top, 0);
  assert.equal(tiles.at(-1)!.top + tiles.at(-1)!.height, 15000);
  for (let i = 1; i < tiles.length; i++) assert.ok(tiles[i].top < tiles[i - 1].top + tiles[i - 1].height, 'tiles overlap');
  assert.deepEqual(planTiles(1290, 1800), [{ top: 0, height: 1800 }]);
});

test('regions cut by an inner tile edge are taken from the neighbouring tile only', () => {
  const tiles = [{ top: 0, height: 1000 }, { top: 600, height: 1000 }];
  const cut = { text: 'HELLO THERE', x: 0.2, y: 0.85, w: 0.5, h: 0.15, confidence: 0.9, kind: 'speech' as const };
  const whole = { ...cut, y: 0.25, h: 0.2 };
  const merged = mergeTileRegions(tiles, [[cut], [whole]], 1600);
  assert.equal(merged.length, 1);
  assert.ok(Math.abs(merged[0].y - (600 + 250) / 1600) < 1e-9);
});
