import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { DEFAULT_STATS, PREF_KEYS, sanitizeStats, sanitizeDaily, sanitizePrefs, pickPrefs, eloDelta, kFactor, localDay, dayIndex, prevDay, signed, seededOrder, puzBand, puzThemeLabel, sfParseInfo, pvToSan, uciSquares, pgnOf, pgnFromArchive } from '../src/util.js';

test('sanitizeStats: wrong types fall back, ranges are capped, arrays are filtered and truncated', () => {
  assert.deepEqual(sanitizeStats(null), DEFAULT_STATS);
  assert.deepEqual(sanitizeStats('x'), DEFAULT_STATS);
  const s = sanitizeStats({ rating: 1e9, puzzleRating: -5, w: 'a', d: 2.5, l: 3, puzzlesSolved: -1, ratingHist: [{ t: 'z' }, { t: 1, r: 1300 }, null], solved: ['ok', 42, 'x'.repeat(100)], games: [{ pgn: '<img src=x onerror=alert(1)>', opp: 'o'.repeat(80), res: '1–0', side: 'x', d: 'today', n: -1 }, null, 5] });
  assert.equal(sanitizeStats({ puzzlesSolved: 40 }).puzzlesRated, 40); // old save: seeded from solves
  assert.equal(s.rating, 1200); assert.equal(s.puzzleRating, 1000); assert.equal(s.w, 0); assert.equal(s.d, 0); assert.equal(s.l, 3); assert.equal(s.puzzlesSolved, 0);
  assert.deepEqual(s.ratingHist, [{ t: 1, r: 1300 }]);
  assert.deepEqual(s.solved, ['ok']);
  assert.equal(s.games.length, 1); assert.equal(s.games[0].opp.length, 40); assert.equal(s.games[0].side, 'w'); assert.equal(s.games[0].n, 0);
  assert.equal(sanitizeStats({ games: Array.from({ length: 80 }, () => ({ pgn: '' })) }).games.length, 50);
  assert.equal(sanitizeStats({ solved: Array.from({ length: 4500 }, (_, i) => 'id' + i) }).solved.length, 4000);
});

test('seededOrder: a deterministic permutation that is not the identity', () => {
  const a = seededOrder(850), b = seededOrder(850);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), Array.from({ length: 850 }, (_, i) => i));
  assert.ok(a.some((v, i) => v !== i));
  assert.deepEqual(seededOrder(0), []); assert.deepEqual(seededOrder(1), [0]);
  assert.notDeepEqual(seededOrder(850, 1), a);
});

test('sanitizeDaily accepts only ISO dates and non-negative integers', () => {
  assert.deepEqual(sanitizeDaily({ last: 'yesterday', streak: '7', best: -1 }), { last: '', done: '', streak: 0, best: 0 });
  assert.deepEqual(sanitizeDaily({ last: '2026-09-13', done: '2026-09-14', streak: 4, best: 9 }), { last: '2026-09-13', done: '2026-09-14', streak: 4, best: 9 });
  assert.deepEqual(sanitizeDaily([1, 2]), { last: '', done: '', streak: 0, best: 0 });
});

test('sanitizePrefs validates every field against the known lists and never trusts inherited keys', () => {
  const opts = { themes: ['vitrine', 'stone'], tcs: ['None', '10+5'], pieceSets: ['cburnett', 'merida'], defaultPieces: 'cburnett', gamesCount: 50 };
  const d = sanitizePrefs(undefined, opts);
  assert.deepEqual(d, { dark: true, sound: false, autoFlip: true, coords: true, boardTheme: 'vitrine', pieceSet: 'cburnett', level: 4, tc: '10+5', ghostIdx: 0 });
  const p = sanitizePrefs({ level: 2.5, boardTheme: '__proto__', pieceSet: 'staunty', tc: 'constructor', ghostIdx: 99, dark: false, sound: true, autoFlip: false }, opts);
  assert.equal(p.level, 4); assert.equal(p.boardTheme, 'vitrine'); assert.equal(p.pieceSet, 'cburnett'); assert.equal(p.tc, '10+5'); assert.equal(p.ghostIdx, 0);
  assert.equal(p.dark, false); assert.equal(p.sound, true); assert.equal(p.autoFlip, false);
  assert.equal(sanitizePrefs({ level: 'M' }, opts).level, 'M');
  assert.equal(sanitizePrefs({ level: 8, ghostIdx: 49, tc: 'None' }, opts).ghostIdx, 49);
  assert.equal(sanitizePrefs({ level: 99 }, { ...opts, defaultLevel: 6 }).level, 6);
  assert.deepEqual(Object.keys(pickPrefs({ junk: 'x'.repeat(1000), level: 7, sound: true, __proto__: { polluted: 1 } })).sort(), ['level', 'sound']);
  assert.ok(PREF_KEYS.includes('ghostIdx'));
});

