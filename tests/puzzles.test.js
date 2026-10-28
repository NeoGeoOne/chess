import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { PUZZLES } from '../src/puzzles.data.js';

test('bundled lichess puzzles: unique, valid FEN, every move legal, mate puzzles end in mate', () => {
  assert.ok(PUZZLES.length >= 1900, 'expected at least 1900 puzzles, got ' + PUZZLES.length);
  const ids = new Set();
  const bands = { easy: 0, medium: 0, hard: 0 };
  for (const [id, fen, moves, rating, themes] of PUZZLES) {
    assert.ok(!ids.has(id), 'duplicate id ' + id); ids.add(id);
    assert.equal(E.validateFEN(fen), null, id + ' fen');
    let st = E.fromFEN(fen);
    const mv = moves.split(' ');
    assert.ok(mv.length >= 2 && mv.length <= 9, id + ' length');
    for (const u of mv) { const m = E.moveFromUci(st, u); assert.ok(m, id + ' illegal ' + u); st = E.applyMove(st, m); }
    const mi = themes.split(' ').find(t => /^mateIn\d$/.test(t));
    if (mi) { assert.ok(E.isMate(st), id + ' should end in mate'); assert.equal(mv.length - 1, 2 * +mi.slice(6) - 1, id + ' mate length'); }
    assert.ok(rating >= 800 && rating < 2300, id + ' rating');
    bands[rating < 1200 ? 'easy' : rating < 1800 ? 'medium' : 'hard']++;
  }
  assert.ok(bands.easy >= 600 && bands.medium >= 800 && bands.hard >= 450, JSON.stringify(bands));
});

test('bundled puzzles: the nine themes are balanced on tag counts (a puzzle counts once per theme it carries)', () => {
  const THEMES = ['mateIn1', 'mateIn2', 'mateIn3', 'fork', 'pin', 'skewer', 'discoveredAttack', 'backRankMate', 'endgame'];
  const count = Object.fromEntries(THEMES.map(t => [t, 0]));
  for (const p of PUZZLES) for (const t of p[4].split(' ')) if (t in count) count[t]++;
  const vals = Object.values(count);
  assert.ok(Math.min(...vals) >= 0.9 * Math.max(...vals), 'theme tags out of balance: ' + JSON.stringify(count));
});
