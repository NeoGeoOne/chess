// Runs the built-in engine off the main thread. Protocol: {id, cmd:'best', fen, opts} → {id, move, score};
// {id, cmd:'eval', fen, depth} → {id, cp}. Errors come back as {id, error}.
import * as E from './engine.js';

self.onmessage = (e) => {
  const d = e.data || {};
  try {
    const st = E.fromFEN(d.fen);
    if (d.cmd === 'best') {
      const r = E.bestMove(st, d.opts || {});
      self.postMessage({ id: d.id, move: r ? r.move : null, score: r ? r.score : 0 });
    } else if (d.cmd === 'eval') {
      const lg = E.legalMoves(st);
      const cp = !lg.length ? (E.inCheck(st) ? (st.t === 'w' ? -9999 : 9999) : 0) : E.searchEval(st, d.depth || 2);
      self.postMessage({ id: d.id, cp });
    } else self.postMessage({ id: d.id, error: 'unknown command' });
  } catch (err) {
    self.postMessage({ id: d.id, error: String((err && err.message) || err) });
  }
};
