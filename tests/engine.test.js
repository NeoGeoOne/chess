import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { OPENINGS } from '../src/puzzles.js';

function perft(s, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of E.legalMoves(s)) { const u = E.make(s, m); n += perft(s, depth - 1); E.unmake(s, m, u); }
  return n;
}

test('perft from the start position matches the known node counts', () => {
  const s = E.init();
  assert.equal(perft(s, 1), 20);
  assert.equal(perft(s, 2), 400);
  assert.equal(perft(s, 3), 8902);
  assert.equal(perft(s, 4), 197281);
});

test('perft on Kiwipete (castling, en passant, promotions, checks)', () => {
  const s = E.fromFEN('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(perft(s, 1), 48);
  assert.equal(perft(s, 2), 2039);
  assert.equal(perft(s, 3), 97862);
});

test('perft position 3 (en passant edge cases)', () => {
  const s = E.fromFEN('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  assert.equal(perft(s, 1), 14);
  assert.equal(perft(s, 2), 191);
  assert.equal(perft(s, 3), 2812);
  assert.equal(perft(s, 4), 43238);
});

test('FEN round-trips and SAN of the Opera Game replays to mate', () => {
  const sans = ['e4','e5','Nf3','d6','d4','Bg4','dxe5','Bxf3','Qxf3','dxe5','Bc4','Nf6','Qb3','Qe7','Nc3','c6','Bg5','b5','Nxb5','cxb5','Bxb5+','Nbd7','O-O-O','Rd8','Rxd7','Rxd7','Rd1','Qe6','Bxd7+','Nxd7','Qb8+','Nxb8','Rd8#'];
  let s = E.init();
  for (const san of sans) {
    const m = E.moveFromSan(s, san);
    assert.ok(m, 'move not found: ' + san);
    assert.equal(E.sanFor(s, m), san);
    s = E.applyMove(s, m);
    assert.equal(E.toFEN(E.fromFEN(E.toFEN(s))), E.toFEN(s));
  }
  assert.ok(E.isMate(s));
  assert.deepEqual(E.status(s), { over: true, mate: true, winner: 'w' });
});

test('draw detection: stalemate, insufficient material, fifty moves', () => {
  assert.equal(E.status(E.fromFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).stale, true);
  assert.equal(E.status(E.fromFEN('8/8/8/8/8/4k3/8/4K2N w - - 0 1')).insufficient, true);
  assert.equal(E.status(E.fromFEN('b7/8/8/8/8/4k3/8/4K2B w - - 0 1')).insufficient, true); // a8 + h1: both light squares
  assert.equal(E.status(E.fromFEN('8/8/8/8/8/2b1k3/8/4K2B w - - 0 1')).insufficient, undefined); // c3 (dark) + h1 (light)
  assert.equal(E.status(E.fromFEN('8/8/8/8/8/4k3/8/R3K3 w - - 100 1')).fifty, true);
});

test('every opening line is legal SAN from the start position', () => {
  for (const o of OPENINGS) {
    let st = E.init();
    for (const san of o.moves) { const m = E.moveFromSan(st, san); assert.ok(m, o.name + ' ' + san); st = E.applyMove(st, m); }
  }
});

test('PGN parser strips headers, comments, variations and results', () => {
  const pgn = '[Event "x"]\n[Result "1-0"]\n\n1. e4 {best} e5 2. Nf3 (2. Nc3 Nf6) 2... Nc6 $1 3. Bb5 a6 1-0';
  assert.deepEqual(E.parsePGN(pgn), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
});

test('validateFEN accepts legal positions and names what is wrong with malformed ones', () => {
  assert.equal(E.validateFEN(E.START), null);
  assert.equal(E.validateFEN('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'), null);
  assert.equal(E.validateFEN('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3'), null); // legal e.p. square
  assert.equal(E.validateFEN('4k3/8/8/8/8/8/8/4K2R w K - 0 1'), null); // rights with king + rook in place
  const bad = {
    'X7/8/8/8/8/8/8/k6K w - - 0 1': /invalid character/,
    '8/8/8/8/8/8/8/8 w - - 0 1': /exactly one king/,
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNRR w KQkq - 0 1': /8 squares/,
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1': /side to move/,
    'k7/8/8/8/8/8/8/K6P w - - 0 1': /back rank/,
    '4k3/8/8/8/8/8/8/4K3 w K - 0 1': /castling rights/,
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e9 0 1': /en-passant/,
    '4k3/8/8/8/8/8/8/q3K3 b - - 0 1': /not to move is in check/,
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR': /2 to 6 fields/,
  };
  for (const [fen, re] of Object.entries(bad)) { const r = E.validateFEN(fen); assert.ok(r && re.test(r), fen + ' → ' + r); }
  // every position that validates must also evaluate without throwing
  for (const fen of [E.START, '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', '4k3/8/8/8/8/8/8/4K2R w K - 0 1']) assert.equal(typeof E.searchEval(E.fromFEN(fen), 1), 'number');
});

test('bestMove finds mate in one and the eval reports it from white POV', () => {
  const s = E.fromFEN('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
  const r = E.bestMove(s, { maxDepth: 2 });
  assert.equal(E.alg(r.move.f) + E.alg(r.move.t), 'a1a8');
  assert.ok(E.searchEval(s, 2) > 9000);
});

test('basic endgames are converted instead of shuffled: KQ vs K and KR vs K end in mate without a threefold', () => {
  for (const fen of ['8/8/8/4k3/8/8/8/4K2Q w - - 0 1', '8/8/8/4k3/8/8/8/R3K3 w - - 0 1']) {
    const s = E.fromFEN(fen); const reps = {}; let mated = false;
    for (let ply = 0; ply < 120 && !mated; ply++) {
      const legal = E.legalMoves(s); if (!legal.length) { mated = E.inCheck(s); break; }
      const r = E.bestMove(s, { maxDepth: 6, timeMs: 60, history: reps }); E.make(s, r.move);
      const k = E.repKey(s); reps[k] = (reps[k] || 0) + 1; assert.ok(reps[k] < 3, 'threefold repetition from ' + fen);
    }
    assert.ok(mated, 'no mate within 60 moves from ' + fen);
  }
});

test('a move into a position the game has already seen scores as a draw, so the winning side avoids it', () => {
  const s = E.fromFEN('8/8/8/4k3/8/8/8/4K2Q w - - 0 1');
  const first = E.bestMove(s, { maxDepth: 4 }).move;
  const second = E.bestMove(s, { maxDepth: 4, history: { [E.repKey(E.applyMove(s, first))]: 2 } }).move;
  assert.notEqual(E.alg(second.f) + E.alg(second.t), E.alg(first.f) + E.alg(first.t));
});

test('the time budget is respected and iterative deepening reports the depth it completed', () => {
  const s = E.fromFEN('r2q1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2Q1RK1 w - - 0 10');
  const t = performance.now(); const r = E.bestMove(s, { maxDepth: 12, timeMs: 300 }); const dt = performance.now() - t;
  assert.ok(dt < 1500, 'search took ' + dt.toFixed(0) + ' ms for a 300 ms budget'); // generous: only a runaway search should fail this
  assert.ok(r.move && r.depth >= 2, 'depth ' + r.depth);
});

test('a depth-3 search (level 6) finds a mate in two', () => {
  const r = E.bestMove(E.fromFEN('r2qkb1r/pp2nppp/3p4/2pNN1B1/2BnP3/3P4/PPP2PPP/R2bK2R w KQkq - 1 0'), { maxDepth: 3 }); // level 6's depth, without its wall-clock budget
  assert.equal(E.alg(r.move.f) + E.alg(r.move.t), 'd5f6');
});
