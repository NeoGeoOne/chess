import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { GAMES } from '../src/games.js';

test('famous games: 50 unique entries, every move legal from the start, results consistent', () => {
  assert.equal(GAMES.length, 50);
  const ids = new Set();
  let prevYear = 0;
  for (const g of GAMES) {
    assert.ok(!ids.has(g.id), 'duplicate ' + g.id); ids.add(g.id);
    for (const k of ['white', 'black', 'event', 'why', 'moves']) assert.ok(typeof g[k] === 'string' && g[k].length > 2, g.id + ' ' + k);
    assert.ok(Number.isInteger(g.year) && g.year >= 1800 && g.year <= 2030, g.id + ' year');
    assert.ok(g.year >= prevYear, 'not chronological at ' + g.id); prevYear = g.year;
    assert.ok(['1-0', '0-1', '1/2-1/2'].includes(g.result), g.id + ' result');
    let st = E.init();
    const sans = g.moves.split(' ');
    assert.ok(sans.length >= 15 && sans.length <= 300, g.id + ' length ' + sans.length);
    for (const s of sans) { const m = E.moveFromSan(st, s); assert.ok(m, g.id + ': illegal or ambiguous "' + s + '"'); st = E.applyMove(st, m); }
    if (sans[sans.length - 1].endsWith('#')) { assert.ok(E.isMate(st), g.id + ' should end in mate'); assert.equal(g.result, st.t === 'w' ? '0-1' : '1-0', g.id + ' result vs mate'); }
    assert.ok(g.why.length <= 220, g.id + ' caption too long');
  }
});

test('every move cited in a caption is the move actually played at that number', () => {
  const norm = s => s.replace(/[+#!?]/g, '');
  for (const g of GAMES) {
    const moves = g.moves.split(' ');
    for (const c of g.why.matchAll(/(\d+)(\.{1,3})\s?([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O(?:-O)?)/g)) {
      const idx = (+c[1] - 1) * 2 + (c[2].length === 3 ? 1 : 0);
      assert.equal(norm(moves[idx] || ''), norm(c[3]), g.id + ': caption cites ' + c[0] + ' but the game has ' + moves[idx] + ' there');
    }
  }
});
