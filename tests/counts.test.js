import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUZZLES } from '../src/puzzles.data.js';
import { GAMES } from '../src/games.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const num = (s) => Number(s.replace(/,/g, ''));
// user-facing text that states counts: page description and social tags, share-image source, README
const FILES = ['src/index.html', 'tools/og.html', 'README.md'];

test('counts in user-facing text match the data', () => {
  const found = { puzzles: 0, games: 0 };
  for (const f of FILES) {
    const text = read(f);
    for (const m of text.matchAll(/(\d[\d,]*) (?:puzzles|engine-verified positions)/g)) {
      found.puzzles++;
      assert.equal(num(m[1]), PUZZLES.length, `${f}: "${m[0]}" but the data has ${PUZZLES.length} puzzles`);
    }
    for (const m of text.matchAll(/(\d[\d,]*) famous games/g)) {
      found.games++;
      assert.equal(num(m[1]), GAMES.length, `${f}: "${m[0]}" but the data has ${GAMES.length} games`);
    }
  }
  assert.ok(found.puzzles >= 5 && found.games >= 4, 'expected counts in the description, social tags, share image and README');
});