test('kFactor: 40 for the first 30 rated results, then 20, 10 from 2400', () => {
  assert.equal(kFactor(0, 1200), 40); assert.equal(kFactor(29, 1200), 40); assert.equal(kFactor(30, 1200), 20); assert.equal(kFactor(100, 2400), 10); assert.equal(kFactor(5, 2500), 40);
});

test('localDay, dayIndex and prevDay follow the local calendar, including DST days', () => {
  const tz = process.env.TZ; process.env.TZ = 'Europe/Berlin'; // Node re-reads TZ at runtime; UTC would mask a regression
  try {
    const t = new Date(2026, 9, 25, 23, 30).getTime(); // 25 Oct 2026, 23:30 local: the 25-hour fall-back day
    assert.equal(localDay(t), '2026-10-25'); assert.equal(localDay(t + 3600000), '2026-10-26');
    assert.equal(dayIndex(t + 3600000) - dayIndex(t), 1);
    assert.equal(dayIndex(new Date(2026, 9, 25, 0, 0).getTime()), dayIndex(new Date(2026, 9, 25, 23, 59).getTime()));
    assert.equal(prevDay('2026-10-26'), '2026-10-25'); assert.equal(prevDay('2026-03-01'), '2026-02-28'); assert.equal(prevDay('2026-01-01'), '2025-12-31');
    assert.equal(localDay(new Date(2026, 2, 29, 0, 30).getTime()), '2026-03-29'); // spring-forward day
  } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
});

test('eloDelta and signed', () => {
  assert.equal(eloDelta(1000, 1000, 1), 16); assert.equal(eloDelta(1000, 1000, 0), -16);
  assert.equal(eloDelta(1000, 800, 1), 8); assert.equal(eloDelta(1000, 1679, 0), -1); assert.equal(eloDelta(2000, 800, 1), 0);
  assert.equal(signed(9), '+9'); assert.equal(signed(-12), '−12');
});

test('puzzle bands and theme labels', () => {
  assert.equal(puzBand(800), 'easy'); assert.equal(puzBand(1199), 'easy'); assert.equal(puzBand(1200), 'medium'); assert.equal(puzBand(2299), 'hard');
  assert.equal(puzThemeLabel({ themes: ['endgame', 'fork'] }), 'Fork');
  assert.equal(puzThemeLabel({ themes: ['crushing'] }), 'Tactics');
  assert.equal(puzThemeLabel({ themes: ['mateIn2', 'backRankMate'] }), 'Mate in 2');
});

test('sfParseInfo reads cp and mate scores, ignores bounds, secondary lines and non-info output', () => {
  assert.deepEqual(sfParseInfo('info depth 12 seldepth 18 multipv 1 score cp 77 nodes 1 nps 1 time 1 pv e1g1 f6e4 b1c3'), { depth: 12, cpStm: 77, mateStm: null, pv: ['e1g1', 'f6e4', 'b1c3'] });
  assert.deepEqual(sfParseInfo('info depth 5 score mate -2 pv e8d8'), { depth: 5, cpStm: -9998, mateStm: -2, pv: ['e8d8'] });
  assert.equal(sfParseInfo('info depth 5 score mate 1 pv a1a8').cpStm, 9999);
  assert.equal(sfParseInfo('info depth 3 score cp 10 lowerbound pv e2e4'), null);
  assert.equal(sfParseInfo('info depth 3 multipv 2 score cp 10 pv e2e4'), null);
  assert.equal(sfParseInfo('info string NNUE'), null);
  assert.equal(sfParseInfo('bestmove e2e4'), null);
  assert.equal(sfParseInfo(42), null);
});

test('pvToSan numbers the line correctly for either side to move and stops at an illegal move', () => {
  assert.equal(pvToSan(E, E.fromFEN('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'), ['e1g1', 'f6e4', 'b1c3', 'e4f6']), '4. O-O Nxe4 5. Nc3 Nf6');
  assert.equal(pvToSan(E, E.fromFEN('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'), ['e7e5', 'g1f3']), '1… e5 2. Nf3');
  assert.equal(pvToSan(E, E.init(), ['e2e4', 'e2e4']), '1. e4');
  assert.equal(pvToSan(E, E.init(), Array(20).fill('e2e4'), 1), '1. e4');
  assert.deepEqual(uciSquares(E, 'e2e4'), { f: 52, t: 36 }); assert.equal(uciSquares(E, 'x'), null); assert.equal(uciSquares(E, null), null);
});

test('pgnOf writes valid headers (quotes stripped) and a movetext that reparses', () => {
  const g = { hist: [], mode: 'bot', level: 'M', userSide: 'w', tc: [600, 5], over: { winner: 'b', reason: 'resignation' } };
  let st = E.init(); for (const s of ['e4', 'e5', 'Nf3']) { const m = E.moveFromSan(st, s); st = E.applyMove(st, m); g.hist.push({ san: s, fen: E.toFEN(st), uci: '' }); }
  const pgn = pgnOf(g, true, new Date(2026, 8, 13));
  const headers = pgn.split('\n\n')[0].split('\n');
  assert.ok(headers.includes('[Date "2026.09.13"]')); assert.ok(headers.includes('[White "You"]')); assert.ok(headers.includes('[Black "Stockfish 10"]'));
  assert.ok(headers.includes('[Result "0-1"]')); assert.ok(headers.includes('[TimeControl "600+5"]')); assert.ok(headers.includes('[Termination "resignation"]'));
  assert.equal(pgn.split('\n\n')[1], '1. e4 e5 2. Nf3 0-1\n');
  assert.deepEqual(E.parsePGN(pgn), ['e4', 'e5', 'Nf3']);
  assert.equal(pgnOf(g, false), '1. e4 e5 2. Nf3 0-1');
  assert.equal(pgnOf({ hist: [], mode: 'local', tc: null, over: null }, false), '*');
  const quoted = pgnOf({ ...g, mode: 'bot', level: 4, over: { winner: null, reason: 'say "hi" \\ there' } }, true, new Date(2026, 0, 2));
  assert.ok(quoted.includes('[Termination "say hi  there"]')); assert.ok(quoted.includes('[Result "1/2-1/2"]')); assert.ok(quoted.includes('[Black "Engine level 4"]'));
});

test('pgnFromArchive keeps new entries and rebuilds headers for old movetext-only rows', () => {
  const withHeaders = '[Event "x"]\n\n1. e4 *\n';
  assert.equal(pgnFromArchive({ pgn: withHeaders }), withHeaders);
  const old = pgnFromArchive({ d: '2026-09-13', opp: 'Engine · Level 4', res: '1–0', side: 'b', tc: '10+5', pgn: '1. e4 e5', n: 1 });
  assert.ok(old.includes('[Date "2026.09.13"]')); assert.ok(old.includes('[White "Engine · Level 4"]')); assert.ok(old.includes('[Black "You"]')); assert.ok(old.includes('[Result "1-0"]'));
  assert.ok(old.endsWith('1. e4 e5 1-0\n'));
  assert.ok(pgnFromArchive({ res: '½–½', side: 'w', opp: 'Pass & play', pgn: '' }).includes('[Result "1/2-1/2"]'));
});
