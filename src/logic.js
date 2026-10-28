// App state and behaviour for the chess app.
// Pure helpers live in util.js (unit-tested); the template in template.html is compiled into render.gen.js.
import React from 'react';
import * as ENGINE from './engine.js';
import * as DATA from './puzzles.js';
import renderTpl from './render.gen.js';
import { play as playSound } from './sound.js';
import { GAMES } from './games.js';
import { DEFAULT_STATS, obj, sanitizeStats, sanitizeDaily, sanitizePrefs, pickPrefs, eloDelta, kFactor, localDay, dayIndex, prevDay, signed, seededOrder, PUZ_CATS, PUZ_BANDS, puzBand, puzThemeLabel, sfParseInfo, pvToSan, uciSquares, pgnOf, pgnFromArchive } from './util.js';

// Only sets whose license allows commercial use (lichess COPYING.md).
export const PIECE_SETS = [
  { id: 'cburnett', label: 'Classic' }, { id: 'merida', label: 'Merida' }, { id: 'chessnut', label: 'Chessnut' },
  { id: 'fantasy', label: 'Fantasy' }, { id: 'spatial', label: 'Spatial' }, { id: 'celtic', label: 'Celtic' },
  { id: 'kiwen-suwi', label: 'Kiwen-Suwi' }, { id: 'totoy', label: 'Totoy' }, { id: 'papercut', label: 'Papercut' }, { id: 'rhosgfx', label: 'RhosGFX' },
];
const DEFAULT_PIECES = 'cburnett';
const LS_PREFIX = 'chess_'; // namespaced storage keys
// hashed worker file name is injected by tools/build.mjs (esbuild define)
const ENGINE_WORKER_URL = typeof __ENGINE_WORKER__ !== 'undefined' ? __ENGINE_WORKER__ : 'engine/worker.js';
const PUZZLES_URL = typeof __PUZZLES_JSON__ !== 'undefined' ? __PUZZLES_JSON__ : 'puzzles.json'; // hashed name stamped by tools/build.mjs

export default class Component extends React.Component {
  state = {
    screen: 'play', dark: true, boardTheme: 'vitrine', pieceSet: DEFAULT_PIECES, coords: true, ready: false, bpx: 58, narrow: false,
    creditsOpen: false, resetArmed: false, anaError: '', sound: false, autoFlip: true, resignArmed: false, copied: false, importMsg: '', ghostIdx: 0, puzBand: 'Any',
    setup: { mode: 'bot', level: 4, side: 'random', tc: '10+5' },
    g: null, sel: -1, targets: [], promo: null, thinking: false, flip: false, lastDelta: null,
    puz: null, puzLoad: '', daily: { last: '', streak: 0 }, puzCat: 'Daily', puzShake: 'none',
    learn: { kind: 'opening', sel: 0, ply: 0 }, learnAuto: false,
    ana: { hist: [], ptr: 0, cp: 0, depth: 0, flip: false, busy: false, engine: '', pv: [], pvSan: '', best: null, mate: null },
    stats: { ...DEFAULT_STATS },
  };
  TC = { 'None': null, '1+0': [60, 0], '3+2': [180, 2], '5+0': [300, 0], '10+5': [600, 5], '30+0': [1800, 0] };
  THEMES = {
    vitrine: { l: '#34373e', d: '#23262c', wFg: '#ffffff', wTs: 'none', bFg: '#111214', bTs: 'none' },
    stone: { l: '#f2f0ea', d: '#cdc8bc', wFg: '#ffffff', wTs: '0 1px 2px rgba(0,0,0,.4)', bFg: '#2a2925', bTs: 'none' },
    tournament: { l: '#eee9d7', d: '#7d8f6f', wFg: '#ffffff', wTs: '0 1px 2px rgba(0,0,0,.42)', bFg: '#262a20', bTs: 'none' },
    walnut: { l: '#e4d3ae', d: '#8b5a2b', wFg: '#f7efdc', wTs: '0 1px 2px rgba(30,15,0,.5)', bFg: '#26160a', bTs: '0 1px 1px rgba(255,230,180,.2)' },
  };
  PL = {}; uid = 0; bd = {}; ewPending = new Map(); gameCache = new Map();
  pieceSrc(tp, set) { const w = tp === tp.toUpperCase(); const id = set || this.state.pieceSet; return 'pieces/' + (PIECE_SETS.some(x => x.id === id) ? id : DEFAULT_PIECES) + '/' + (w ? 'w' : 'b') + tp.toUpperCase() + '.svg'; }
  componentDidMount() {
    const E = ENGINE, D = DATA;
    this.E = E;
    this.prefsLoad();
    this.puzzles = []; // filled by loadPuzzles() once the app is up
    this.games = GAMES;
    this.openings = D.OPENINGS.map(o => {
      let st = E.init(); const steps = [{ fen: E.toFEN(st), san: '' }];
      for (const san of o.moves) { const m = E.moveFromSan(st, san); if (!m) return null; const s2 = E.applyMove(st, m); steps.push({ fen: E.toFEN(s2), san }); st = s2; }
      return { ...o, steps };
    }).filter(Boolean);
    this.ghostSet(0, false);
    this.syncPL('play', E.init().b, false);
    this.syncPL('learn', E.fromFEN(this.openings[0].steps[0].fen).b, false);
    this.anaSetHist([{ san: '', fen: E.START }], 0, false);
    this.setState({ ready: true }, () => this.loadPuzzles());
    this.onRs = () => { const w = window.innerWidth, narrow = w < 640; const avail = narrow ? w - 24 - 24 - 2 - 18 : w - 48; this.setState({ narrow, bpx: Math.max(32, Math.min(w > 1180 ? 72 : 60, Math.floor(avail / 8))) }); };
    window.addEventListener('resize', this.onRs); this.onRs();
    this.iv = setInterval(() => this.tick(), 250);
    this.ghostIv = setInterval(() => this.ghostTick(), 1600);
    this.onKey = (e) => { if (e.key === 'Escape') this.cancelSel(); };
    this.onCtx = (e) => { const el = e.target.closest && e.target.closest('[data-board]'); if (el) { e.preventDefault(); this.cancelSel(); } };
    window.addEventListener('keydown', this.onKey); window.addEventListener('contextmenu', this.onCtx);
  }
  componentWillUnmount() { window.removeEventListener('keydown', this.onKey); window.removeEventListener('contextmenu', this.onCtx); clearInterval(this.iv); clearInterval(this.ghostIv); clearInterval(this.learnIv); clearInterval(this.cpIv); clearInterval(this.statIv); clearTimeout(this.resetT); clearTimeout(this.shakeT); clearTimeout(this.resignT); clearTimeout(this.copyT); clearTimeout(this.flipT); window.removeEventListener('resize', this.onRs); this.sfDispose(); this.engineCancel(); }
  componentDidUpdate() { const n = this.state.g ? this.state.g.hist.length : -1; if (this.ml && n !== this.mlN) { this.mlN = n; this.ml.scrollTop = this.ml.scrollHeight; } }

  // ---------- piece layer ----------
  syncPL(key, board, animate) {
    const cur = this.PL[key];
    if (!animate || !cur) {
      this.PL[key] = { board: board.slice(), list: board.map((p, i) => p ? { id: key + (this.uid++), tp: p, sq: i, dead: false } : null).filter(Boolean) };
      return;
    }
    const old = cur.board, removed = [], added = [];
    for (let i = 0; i < 64; i++) if (old[i] !== board[i]) { if (old[i]) removed.push({ sq: i, p: old[i] }); if (board[i]) added.push({ sq: i, p: board[i] }); }
    if (removed.length + added.length > 10) { this.syncPL(key, board, false); return; }
    const isw = c => c === c.toUpperCase();
    // resolve every vacated square to its piece entry BEFORE anything moves, so a capturer
    // landing on the victim's square can never be mistaken for the victim
    const rem = removed.map(r => ({ ...r, e: cur.list.find(x => !x.dead && x.sq === r.sq) }));
    for (const a of added) {
      let ri = rem.findIndex(r => r.e && r.p === a.p);
      if (ri < 0) ri = rem.findIndex(r => r.e && isw(r.p) === isw(a.p) && r.p.toLowerCase() === 'p'); // promotion
      if (ri >= 0) { const r = rem.splice(ri, 1)[0]; r.e.sq = a.sq; r.e.tp = a.p; continue; }
      const slot = cur.list.find(x => x.dead); // reuse a dead slot: keeps list order stable for the renderer
      if (slot) { slot.tp = a.p; slot.sq = a.sq; slot.dead = false; slot.id = key + (this.uid++); }
      else cur.list.push({ id: key + (this.uid++), tp: a.p, sq: a.sq, dead: false });
    }
    for (const r of rem) if (r.e) r.e.dead = true;
    cur.board = board.slice();
  }
  pcFor(key, flip, dragColor) {
    const pl = this.PL[key]; if (!pl || !this.E) return [];
    const t = this.THEMES[this.state.boardTheme], bpx = this.state.bpx;
    const promo = key === 'play' ? this.state.promo : null;
    const instant = this.flipAt && Date.now() - this.flipAt < 80;
    return pl.list.map(pc => {
      const w = pc.tp === pc.tp.toUpperCase();
      let sq = pc.sq;
      if (promo && !pc.dead && sq === promo.from) sq = promo.to; // pawn waits on the promotion square while you choose
      const di = flip ? 63 - sq : sq;
      let x = (di & 7) * bpx, y = (di >> 3) * bpx, sc = 1, z = 1, flt = 'none';
      let tr = instant ? 'none' : 'transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s ease, filter .15s ease';
      if (this.state.boardTheme === 'vitrine') flt = 'drop-shadow(0 4px 4px rgba(0,0,0,.55))';
      const dragging = this.drag && this.drag.id === pc.id;
      if (dragging) { x = this.drag.x; y = this.drag.y; sc = 1.18; z = 20; tr = 'filter .15s ease'; flt = 'drop-shadow(0 10px 14px rgba(0,0,0,.35))'; }
      if (pc.dead) { sc = .3; z = 0; }
      const can = !pc.dead && !!dragColor && (w ? 'w' : 'b') === dragColor;
      return {
        src: this.pieceSrc(pc.tp), fg: w ? t.wFg : t.bFg, ts: w ? t.wTs : t.bTs,
        tf: 'translate(' + x + 'px,' + y + 'px) scale(' + sc + ')', op: pc.dead ? 0 : 1, tr, z, flt,
        pe: can ? 'auto' : 'none', cur: dragging ? 'grabbing' : can ? 'grab' : 'default',
        down: can ? (e) => this.pieceDown(key, pc.id, e) : undefined,
      };
    });
  }
  flipFor(key) { return key === 'play' ? this.state.flip : key === 'puz' ? (this.state.puz && this.state.puz.userSide === 'b') : this.state.ana.flip; }
  screenClick(key, sq) { if (key === 'play') this.clickPlay(sq); else if (key === 'puz') this.clickPuz(sq); else this.clickAna(sq); }
  rafFU() { if (this.rafP) return; this.rafP = requestAnimationFrame(() => { this.rafP = null; this.forceUpdate(); }); }
  pieceDown(key, id, e) {
    if (this.drag || this.dragArmed) return; // second finger / second button while a drag is live
    const pl = this.PL[key]; const pc = pl && pl.list.find(p => p.id === id); if (!pc || pc.dead) return;
    const el = this.bd[key]; if (!el) return;
    const rect = el.getBoundingClientRect();
    e.preventDefault();
    if (e.button === 2) { this.cancelSel(); return; }
    const wasSel = (key === 'play' ? this.state.sel : key === 'puz' ? (this.state.puz && this.state.puz.sel) : this.anaSel) === pc.sq;
    if (!wasSel) this.screenClick(key, pc.sq);
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    this.dragArmed = true;
    const mv = (ev) => {
      if (ev.pointerId !== pid) return;
      if (!this.drag && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 3) this.drag = { id, key, over: -1 };
      if (this.drag) {
        const bpx = this.state.bpx;
        this.drag.x = ev.clientX - rect.left - bpx / 2; this.drag.y = ev.clientY - rect.top - bpx / 2;
        const c = Math.floor((ev.clientX - rect.left) / bpx), r = Math.floor((ev.clientY - rect.top) / bpx);
        this.drag.over = (c >= 0 && c < 8 && r >= 0 && r < 8) ? (this.flipFor(key) ? 63 - (r * 8 + c) : r * 8 + c) : -1;
        this.rafFU();
      }
    };
    const teardown = () => { this.dragArmed = false; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', esc); };
    const cancel = (ev) => { if (ev.pointerId !== pid) return; teardown(); this.drag = null; this.cancelSel(); this.forceUpdate(); };
    const up = (ev) => {
      if (ev.pointerId !== pid) return;
      teardown();
      if (this.drag) {
        const bpx = this.state.bpx;
        const c = Math.floor((ev.clientX - rect.left) / bpx), r = Math.floor((ev.clientY - rect.top) / bpx);
        this.drag = null;
        if (c >= 0 && c < 8 && r >= 0 && r < 8) {
          const di = r * 8 + c, bi = this.flipFor(key) ? 63 - di : di;
          if (bi !== pc.sq) { this.dropping = true; this.screenClick(key, bi); this.dropping = false; } else if (wasSel) this.cancelSel();
        } else this.cancelSel(); // dropped outside the board: piece glides home, selection cleared
        this.forceUpdate();
      } else if (wasSel) this.cancelSel(); // second click on the selected piece: deselect
    };
    const esc = (ev) => { if (ev.key === 'Escape') { teardown(); this.drag = null; this.cancelSel(); this.forceUpdate(); } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', esc);
  }

  ls(k, v) { try { if (v === undefined) { const x = localStorage.getItem(LS_PREFIX + k); return x ? JSON.parse(x) : null; } localStorage.setItem(LS_PREFIX + k, JSON.stringify(v)); return true; } catch (e) { return v === undefined ? null : false; } }
  prefOptions() { return { themes: Object.keys(this.THEMES), tcs: Object.keys(this.TC), pieceSets: PIECE_SETS.map(x => x.id), defaultPieces: DEFAULT_PIECES, gamesCount: GAMES.length, defaultLevel: this.props.defaultBotLevel ?? 4, defaultTc: this.props.defaultTimeControl ?? '10+5' }; }
  prefsLoad() {
    let next;
    try {
      const pr = sanitizePrefs(this.ls('prefs'), this.prefOptions());
      next = {
        dark: pr.dark, sound: pr.sound, autoFlip: pr.autoFlip, ghostIdx: pr.ghostIdx, boardTheme: pr.boardTheme, pieceSet: pr.pieceSet, coords: pr.coords,
        setup: { mode: 'bot', level: pr.level, side: 'random', tc: pr.tc },
        stats: sanitizeStats(this.ls('stats')), daily: sanitizeDaily(this.ls('daily')),
      };
    } catch (e) { // unreadable saved data: start fresh instead of a blank page
      console.warn('chess: saved data unreadable, starting fresh', e);
      next = { stats: { ...DEFAULT_STATS }, daily: { last: '', streak: 0 } };
      try { for (const k of ['prefs', 'stats', 'daily']) localStorage.removeItem(LS_PREFIX + k); } catch (e2) { }
    }
    this.setState(next, () => { this.applyDark(); if (this.games) this.ghostSet(this.state.ghostIdx, false); });
  }
  prefsSave() { const s = this.state; this.ls('prefs', { dark: s.dark, boardTheme: s.boardTheme, pieceSet: s.pieceSet, coords: s.coords, level: s.setup.level, tc: s.setup.tc, sound: s.sound, autoFlip: s.autoFlip, ghostIdx: s.ghostIdx }); }
  statsSave(st) { return this.ls('stats', st); }
  applyDark() { try { document.documentElement.classList.toggle('light', !this.state.dark); } catch (e) { } }
  resetStats = () => {
    if (!this.state.resetArmed) {
      clearTimeout(this.resetT);
      this.resetT = setTimeout(() => this.setState({ resetArmed: false }), 5000);
      this.setState({ resetArmed: true });
      return;
    }
    clearTimeout(this.resetT);
    const stats = { ...DEFAULT_STATS }, daily = { last: '', streak: 0 };
    this.statsSave(stats); this.ls('daily', daily);
    this.statT = Date.now();
    this.setState({ stats, daily, resetArmed: false, lastDelta: null });
  };

  // ---------- built-in engine in a Web Worker (keeps the page responsive during deep searches) ----------
  ensureEW() {
    if (this.ew || this.ewFailed) return this.ew;
    try {
      const w = new Worker(new URL(ENGINE_WORKER_URL, document.baseURI).href);
      w.onmessage = (e) => { const d = e.data || {}; const p = this.ewPending.get(d.id); if (!p) return; this.ewPending.delete(d.id); p.resolve(d); };
      w.onerror = () => { this.ewFailed = true; const pend = [...this.ewPending.values()]; this.ewPending.clear(); try { w.terminate(); } catch (e) { } this.ew = null; for (const p of pend) p.resolve({ cancelled: true }); };
      this.ew = w;
    } catch (e) { this.ewFailed = true; this.ew = null; }
    return this.ew;
  }
  engineRequest(kind, msg) { // resolves {move,score} | {cp} | {error} | {cancelled}; never rejects
    const w = this.ensureEW();
    if (!w) return new Promise(res => setTimeout(() => { try { res(this.engineSync(msg)); } catch (e) { res({ error: String((e && e.message) || e) }); } }, 0)); // no worker: main thread, as the design did
    const id = (this.ewId = (this.ewId || 0) + 1);
    return new Promise(resolve => { this.ewPending.set(id, { kind, resolve }); w.postMessage({ id, ...msg }); });
  }
  engineSync(msg) {
    const E = this.E, st = E.fromFEN(msg.fen);
    if (msg.cmd === 'best') { const r = E.bestMove(st, msg.opts); return { move: r ? r.move : null, score: r ? r.score : 0 }; }
    const lg = E.legalMoves(st);
    return { cp: !lg.length ? (E.inCheck(st) ? (st.t === 'w' ? -9999 : 9999) : 0) : E.searchEval(st, msg.depth) };
  }
  engineCancel(kind) { // abort running and queued searches by restarting the worker; callers retry while their request is still wanted
    const pend = [...this.ewPending.values()];
    if (!pend.length || (kind && !pend.some(p => p.kind === kind))) return;
    this.ewPending.clear();
    if (this.ew) { try { this.ew.terminate(); } catch (e) { } this.ew = null; }
    for (const p of pend) p.resolve({ cancelled: true });
  }
  hydrateMove(st, m) { return m ? this.E.moveFromUci(st, this.E.alg(m.f) + this.E.alg(m.t) + (m.promo || '')) : null; }
  // ---------- famous games ----------
  gameSteps(idx) {
    if (this.gameCache.has(idx)) return this.gameCache.get(idx);
    const E = this.E, g = this.games[idx];
    let st = E.init(); const steps = [{ fen: E.toFEN(st), san: '' }];
    for (const san of g.moves.split(' ')) { const m = E.moveFromSan(st, san); if (!m) break; st = E.applyMove(st, m); steps.push({ fen: E.toFEN(st), san }); }
    const r = { steps, fens: steps.map(x => x.fen) };
    this.gameCache.set(idx, r);
    return r;
  }
  ghostSet(idx, save) {
    if (!this.games || !this.games.length) return;
    idx = ((idx % this.games.length) + this.games.length) % this.games.length;
    this.ghostFens = this.gameSteps(idx).fens; this.ghostPly = 0;
    if (!this.state.g) this.syncPL('play', this.E.init().b, false);
    if (save) this.setState({ ghostIdx: idx }, () => this.prefsSave()); else if (this.state.ghostIdx !== idx) this.setState({ ghostIdx: idx });
  }

  // ---------- ghost ----------
  ghostTick() {
    if (!this.E || this.state.screen !== 'play' || this.state.g || !this.ghostFens) return;
    this.ghostPly = (this.ghostPly + 1) % (this.ghostFens.length + 3);
    const ply = Math.min(this.ghostPly, this.ghostFens.length - 1);
    this.syncPL('play', this.E.fromFEN(this.ghostFens[ply]).b, ply !== 0 && this.ghostPly < this.ghostFens.length);
    this.forceUpdate();
  }

  // ---------- game ----------
  startGame = () => {
    const E = this.E, s = this.state.setup;
    const side = s.mode === 'local' ? 'w' : (s.side === 'random' ? (Math.random() < .5 ? 'w' : 'b') : s.side[0]);
    const tc = this.TC[s.tc];
    this.gen = (this.gen || 0) + 1;
    this.engineCancel(); this.lastTickSec = null;
    const g = {
      st: E.init(), hist: [], mode: s.mode, level: s.level, userSide: side, tcName: s.tc,
      tc, clocks: tc ? { w: tc[0] * 1000, b: tc[0] * 1000 } : null, lastTickAt: Date.now(),
      running: true, over: null, reps: { [this.repKey(E.init())]: 1 }, gen: this.gen, sf: s.mode === 'bot' && this.usesSF(s.level), sfFallback: false,
    };
    this.prefsSave();
    this.syncPL('play', g.st.b, false);
    this.setState({ g, sel: -1, targets: [], promo: null, flip: side === 'b', lastDelta: null, thinking: false, resignArmed: false, copied: false }, () => {
      if (s.mode === 'bot' && this.usesSF(s.level)) { if (this.sfFailed) this.sfDispose(); this.ensureSF(); } // before the first bot move, so a stale failed worker cannot trip the fallback
      if (s.mode === 'bot' && side === 'b') this.botMove();
    });
  };
  repKey(st) { return this.E.repKey(st); }
  pushMove(m) {
    const E = this.E, g = this.state.g;
    const san = E.sanFor(g.st, m);
    const mover = g.st.t;
    g.st = E.applyMove(g.st, m);
    g.hist.push({ san, fen: E.toFEN(g.st), uci: E.alg(m.f) + E.alg(m.t) + (m.promo || ''), clocks: g.clocks ? { ...g.clocks } : null });
    this.syncPL('play', g.st.b, true);
    if (g.tc) { g.clocks[mover] += g.tc[1] * 1000; g.lastTickAt = Date.now(); }
    const k = this.repKey(g.st); g.reps[k] = (g.reps[k] || 0) + 1;
    const stt = E.status(g.st);
    if (stt.over) {
      if (stt.mate) this.endGame(g.mode === 'local' ? (stt.winner === 'w' ? 'White wins' : 'Black wins') : (stt.winner === g.userSide ? 'You win' : 'You lose'), 'checkmate', stt.winner);
      else this.endGame('Draw', stt.stale ? 'stalemate' : stt.insufficient ? 'insufficient material' : 'fifty-move rule', null);
    } else if (g.reps[k] >= 3) this.endGame('Draw', 'threefold repetition', null);
    if (this.state.sound) playSound(g.over ? 'end' : stt.check ? 'check' : (m.cap !== undefined) ? 'capture' : 'move');
    if (g.mode === 'local' && this.state.autoFlip && !g.over) { const gen = g.gen; clearTimeout(this.flipT); this.flipT = setTimeout(() => { const g2 = this.state.g; if (!g2 || g2.gen !== gen || g2.over) return; this.flipAt = Date.now(); this.setState({ flip: g2.st.t === 'b' }); }, 260); }
    this.setState({ g, sel: -1, targets: [] });
    return !g.over;
  }
  endGame(title, reason, winner) {
    const g = this.state.g; if (!g || g.over) return;
    g.over = { title, reason, winner }; g.running = false;
    let stats = { ...this.state.stats }, delta = null;
    if (g.mode === 'bot') {
      const score = winner === null ? .5 : winner === g.userSide ? 1 : 0;
      const oppR = this.botRating(g.level, g.sfFallback);
      const exp = 1 / (1 + Math.pow(10, (oppR - stats.rating) / 400));
      delta = Math.round(kFactor(stats.w + stats.d + stats.l, stats.rating) * (score - exp));
      stats.rating = Math.max(100, stats.rating + delta);
      if (score === 1) stats.w++; else if (score === 0) stats.l++; else stats.d++;
      stats.ratingHist = [...stats.ratingHist, { t: Date.now(), r: stats.rating }].slice(-60);
    }
    const pgn = this.pgnOf(g, true);
    stats.games = [{ d: localDay(), opp: g.mode === 'bot' ? this.botName(g) : 'Pass & play', res: winner === null ? '½–½' : winner === 'w' ? '1–0' : '0–1', side: g.userSide, tc: g.tcName, pgn, n: Math.ceil(g.hist.length / 2) }, ...this.state.stats.games].slice(0, 50);
    this.statsSave(stats);
    this.setState({ g, stats, lastDelta: delta, thinking: false, resignArmed: false });
  }
  tick() {
    const g = this.state.g;
    if (!g || !g.running || g.over || !g.tc) return;
    const now = Date.now(), el = now - g.lastTickAt;
    if (g.hist.length === 0) { g.lastTickAt = now; return; }
    g.clocks[g.st.t] -= el; g.lastTickAt = now;
    if (this.state.sound && g.clocks[g.st.t] < 10000 && (g.mode === 'local' || g.st.t === g.userSide)) { const sec = Math.ceil(g.clocks[g.st.t] / 1000); if (sec > 0 && sec !== this.lastTickSec) { this.lastTickSec = sec; playSound('tick'); } }
    if (g.clocks[g.st.t] <= 0) {
      g.clocks[g.st.t] = 0;
      const winner = g.st.t === 'w' ? 'b' : 'w';
      // flag-fall vs bare king (or king + minor) is a draw, not a loss
      const winnerPieces = g.st.b.filter(p => p && (p === p.toUpperCase() ? 'w' : 'b') === winner && p.toLowerCase() !== 'k').map(p => p.toLowerCase());
      const canMate = winnerPieces.some(p => p === 'p' || p === 'r' || p === 'q') || winnerPieces.length >= 2;
      if (!canMate) this.endGame('Draw', 'time out, insufficient material', null);
      else this.endGame(g.mode === 'local' ? (winner === 'w' ? 'White wins' : 'Black wins') : winner === g.userSide ? 'You win' : 'You lose', 'time out', winner);
    }
    if (this.state.screen === 'play') this.forceUpdate();
  }
  clickPlay(i) {
    const E = this.E, s = this.state, g = s.g;
    if (!g || g.over || s.promo || s.thinking) return;
    if (g.mode === 'bot' && g.st.t !== g.userSide) return;
    const legal = E.legalMoves(g.st);
    if (s.sel >= 0) {
      const ms = legal.filter(m => m.f === s.sel && m.t === i);
      if (ms.length) {
        if (ms[0].promo) { this.setState({ promo: { moves: ms, side: g.st.t, from: s.sel, to: i }, sel: -1, targets: [] }); return; }
        if (this.pushMove(ms[0]) && g.mode === 'bot') this.botMove();
        return;
      }
    }
    if (s.sel === i) { this.setState({ sel: -1, targets: [] }); return; }
    const p = g.st.b[i];
    if (p && (p === p.toUpperCase() ? 'w' : 'b') === g.st.t) { if (this.dropping) { this.setState({ sel: -1, targets: [] }); return; } this.setState({ sel: i, targets: legal.filter(m => m.f === i).map(m => m.t) }); }
    else this.setState({ sel: -1, targets: [] });
  }
  cancelSel = () => {
    if (this.state.sel >= 0 || this.state.promo) this.setState({ sel: -1, targets: [], promo: null });
    const z = this.state.puz; if (z && z.sel >= 0) { z.sel = -1; z.targets = []; this.setState({ puz: z }); }
    if (this.anaSel >= 0) { this.anaSel = -1; this.anaTargets = []; this.forceUpdate(); }
  };
  completePromo(pc) {
    const s = this.state; if (!s.promo) return;
    const m = s.promo.moves.find(x => x.promo === pc);
    this.setState({ promo: null }, () => { if (this.pushMove(m) && this.state.g.mode === 'bot') this.botMove(); });
  }
  // Levels with a Stockfish skill level play with Stockfish; the others (and every level when Stockfish cannot run) use the built-in engine.
  usesSF(level) { return this.E.BOT_LEVELS[level].skill !== undefined; }
  sfSkill(level) { return this.E.BOT_LEVELS[level].skill; }
  botRating(level, fallback) { const L = this.E.BOT_LEVELS[level]; return fallback ? L.fbRating || L.rating : L.rating; }
  botName(g) {
    const lv = g.level;
    if (lv === 'M') return g.sfFallback ? 'Engine · Max (fallback)' : 'Stockfish · Max';
    return g.sf ? (g.sfFallback ? 'Engine · Level ' + lv + ' (fallback)' : 'Stockfish · Level ' + lv) : 'Engine · Level ' + lv;
  }
  moveBudget(base, g) { const remaining = g.tc ? g.clocks[g.st.t] : null; return remaining == null ? base : Math.max(80, Math.min(base, Math.floor(remaining / 30))); } // never more than a thirtieth of the clock, at least 80 ms
  botOpts(g) { // built-in engine settings for this game
    const base = this.E.BOT_LEVELS[g.level];
    return { maxDepth: base.maxDepth, timeMs: this.moveBudget(base.timeMs, g), noise: base.noise, history: g.reps };
  }
  botMove() {
    const g = this.state.g; if (!g || g.over) return;
    const gen = g.gen;
    this.setState({ thinking: true });
    if (this.usesSF(g.level)) { this.sfMove(gen); return; }
    setTimeout(async () => {
      for (;;) {
        const g2 = this.state.g;
        if (!g2 || g2.gen !== gen || g2.over) return;
        const r = await this.engineRequest('best', { cmd: 'best', fen: this.E.toFEN(g2.st), opts: this.botOpts(g2) });
        const g3 = this.state.g;
        if (!g3 || g3.gen !== gen || g3.over) return;
        if (r.cancelled) continue; // worker restarted (e.g. by an analysis eval): search again
        this.setState({ thinking: false });
        let m = this.hydrateMove(g3.st, r.move);
        if (!m) { const rr = this.E.bestMove(g3.st, { maxDepth: 1 }); m = rr && rr.move; }
        if (m) this.pushMove(m);
        return;
      }
    }, 380);
  }
  sfDispose() { if (this.sf) { try { this.sf.terminate(); } catch (e) { } } if (this.sfWaiter) { const w = this.sfWaiter; this.sfWaiter = null; w.resolve(null); } this.sf = null; this.sfReady = null; this.sfFailed = false; }
  ensureSF() { // resolves with the worker once it answered `uciok`, or null when it cannot be used
    if (this.sfReady) return this.sfReady;
    this.sfReady = new Promise(resolve => {
      let sf;
      try { sf = new Worker(new URL('engine/stockfish.js', document.baseURI).href); }
      catch (e) { this.sfFailed = true; resolve(null); return; }
      const fail = () => { clearTimeout(loadT); this.sfFailed = true; try { sf.terminate(); } catch (e) { } this.sf = null; if (this.sfWaiter) { const w = this.sfWaiter; this.sfWaiter = null; w.resolve(null); } resolve(null); };
      const loadT = setTimeout(fail, 45000); // 1.5 MB of asm.js can take a while on a phone; only a real failure trips this
      sf.onerror = fail;
      sf.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line === 'uciok') { clearTimeout(loadT); this.sf = sf; resolve(sf); }
        else if (line.startsWith('bestmove') && this.sfWaiter) { const w = this.sfWaiter; this.sfWaiter = null; w.resolve(line.split(' ')[1]); }
        else if (line.startsWith('info ') && this.sfWaiter && this.sfWaiter.onInfo) { const p = this.sfParseInfo(line); if (p) this.sfWaiter.onInfo(p); }
      };
      sf.postMessage('uci');
    });
    return this.sfReady;
  }
  sfParseInfo(line) { return sfParseInfo(line); }
  pvToSan(st, pv, max = 8) { return pvToSan(this.E, st, pv, max); }
  uciSquares(uci) { return uciSquares(this.E, uci); }
  async sfSearch(fen, movetime, onInfo, skill = 20) { // one search at a time: a running one is stopped and drained first, so no stale bestmove crosses over
    const sf = await this.ensureSF(); if (!sf) return null;
    while (this.sfWaiter) { sf.postMessage('stop'); await this.sfWaiter.promise; }
    const w = { onInfo: onInfo || null }; w.promise = new Promise(res => { w.resolve = res; }); this.sfWaiter = w;
    sf.postMessage('setoption name Skill Level value ' + skill); // 20 = full strength (analysis, Max); lower for the levels that play with Stockfish
    sf.postMessage('position fen ' + fen);
    sf.postMessage('go movetime ' + movetime);
    const soft = setTimeout(() => { try { sf.postMessage('stop'); } catch (e) { } }, movetime + 3000);
    const hard = setTimeout(() => { if (this.sfWaiter === w) { this.sfWaiter = null; w.resolve(null); } }, movetime + 8000);
    const uci = await w.promise;
    clearTimeout(soft); clearTimeout(hard);
    return uci;
  }
  async sfMove(gen) {
    const useBuiltIn = async () => {
      for (;;) {
        const g = this.state.g; if (!g || g.gen !== gen || g.over) return;
        g.sfFallback = true;
        const r = await this.engineRequest('best', { cmd: 'best', fen: this.E.toFEN(g.st), opts: this.botOpts(g) });
        const g2 = this.state.g; if (!g2 || g2.gen !== gen || g2.over) return;
        if (r.cancelled) continue;
        this.setState({ thinking: false, g: g2 });
        const m = this.hydrateMove(g2.st, r.move);
        if (m) this.pushMove(m);
        return;
      }
    };
    const sf = await this.ensureSF();
    let g = this.state.g; if (!g || g.gen !== gen || g.over) return;
    if (!sf || this.sfFailed) { await useBuiltIn(); return; }
    let m = null;
    for (let attempt = 0; attempt < 2 && !m; attempt++) {
      const movetime = this.moveBudget(1000, g);
      const uci = await this.sfSearch(this.E.toFEN(g.st), movetime, null, this.sfSkill(g.level));
      g = this.state.g; if (!g || g.gen !== gen || g.over) return;
      m = uci ? this.E.moveFromUci(g.st, uci) : null;
    }
    if (!m) { this.sfFailed = true; await useBuiltIn(); return; }
    this.setState({ thinking: false });
    this.pushMove(m);
  }
  resign = () => {
    const g = this.state.g; if (!g || g.over) return;
    if (!this.state.resignArmed) { clearTimeout(this.resignT); this.resignT = setTimeout(() => this.setState({ resignArmed: false }), 4000); this.setState({ resignArmed: true }); return; }
    clearTimeout(this.resignT); this.setState({ resignArmed: false });
    const loser = g.mode === 'local' ? g.st.t : g.userSide; const winner = loser === 'w' ? 'b' : 'w';
    this.endGame(g.mode === 'local' ? (winner === 'w' ? 'White wins' : 'Black wins') : 'You lose', 'resignation', winner);
  };
  discardGame = () => { this.gen = (this.gen || 0) + 1; this.engineCancel(); clearTimeout(this.flipT); this.ghostPly = 0; this.syncPL('play', this.E.init().b, false); this.setState({ g: null, sel: -1, targets: [], promo: null, flip: false, thinking: false, resignArmed: false, copied: false }); };
  abortGame = () => { const g = this.state.g; if (g && g.mode === 'local' && !g.over) this.discardGame(); };
  pgnOf(g, headers) { return pgnOf(g, headers); }
  pgnFromArchive(gm) { return pgnFromArchive(gm); }
  download(name, text, type) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { this.setState({ importMsg: 'Download failed: ' + (e && e.message) }); }
  }
  copyText(t, done) {
    const fallback = () => { try { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (e) { } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
  }
  onImportFile = (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    if (f.size > 5e6) { this.setState({ importMsg: 'That file is too large to be a chess export.' }); return; }
    f.text().then(t => {
      let d = null; try { d = JSON.parse(t); } catch (err) { d = null; }
      if (!d || typeof d !== 'object' || !d.stats || typeof d.stats !== 'object') { this.setState({ importMsg: 'Not a chess data export.' }); return; }
      const stats = sanitizeStats(obj(d.stats)), daily = sanitizeDaily(obj(d.daily));
      const ok = this.statsSave(stats) && this.ls('daily', daily);
      const keep = pickPrefs(d.prefs); // only known keys; prefsLoad validates the values
      if (Object.keys(keep).length) this.ls('prefs', { ...(this.ls('prefs') || {}), ...keep });
      this.prefsLoad(); this.statT = Date.now();
      if (!ok) { this.setState({ importMsg: 'Could not save: browser storage is full or blocked.' }); return; }
      this.setState({ importMsg: 'Imported ' + stats.games.length + ' game' + (stats.games.length === 1 ? '' : 's') + ', rating ' + stats.rating + ', ' + stats.puzzlesSolved + ' puzzles solved.' });
    }, () => this.setState({ importMsg: 'Could not read that file.' }));
  };
  takeback = () => {
    const E = this.E, g = this.state.g;
    if (!g || g.over || g.mode !== 'bot' || this.state.thinking) return;
    const n = g.st.t === g.userSide ? 2 : 1;
    if (g.hist.length < n) return;
    const removed = g.hist.splice(-n);
    if (g.tc && removed[0] && removed[0].clocks) { g.clocks = { ...removed[0].clocks }; g.lastTickAt = Date.now(); }
    g.st = E.fromFEN(g.hist.length ? g.hist[g.hist.length - 1].fen : E.START);
    this.syncPL('play', g.st.b, true);
    g.reps = { [this.repKey(E.init())]: 1 }; for (const h of g.hist) { const k = this.E.repKeyFromFEN(h.fen); g.reps[k] = (g.reps[k] || 0) + 1; }
    this.setState({ g, sel: -1, targets: [] }, () => { if (g.st.t !== g.userSide) this.botMove(); });
  };
  rematch = () => { const g = this.state.g; const setup = { ...this.state.setup, mode: g.mode, level: g.level, tc: g.tcName, side: g.mode === 'bot' ? (g.userSide === 'w' ? 'black' : 'white') : 'random' }; this.setState({ setup }, this.startGame); };

  // ---------- puzzles (lichess set: fen is before the opponent's move, moves[0] is that move) ----------
  // The 2000 puzzles live in their own hashed file (tools/build.mjs), fetched once after the app is up so that the main
  // bundle stays small; until then the puzzle screen says it is loading, and a failed fetch is retried from the screen.
  loadPuzzles() {
    if (this.puzLoading || this.puzzles.length) return; this.puzLoading = true;
    this.setState({ puzLoad: 'loading' });
    let req; try { req = fetch(PUZZLES_URL, { priority: 'low' }); } catch (e) { req = Promise.reject(e); }
    req.then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(arr => {
      if (!Array.isArray(arr) || !arr.length) throw new Error('bad puzzle file');
      this.puzzles = arr.map(([id, fen, moves, rating, themes]) => ({ id, fen, moves: moves.split(' '), rating, themes: themes.split(' '), band: puzBand(rating) }));
      this.pools = null; this.dailyOrder = null; this.puzLoading = false;
      this.setState({ puzLoad: 'ok' }, () => { if (this.state.puzCat === 'Daily') this.loadDaily(); else this.puzNext(); });
    }).catch(() => { this.puzLoading = false; this.setState({ puzLoad: 'error' }); });
  }
  puzPool(cat, band) { // the puzzle set is static, so the pools are built once
    const key = cat + '|' + band; if (this.pools && this.pools[key]) return this.pools[key];
    const c = PUZ_CATS.find(x => x.label === cat);
    const pool = this.puzzles.filter(p => (!c || !c.theme || p.themes.includes(c.theme)) && (band === 'Any' || p.band === band.toLowerCase()));
    (this.pools = this.pools || {})[key] = pool; return pool;
  }
  puzThemeLabel(p) { return puzThemeLabel(p); }
  eloDelta(R, P, score, K) { return eloDelta(R, P, score, K); }
  signed(d) { return signed(d); }
  applyPuzResult(stats, z, score) { // rating step shared by a wrong move/reveal (0) and a clean solve (1); a puzzle is rated once, ever
    if ((stats.solved || []).includes(z.p.id)) return null;
    const d = eloDelta(stats.puzzleRating, z.p.rating, score, kFactor(stats.puzzlesRated, stats.puzzleRating));
    stats.puzzlesRated++; stats.puzzleRating = Math.max(100, Math.min(4000, stats.puzzleRating + d));
    return d;
  }
  puzRate(z, score) { // once per attempt: a wrong move or a reveal scores 0
    if (z.rated) return null; z.rated = true;
    const stats = { ...this.state.stats };
    const d = this.applyPuzResult(stats, z, score);
    this.statsSave(stats); this.setState({ stats });
    return d;
  }
  dailyAttempted(z) { // a wrong move or a reveal on today's puzzle uses up the streak chance, also after a reload
    if (!z.isDaily || !z.day) return;
    const daily = { ...this.state.daily };
    if (daily.done === z.day || daily.last === z.day) return;
    daily.done = z.day; this.ls('daily', daily); this.setState({ daily });
  }
  liveStreak(daily) { const t = localDay(); return daily.last === t || daily.last === prevDay(t) ? daily.streak : 0; } // a lapsed streak shows as 0
  loadDaily() {
    if (!this.puzzles || !this.puzzles.length) return;
    const pool = this.puzzles.filter(p => p.band === 'medium'); if (!pool.length) return;
    if (!this.dailyOrder || this.dailyOrder.length !== pool.length) this.dailyOrder = seededOrder(pool.length); // same puzzle for everyone on a given day, in a fixed shuffle
    this.initPuzzle(this.puzzles.indexOf(pool[this.dailyOrder[dayIndex() % pool.length]]), true);
  }
  initPuzzle(idx, isDaily) {
    const E = this.E, p = this.puzzles[idx];
    const st = E.fromFEN(p.fen);
    this.puzGen = (this.puzGen || 0) + 1;
    const gen = this.puzGen;
    this.syncPL('puz', st.b, false);
    this.setState({ puz: { idx, p, st, userSide: st.t === 'w' ? 'b' : 'w', step: 0, phase: 'intro', msg: '', msgC: '', failed: false, hinted: false, rated: false, isDaily: !!isDaily, day: isDaily ? localDay() : '', hint: -1, sel: -1, targets: [], last: null, flash: null, revealed: false, gen, sans: [] } });
    setTimeout(() => {
      const z = this.state.puz; if (!z || z.gen !== gen) return;
      const m = E.moveFromUci(z.st, p.moves[0]); if (!m) return;
      z.st = E.applyMove(z.st, m); z.last = { f: m.f, t: m.t }; z.step = 1; z.phase = 'solving';
      this.syncPL('puz', z.st.b, true);
      if (this.state.sound) playSound(m.cap !== undefined ? 'capture' : 'move');
      this.setState({ puz: z });
    }, 600);
  }
  puzObjectiveText(z) {
    const side = z.userSide === 'w' ? 'White' : 'Black';
    const mi = z.p.themes.find(t => /^mateIn\d$/.test(t));
    return mi ? side + ' to move \u2014 mate in ' + mi.slice(6) + '.' : side + ' to move \u2014 find the best continuation.';
  }
  clickPuz(i) {
    const E = this.E, z = this.state.puz;
    if (!z || z.phase !== 'solving') return;
    if (z.st.t !== z.userSide) return;
    const legal = E.legalMoves(z.st);
    if (z.sel >= 0) {
      const ms = legal.filter(m => m.f === z.sel && m.t === i);
      if (ms.length) { this.puzUserMove(ms.find(m => m.promo === 'q') || ms[0]); return; }
    }
    if (z.sel === i) { z.sel = -1; z.targets = []; this.setState({ puz: z }); return; }
    const p = z.st.b[i];
    if (p && (p === p.toUpperCase() ? 'w' : 'b') === z.st.t && !this.dropping) { z.sel = i; z.targets = legal.filter(m => m.f === i).map(m => m.t); this.setState({ puz: z }); }
    else { z.sel = -1; z.targets = []; this.setState({ puz: z }); }
  }
  puzFlash(z, sq, kind, ms) {
    z.flash = { sq, kind };
    const gen = z.gen;
    setTimeout(() => { const z2 = this.state.puz; if (z2 && z2.gen === gen && z2.flash && z2.flash.sq === sq) { z2.flash = null; this.setState({ puz: z2 }); } }, ms || 650);
  }
  puzUserMove(m) {
    const E = this.E, z = this.state.puz, p = z.p;
    const uci = E.alg(m.f) + E.alg(m.t) + (m.promo || '');
    const expected = p.moves[z.step];
    const after = E.applyMove(z.st, m);
    let ok = uci === expected;
    if (!ok && E.isMate(after)) ok = true; // a checkmate is never wrong (lichess accepts any mate)
    if (!ok) { this.puzFail(m.t); return; }
    z.sans.push(E.sanFor(z.st, m));
    z.st = after; z.last = { f: m.f, t: m.t }; z.step++; z.sel = -1; z.targets = []; z.hint = -1;
    this.syncPL('puz', z.st.b, true);
    this.puzFlash(z, m.t, 'good');
    const done = z.step >= p.moves.length || E.isMate(z.st);
    if (this.state.sound) playSound(done ? 'end' : (m.cap !== undefined) ? 'capture' : 'move');
    if (done) { this.puzSolved(); return; }
    z.msg = 'Good \u2014 keep going.'; z.msgC = 'ok';
    this.setState({ puz: z });
    const gen = z.gen;
    setTimeout(() => {
      const z2 = this.state.puz; if (!z2 || z2.gen !== gen || z2.phase !== 'solving') return;
      const reply = E.moveFromUci(z2.st, p.moves[z2.step]);
      if (reply) { z2.sans.push(E.sanFor(z2.st, reply)); z2.st = E.applyMove(z2.st, reply); z2.last = { f: reply.f, t: reply.t }; z2.step++; this.syncPL('puz', z2.st.b, true); if (this.state.sound) playSound(reply.cap !== undefined ? 'capture' : 'move'); }
      this.setState({ puz: z2 });
    }, 420);
  }
  puzFail(sq) {
    const z = this.state.puz;
    z.sel = -1; z.targets = [];
    this.puzFlash(z, sq, 'bad');
    let d = null;
    if (!z.failed) { z.failed = true; d = this.puzRate(z, 0); this.dailyAttempted(z); }
    z.msg = 'Not quite \u2014 try again.' + (d ? ' (' + this.signed(d) + ')' : ''); z.msgC = 'bad';
    if (this.state.sound) playSound('check');
    this.setState({ puz: z, puzShake: 'ocshake .4s' });
    clearTimeout(this.shakeT);
    this.shakeT = setTimeout(() => this.setState({ puzShake: 'none' }), 450);
  }
  puzSolved() {
    const z = this.state.puz;
    z.phase = 'solved';
    let d = null, dailyMiss = false;
    if (!z.revealed) {
      const stats = { ...this.state.stats }, daily = { ...this.state.daily };
      if (!z.failed && !z.hinted && !z.rated) { z.rated = true; d = this.applyPuzResult(stats, z, 1); }
      if (!(stats.solved || []).includes(z.p.id)) stats.puzzlesSolved++; // distinct puzzles
      stats.solved = [...(stats.solved || []).filter(x => x !== z.p.id), z.p.id].slice(-2000);
      if (z.isDaily && z.day) { // credited to the day the puzzle was loaded for, even if solved after midnight
        const attempted = daily.done === z.day; // a wrong move or a reveal earlier today, also before a reload
        dailyMiss = z.failed || attempted; daily.done = z.day;
        if (!dailyMiss && daily.last !== z.day) { // the streak counts first-try solves only
          daily.streak = daily.last === prevDay(z.day) ? daily.streak + 1 : 1;
          daily.best = Math.max(daily.best || 0, daily.streak);
          daily.last = z.day;
        }
      }
      this.statsSave(stats); this.ls('daily', daily);
      this.setState({ stats, daily });
    }
    z.msg = z.revealed ? 'That was the solution.' : 'Solved. Well done.' + (d ? ' (' + this.signed(d) + ')' : z.hinted ? ' (hint used — no rating change)' : '') + (dailyMiss ? ' The daily streak counts first-try solves.' : ''); z.msgC = 'ok';
    this.setState({ puz: z });
  }
  puzHint = () => {
    const E = this.E, z = this.state.puz; if (!z || z.phase !== 'solving') return;
    const m = E.moveFromUci(z.st, z.p.moves[z.step]); if (!m) return;
    z.hint = m.f; z.hinted = true; z.msg = 'Look at the highlighted piece.'; z.msgC = '';
    this.setState({ puz: z });
  };
  puzReveal = () => {
    const z0 = this.state.puz; if (!z0 || z0.phase !== 'solving') return;
    z0.revealed = true; z0.phase = 'revealing'; z0.msg = 'Watch\u2026'; z0.msgC = '';
    this.puzRate(z0, 0); this.dailyAttempted(z0);
    this.setState({ puz: z0 });
    const gen = z0.gen, E = this.E, p = z0.p;
    const step = () => {
      const z = this.state.puz; if (!z || z.gen !== gen) return;
      const mv = z.step < p.moves.length ? E.moveFromUci(z.st, p.moves[z.step]) : null;
      if (!mv) { z.phase = 'revealed'; z.msg = 'Solution: ' + z.sans.join(' '); this.setState({ puz: z }); return; }
      z.sans.push(E.sanFor(z.st, mv));
      z.st = E.applyMove(z.st, mv); z.last = { f: mv.f, t: mv.t }; z.step++;
      this.syncPL('puz', z.st.b, true);
      this.setState({ puz: z });
      setTimeout(step, 700);
    };
    step();
  };
  puzNext = () => {
    if (!this.puzzles.length) { this.loadPuzzles(); return; } // "Next" on the error screen retries the fetch
    const cat = this.state.puzCat === 'Daily' ? 'All' : this.state.puzCat, band = this.state.puzBand;
    const solved = new Set(this.state.stats.solved || []);
    const cur = this.state.puz ? this.state.puz.idx : -1;
    const current = this.puzzles[cur];
    const unsolved = pool => pool.filter(p => !solved.has(p.id) && p !== current);
    let pool = this.puzPool(cat, band), weighted = false;
    if (cat === 'All') { // draw the motif first, so the large endgame set does not crowd out the tactical motifs
      const sets = PUZ_CATS.filter(c => c.theme).map(c => this.puzPool(c.label, band)).filter(s => s.length);
      const fresh = sets.filter(s => unsolved(s).length);
      const use = fresh.length ? fresh : sets;
      if (use.length) { pool = use[Math.floor(Math.random() * use.length)]; weighted = true; }
    }
    if (!pool.length) return;
    let pick = unsolved(pool);
    if (!pick.length) pick = pool.filter(p => p !== current);
    if (!pick.length) pick = pool;
    // within a motif, a puzzle tagged with several motifs is reachable from each of them: weight by 1/motifs to even that out
    const motifs = p => Math.max(1, p.themes.filter(t => PUZ_CATS.some(c => c.theme === t)).length);
    const w = pick.map(p => weighted ? 1 / motifs(p) : 1); let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    while (i < w.length - 1 && (r -= w[i]) > 0) i++;
    const p = pick[i];
    this.initPuzzle(this.puzzles.indexOf(p), false);
  };
  setCat(c) { this.setState({ puzCat: c }, () => { if (c === 'Daily') this.loadDaily(); else this.puzNext(); }); }
  setBand(b) { this.setState({ puzBand: b, puzCat: this.state.puzCat === 'Daily' ? 'All' : this.state.puzCat }, () => this.puzNext()); }

  // ---------- learn: openings and famous games share one stepper ----------
  learnItem(l) {
    l = l || this.state.learn;
    if (l.kind === 'game') { const i = Math.min(l.sel, this.games.length - 1), g = this.games[i]; return { title: g.white + ' \u2013 ' + g.black, sub: g.event + ' ' + g.year, desc: g.why, steps: this.gameSteps(i).steps }; }
    const o = this.openings[Math.min(l.sel, this.openings.length - 1)];
    return { title: o.name, sub: o.eco, desc: o.desc, steps: o.steps };
  }
  learnGo(sel, ply, animate, kind) {
    const l = { kind: kind || this.state.learn.kind, sel, ply };
    const it = this.learnItem(l);
    this.syncPL('learn', this.E.fromFEN(it.steps[ply].fen).b, animate);
    this.setState({ learn: l });
  }
  learnSel(i) { clearInterval(this.learnIv); this.setState({ learnAuto: false }); this.learnGo(i, 0, false); }
  learnKind(kind) { if (kind === this.state.learn.kind) return; clearInterval(this.learnIv); this.setState({ learnAuto: false }); this.learnGo(0, 0, false, kind); }
  learnStep(d) { const l = this.state.learn, it = this.learnItem(l); const ply = Math.max(0, Math.min(it.steps.length - 1, l.ply + d)); if (ply !== l.ply) this.learnGo(l.sel, ply, true); }
  toggleLearnAuto = () => {
    const on = !this.state.learnAuto;
    clearInterval(this.learnIv);
    this.setState({ learnAuto: on });
    if (on) {
      const l = this.state.learn, it = this.learnItem(l);
      if (l.ply >= it.steps.length - 1) this.learnGo(l.sel, 0, false);
      this.learnIv = setInterval(() => {
        if (this.state.screen !== 'learn') { clearInterval(this.learnIv); this.setState({ learnAuto: false }); return; }
        const l2 = this.state.learn, it2 = this.learnItem(l2);
        if (l2.ply >= it2.steps.length - 1) { clearInterval(this.learnIv); this.setState({ learnAuto: false }); return; }
        this.learnGo(l2.sel, l2.ply + 1, true);
      }, 1400);
    }
  };

  // ---------- analysis ----------
  anaSetHist(hist, ptr, animate, flip) {
    this.syncPL('ana', this.E.fromFEN(hist[ptr].fen).b, !!animate);
    this.setState({ ana: { ...this.state.ana, hist, ptr, flip: flip ?? this.state.ana.flip, busy: false } }, () => this.anaEval(2));
  }
  anaEval(depth) {
    const token = (this.anaTok = (this.anaTok || 0) + 1);
    this.setState({ ana: { ...this.state.ana, busy: true, pv: [], pvSan: '', best: null, mate: null } });
    const run = async () => {
      if (this.anaTok !== token) return;
      const E = this.E, A = this.state.ana, fen = A.hist[A.ptr].fen;
      const st = E.fromFEN(fen), legal = E.legalMoves(st);
      if (!legal.length) { const cp = E.inCheck(st) ? (st.t === 'w' ? -9999 : 9999) : 0; this.setState({ ana: { ...this.state.ana, cp, depth: 0, busy: false, engine: 'end' } }); this.tweenCp(cp); return; }
      const g = this.state.g, sfGame = !!(g && !g.over && g.mode === 'bot' && g.sf); // the bot is using the Stockfish worker: analysis must not stop its searches
      const sf = (!this.sfFailed && !sfGame) ? await this.ensureSF() : null;
      if (this.anaTok !== token) return;
      if (sf) {
        let lastPaint = 0;
        const onInfo = (info) => {
          if (this.anaTok !== token) return;
          const now = Date.now(); if (now - lastPaint < 120) return; lastPaint = now;
          const cp = st.t === 'w' ? info.cpStm : -info.cpStm, mate = info.mateStm == null ? null : (st.t === 'w' ? info.mateStm : -info.mateStm);
          this.setState({ ana: { ...this.state.ana, cp, mate, depth: info.depth, engine: 'sf', pv: info.pv, pvSan: this.pvToSan(st, info.pv), best: this.uciSquares(info.pv[0]) } });
          this.tweenCp(cp);
        };
        const uci = await this.sfSearch(fen, depth >= 4 ? 4000 : 1000, onInfo);
        if (this.anaTok !== token) return;
        if (uci) { this.setState({ ana: { ...this.state.ana, busy: false, engine: 'sf', best: this.uciSquares(uci) || this.state.ana.best } }); return; }
      }
      this.engineCancel('eval'); // a newer request supersedes any running analysis search
      const r = await this.engineRequest('eval', { cmd: 'eval', fen, depth: Math.min(depth, 4) });
      if (this.anaTok !== token) return;
      if (r.cancelled) return run();
      if (r.error || !Number.isFinite(r.cp)) { this.setState({ ana: { ...this.state.ana, busy: false }, anaError: 'Could not evaluate this position.' }); return; }
      this.setState({ ana: { ...this.state.ana, cp: r.cp, depth: Math.min(depth, 4), busy: false, engine: 'builtin', mate: null } });
      this.tweenCp(r.cp);
    };
    setTimeout(run, 30);
  }
  tweenCp(target) {
    clearInterval(this.cpIv);
    const from = this.cpShow ?? 0, t0 = Date.now(), dur = 450;
    this.cpIv = setInterval(() => {
      const t = Math.min(1, (Date.now() - t0) / dur), e = 1 - Math.pow(1 - t, 3);
      this.cpShow = from + (target - from) * e;
      if (t >= 1) clearInterval(this.cpIv);
      this.forceUpdate();
    }, 30);
  }
  anaState() { return this.E.fromFEN(this.state.ana.hist[this.state.ana.ptr].fen); }
  clickAna(i) {
    const E = this.E, a = this.state.ana;
    const st = this.anaState();
    const legal = E.legalMoves(st);
    if (this.anaSel >= 0) {
      const ms = legal.filter(m => m.f === this.anaSel && m.t === i);
      if (ms.length) {
        const m = ms.find(x => x.promo === 'q') || ms[0];
        const san = E.sanFor(st, m), n = E.applyMove(st, m);
        const hist = [...a.hist.slice(0, a.ptr + 1), { san, fen: E.toFEN(n) }];
        this.anaSel = -1; this.anaTargets = [];
        this.anaSetHist(hist, hist.length - 1, true);
        return;
      }
    }
    if (this.anaSel === i) { this.anaSel = -1; this.anaTargets = []; this.forceUpdate(); return; }
    const p = st.b[i];
    if (p && (p === p.toUpperCase() ? 'w' : 'b') === st.t && !this.dropping) { this.anaSel = i; this.anaTargets = legal.filter(m => m.f === i).map(m => m.t); this.forceUpdate(); }
    else { this.anaSel = -1; this.anaTargets = []; this.forceUpdate(); }
  }
  anaJump(ptr) {
    const a = this.state.ana;
    this.anaSel = -1; this.anaTargets = [];
    this.syncPL('ana', this.E.fromFEN(a.hist[ptr].fen).b, Math.abs(ptr - a.ptr) === 1);
    this.setState({ ana: { ...a, ptr } }, () => this.anaEval(2));
  }
  anaImport = () => {
    const E = this.E;
    const txt = (this.pgnEl && this.pgnEl.value || '').trim(); if (!txt) return;
    let sans = [];
    try { sans = E.parsePGN(txt); } catch (e) { sans = []; }
    let st = E.init(); const hist = [{ san: '', fen: E.START }];
    for (const s of sans) { const m = E.moveFromSan(st, s); if (!m) break; st = E.applyMove(st, m); hist.push({ san: s, fen: E.toFEN(st) }); }
    if (hist.length < 2) { this.setState({ anaError: 'No legal moves found in that PGN.' }); return; }
    const skipped = sans.length - (hist.length - 1);
    this.setState({ anaError: skipped > 0 ? 'Imported ' + (hist.length - 1) + ' of ' + sans.length + ' moves; "' + sans[hist.length - 1] + '" was not legal there.' : '' });
    this.anaSetHist(hist, hist.length - 1, false);
  };
  anaFen = () => {
    const E = this.E; const v = (this.fenEl && this.fenEl.value || '').trim(); if (!v) return;
    const err = E.validateFEN(v);
    if (err) { this.setState({ anaError: 'Invalid FEN: ' + err + '.' }); return; }
    this.setState({ anaError: '' });
    this.anaSetHist([{ san: '', fen: E.toFEN(E.fromFEN(v)) }], 0, false);
  };
  anaLoadLast = () => { const g = this.state.stats.games[0]; if (g) this.loadPgnToAna(g.pgn, g.side === 'b'); };
  loadPgnToAna(pgn, flipped) {
    const E = this.E, sans = E.parsePGN(pgn);
    let st = E.init(); const hist = [{ san: '', fen: E.START }];
    for (const s of sans) { const m = E.moveFromSan(st, s); if (!m) break; st = E.applyMove(st, m); hist.push({ san: s, fen: E.toFEN(st) }); }
    this.setState({ screen: 'ana' }, () => this.anaSetHist(hist, hist.length - 1, false, !!flipped));
  }

  // ---------- squares ----------
  hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  buildSquares(board, o) {
    const t = this.THEMES[this.state.boardTheme], acc = this.props.accentColor ?? '#2952e3';
    const out = [];
    const tgt = new Set(o.targets || []);
    for (let di = 0; di < 64; di++) {
      const bi = o.flip ? 63 - di : di;
      const r = bi >> 3, f = bi & 7, dark = (r + f) % 2 === 1;
      const base = dark ? t.d : t.l;
      let layers = [], anim = 'none';
      if (o.last && (o.last.f === bi || o.last.t === bi)) layers.push('linear-gradient(rgba(212,170,60,.32),rgba(212,170,60,.32))');
      if (o.checkSq === bi) { layers.push('radial-gradient(circle, rgba(217,72,58,.55), rgba(217,72,58,0) 70%)'); anim = 'occheck 1.15s ease-in-out infinite'; }
      if (o.flash && o.flash.sq === bi) { layers.push(o.flash.kind === 'good' ? 'linear-gradient(rgba(58,160,96,.42),rgba(58,160,96,.42))' : 'linear-gradient(rgba(217,72,58,.45),rgba(217,72,58,.45))'); anim = 'ocflash .6s ease-out'; }
      if (bi === o.hint) layers.push('linear-gradient(' + this.hexA(acc, .35) + ',' + this.hexA(acc, .35) + ')');
      if (o.best && (o.best.f === bi || o.best.t === bi)) layers.push('linear-gradient(rgba(58,160,96,.38),rgba(58,160,96,.38))');
      if (tgt.has(bi)) layers.push(board[bi] ? 'radial-gradient(circle, transparent 56%, ' + this.hexA(acc, .4) + ' 58%, ' + this.hexA(acc, .4) + ' 74%, transparent 76%)' : 'radial-gradient(circle, ' + this.hexA(acc, .35) + ' 15%, transparent 17%)');
      const overOk = o.over === bi && tgt.has(bi);
      out.push({
        bg: layers.length ? layers.join(',') + ',linear-gradient(' + base + ',' + base + ')' : base,
        bs: overOk ? 'inset 0 0 0 4px ' + this.hexA(acc, .85) : o.sel === bi ? 'inset 0 0 0 3px ' + this.hexA(acc, .7) : 'none',
        anim,
        coR: this.state.coords && o.coords !== false && f === (o.flip ? 7 : 0) ? String(8 - r) : '',
        coF: this.state.coords && o.coords !== false && r === (o.flip ? 0 : 7) ? 'abcdefgh'[f] : '',
        coC: dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.35)',
        click: o.onClick ? () => o.onClick(bi) : undefined,
      });
    }
    return out;
  }
  fmtClock(ms) { if (ms == null) return '—'; ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  easeStat(v) { if (!this.statT) return v; const t = Math.min(1, (Date.now() - this.statT) / 800); const e = 1 - Math.pow(1 - t, 3); return Math.round(v * e); }
  goStats = () => {
    this.statT = Date.now();
    clearInterval(this.statIv);
    this.statIv = setInterval(() => { if (Date.now() - this.statT > 850) clearInterval(this.statIv); this.forceUpdate(); }, 40);
    this.setState({ screen: 'stats' });
  };

  renderVals() {
    const S = this.state, E = this.E;
    const acc = this.props.accentColor ?? '#2952e3';
    const dark = S.dark;
    const themeVars = {
      '--bg': dark ? '#111214' : '#e7e7e4', '--ink': dark ? '#e8e8ea' : '#16161a', '--sub': dark ? '#7c828c' : '#6b6b72',
      '--line': dark ? '#1f1f23' : '#cfcfcb', '--card': dark ? '#16161a' : '#f3f3f0', '--soft': dark ? '#1e1f24' : '#dcdcd8',
      '--acc': dark ? '#ffffff' : acc, '--accInk': dark ? '#111214' : '#ffffff',
      '--caseBg': dark ? 'linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.02))' : 'linear-gradient(180deg,rgba(255,255,255,.75),rgba(255,255,255,.35))',
      '--caseBd': dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)',
      '--caseSh': dark ? '0 40px 90px rgba(0,0,0,.7), 0 0 0 1px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.18)' : '0 30px 70px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,1)',
      '--caseTop': dark ? 'linear-gradient(90deg,transparent,rgba(255,255,255,.7),transparent)' : 'linear-gradient(90deg,transparent,rgba(255,255,255,1),transparent)',
      background: 'var(--bg)', color: 'var(--ink)', minHeight: '100vh', fontFamily: "'Instrument Sans',sans-serif",
    };
    const nav = (k) => ({ c: S.screen === k ? 'var(--ink)' : 'var(--sub)', w: S.screen === k ? '600' : '400' });
    const bpx = S.bpx, bw = bpx * 8, bfs = Math.round(bpx * .72);
    const out = {
      themeVars, bpx, bw, bfs,
      ratingTop: S.stats.rating, toggleDark: () => this.setState({ dark: !S.dark }, () => { this.prefsSave(); this.applyDark(); }),
      goHome: () => { const g = S.g; if (g && g.over) this.discardGame(); this.cancelSel(); this.setState({ screen: 'play', creditsOpen: false }); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { } },
      goPlay: () => this.setState({ screen: 'play' }), goPuzzles: () => this.setState({ screen: 'puz' }, () => { if (S.puzLoad === 'error') this.loadPuzzles(); }), goLearn: () => this.setState({ screen: 'learn' }), goAna: () => this.setState({ screen: 'ana' }), goStats: this.goStats,
      isPlay: S.screen === 'play', isPuzzles: S.screen === 'puz', isLearn: S.screen === 'learn', isAna: S.screen === 'ana', isStats: S.screen === 'stats',
      navPlayC: nav('play').c, navPlayW: nav('play').w, navPuzC: nav('puz').c, navPuzW: nav('puz').w, navLearnC: nav('learn').c, navLearnW: nav('learn').w, navAnaC: nav('ana').c, navAnaW: nav('ana').w, navStatsC: nav('stats').c, navStatsW: nav('stats').w,
      boardTheme: S.boardTheme, setBoardTheme: (e) => this.setState({ boardTheme: e.target.value }, () => this.prefsSave()),
      pieceSet: S.pieceSet, setPieceSet: (e) => this.setState({ pieceSet: e.target.value }, () => this.prefsSave()),
      promoQSrc: this.pieceSrc(S.promo && S.promo.side === 'b' ? 'q' : 'Q'), promoRSrc: this.pieceSrc(S.promo && S.promo.side === 'b' ? 'r' : 'R'), promoNSrc: this.pieceSrc(S.promo && S.promo.side === 'b' ? 'n' : 'N'), promoBSrc: this.pieceSrc(S.promo && S.promo.side === 'b' ? 'b' : 'B'),
      coordsLabel: S.coords ? 'coords on' : 'coords off', toggleCoords: () => this.setState({ coords: !S.coords }, () => this.prefsSave()),
      mlRef: el => this.ml = el, fenRef: el => this.fenEl = el, pgnRef: el => this.pgnEl = el,
      bdPlayRef: el => this.bd.play = el, bdPuzRef: el => this.bd.puz = el, bdAnaRef: el => this.bd.ana = el,
      puzShake: S.puzShake, anaError: S.anaError,
      screenPad: S.narrow ? '20px 12px 12px' : '36px 40px 20px', statsPad: S.narrow ? '20px 16px 12px' : '36px 56px 20px', casePad: S.narrow ? 12 : 22, screenGap: S.narrow ? 28 : 56,
      creditsOpen: S.creditsOpen, creditsLabel: S.creditsOpen ? 'Hide credits' : 'Credits', toggleCredits: () => this.setState({ creditsOpen: !S.creditsOpen }),
      resetLabel: S.resetArmed ? 'Click again to erase all stats and games' : 'Reset stats', resetC: S.resetArmed ? '#c0392b' : 'var(--sub)', resetStats: this.resetStats,
      resignLabel: S.resignArmed ? 'Resign? Click again' : '⚑ Resign', resignBd: S.resignArmed ? '#c0392b' : 'var(--line)', resignFg: S.resignArmed ? '#c0392b' : 'var(--ink)', resignW: S.resignArmed ? '600' : '400',
      isLocalGame: !!(S.g && !S.g.over && S.g.mode === 'local'), abortGame: this.abortGame,
      autoFlipLabel: S.autoFlip ? 'auto-flip on' : 'auto-flip off', toggleAutoFlip: () => this.setState({ autoFlip: !S.autoFlip }, () => this.prefsSave()),
      soundLabel: S.sound ? 'sound on' : 'sound off', toggleSound: () => this.setState({ sound: !S.sound }, () => { this.prefsSave(); if (this.state.sound) playSound('move'); }),
      analyzeGame: () => { const g = S.g; if (g) this.loadPgnToAna(this.pgnOf(g, false), g.userSide === 'b'); },
      copyPgn: () => { const g = S.g; if (!g) return; this.copyText(this.pgnOf(g, true), () => { clearTimeout(this.copyT); this.setState({ copied: true }); this.copyT = setTimeout(() => this.setState({ copied: false }), 2000); }); },
      copyLabel: S.copied ? 'Copied ✓' : 'Copy PGN',
      hasGames: S.stats.games.length > 0, importMsg: S.importMsg, importRef: el => this.importEl = el, onImportFile: this.onImportFile,
      downloadPgn: () => this.download('chess-games-' + localDay() + '.pgn', S.stats.games.map(gm => this.pgnFromArchive(gm)).join('\n\n'), 'application/x-chess-pgn'),
      exportData: () => this.download('chess-data-' + localDay() + '.json', JSON.stringify({ v: 1, exported: new Date().toISOString(), prefs: this.ls('prefs') || {}, stats: S.stats, daily: S.daily }, null, 1), 'application/json'),
      importData: () => { if (this.importEl) this.importEl.click(); },
    };
    if (!E) {
      const blank = Array.from({ length: 64 }, (_, di) => { const r = di >> 3, f = di & 7; return { bg: (r + f) % 2 ? '#cdc8bc' : '#f2f0ea', bs: 'none', anim: 'none', coR: '', coF: '', coC: 'transparent' }; });
      return Object.assign(out, {
        sqPlay: blank, sqPuz: blank, sqLearn: blank, sqAna: blank, pcPlay: [], pcPuz: [], pcLearn: [], pcAna: [],
        noGame: true, inGame: false, isBotMode: true, promoOpen: false, dimOn: false, ringOn: false, ringX: 0, ringY: 0,
        topName: '', topRating: '', topClock: '—', topClockC: 'var(--sub)', topClockB: 'transparent', topClockA: 'none', botName: '', botRating: '', botClock: '—', botClockC: 'var(--sub)', botClockB: 'transparent', botClockA: 'none',
        startLabel: 'Loading…', startGame: () => { }, moveRows: [], puzCats: [], openingRows: [], gameRows: [], anaTokens: [], evalPct: 50, evalText: '…', evalMeta: '', deeperLabel: '', chartPts: '', chartMin: '', chartMax: '',
        modeBotBg: 'var(--ink)', modeBotC: 'var(--bg)', modeLocalBg: 'transparent', modeLocalC: 'var(--sub)', isLocalMode: false, levelDots: [], tcTiles: [], botImg: this.pieceSrc('k'), wKSrc: this.pieceSrc('K'), bKSrc: this.pieceSrc('k'), botPersona: '', botDesc: '', botRatingSetup: '', sideWSh: 'none', sideBSh: 'none', sideRSh: 'none',
        sideW: () => { }, sideB: () => { }, sideR: () => { }, sideWBd: 'var(--line)', sideBBd: 'var(--line)', sideRBd: 'var(--line)',
        setModeBot: () => { }, setModeLocal: () => { },
        flipBoard: () => { }, canTakeback: false, canResign: false, isOver: false, gameTitle: '', statusLine: '', statusC: 'var(--sub)', statusAnim: 'none', resultTitle: '', resultSub: '', rematch: () => { }, newGame: () => { },
        promoQ: () => { }, promoR: () => { }, promoN: () => { }, promoB: () => { },
        puzTitle: '', puzCatLabel: '', puzObjective: '', puzMsg: '', puzMsgC: 'var(--sub)', puzMeta: '', puzStreakLine: '', puzHint: () => { }, puzReveal: () => { }, puzNext: () => { }, puzRating: '', puzSolvedCount: '', dailyStreak: '',
        learnPrev: () => { }, learnNext: () => { }, toggleLearnAuto: () => { }, learnAutoLabel: '▶ Autoplay', learnAutoBd: 'var(--line)', learnProgress: '', learnMoveSan: '', learnDesc: '',
        anaStart: () => { }, anaPrev: () => { }, anaNext: () => { }, anaEnd: () => { }, anaFlip: () => { }, anaReset: () => { }, anaDeeper: () => { }, anaLoadFen: () => { }, anaImportPgn: () => { }, anaLoadLast: () => { }, anaNote: '',
        stRating: '', stWdl: '', stGames: '', stPuz: '', stStreak: '', noGamesNote: '',
      });
    }
    // PLAY
    const g = S.g;
    const ghost = !g;
    const playBoard = this.PL.play ? this.PL.play.board : E.init().b;
    let checkSqP = -1;
    if (g && !g.over && E.inCheck(g.st)) checkSqP = g.st.b.indexOf(g.st.t === 'w' ? 'K' : 'k');
    const ov = (k) => this.drag && this.drag.key === k ? this.drag.over : -1;
    out.sqPlay = this.buildSquares(playBoard, { flip: S.flip, sel: S.sel, targets: S.targets, last: g && g.hist.length ? this.lastFT(g) : null, checkSq: checkSqP, over: ov('play'), onClick: (i) => this.clickPlay(i) });
    const dragColorPlay = g && !g.over && !S.promo && !S.thinking ? (g.mode === 'local' ? g.st.t : (g.st.t === g.userSide ? g.userSide : null)) : null;
    out.pcPlay = this.pcFor('play', S.flip, dragColorPlay);
    out.noGame = !g; out.inGame = !!g;
    const fg = this.games[S.ghostIdx] || this.games[0];
    out.ghostTitle = fg.white + ' \u2013 ' + fg.black + ' \u00b7 ' + fg.event + ' ' + fg.year; out.ghostWhy = fg.why;
    out.ghostPrev = () => this.ghostSet((S.ghostIdx - 1 + this.games.length) % this.games.length, true);
    out.ghostNext = () => this.ghostSet((S.ghostIdx + 1) % this.games.length, true);
    out.ghostOpen = () => this.loadPgnToAna(fg.moves, false);
    const su = S.setup;
    out.isBotMode = su.mode === 'bot';
    out.setModeBot = () => this.setState({ setup: { ...su, mode: 'bot' } });
    out.setModeLocal = () => this.setState({ setup: { ...su, mode: 'local' } });
    const chip = (on) => ({ bd: on ? 'var(--acc)' : 'var(--line)', bg: on ? 'var(--soft)' : 'transparent', fg: 'var(--ink)', w: on ? '600' : '400' });
    const tile = (on) => ({ bd: on ? 'var(--ink)' : 'var(--line)', sh: on ? '0 0 0 1px var(--ink)' : 'none' });
    out.sideW = () => this.setState({ setup: { ...su, side: 'white' } }); out.sideB = () => this.setState({ setup: { ...su, side: 'black' } }); out.sideR = () => this.setState({ setup: { ...su, side: 'random' } });
    Object.assign(out, { sideWBd: tile(su.side === 'white').bd, sideWSh: tile(su.side === 'white').sh, sideBBd: tile(su.side === 'black').bd, sideBSh: tile(su.side === 'black').sh, sideRBd: tile(su.side === 'random').bd, sideRSh: tile(su.side === 'random').sh });
    out.isLocalMode = su.mode === 'local';
    out.modeBotBg = su.mode === 'bot' ? 'var(--ink)' : 'transparent'; out.modeBotC = su.mode === 'bot' ? 'var(--bg)' : 'var(--sub)';
    out.modeLocalBg = su.mode === 'local' ? 'var(--ink)' : 'transparent'; out.modeLocalC = su.mode === 'local' ? 'var(--bg)' : 'var(--sub)';
    const PERS = { 1: ['Beginner', 'Knows the rules, little else. Hangs pieces.'], 2: ['Novice', 'Spots some captures, still drops pieces.'], 3: ['Casual', 'Grabs free material, misses most tactics.'], 4: ['Improver', 'Develops sensibly, sees one move ahead.'], 5: ['Club player', 'Solid basics and two-move tactics.'], 6: ['Tournament player', 'Punishes loose pieces, plans a little.'], 7: ['Expert', 'Searches deeper and wins won endgames.'], 8: ['Master', 'Stockfish, handicapped. Rarely hangs a piece.'], M: ['Stockfish', 'Full engine strength. Nobody beats this.'] };
    const LV = [1, 2, 3, 4, 5, 6, 7, 8, 'M'], lvIdx = LV.indexOf(su.level);
    out.levelDots = LV.map((l, i) => ({ label: l === 'M' ? 'Max' : String(l), h: 8 + i * 3, bg: i <= lvIdx ? 'var(--ink)' : 'var(--line)', fg: i === lvIdx ? 'var(--ink)' : 'var(--sub)', w: i === lvIdx ? '600' : '400', click: () => this.setState({ setup: { ...su, level: l } }) }));
    out.botPersona = PERS[su.level][0]; out.botDesc = PERS[su.level][1];
    out.botRatingSetup = String(E.BOT_LEVELS[su.level].rating) + (su.level === 'M' ? '+' : '');
    out.botImg = this.pieceSrc(su.side === 'black' ? 'K' : 'k');
    out.wKSrc = this.pieceSrc('K'); out.bKSrc = this.pieceSrc('k');
    const TCL = { 'None': ['∞', 'No clock'], '1+0': ['1+0', 'Bullet'], '3+2': ['3+2', 'Blitz'], '5+0': ['5+0', 'Blitz'], '10+5': ['10+5', 'Rapid'], '30+0': ['30+0', 'Classical'] };
    out.tcTiles = Object.keys(this.TC).map(k => ({ big: TCL[k][0], small: TCL[k][1], ...tile(su.tc === k), click: () => this.setState({ setup: { ...su, tc: k } }) }));
    out.startGame = this.startGame;
    out.startLabel = '▶ Play';
    const tSide = S.flip ? 'w' : 'b', bSide = tSide === 'w' ? 'b' : 'w';
    const plate = (sideCh) => {
      if (!g) { const fg = this.games[S.ghostIdx] || this.games[0]; return sideCh === 'w' ? [fg.white, fg.event + ' ' + fg.year] : [fg.black, '']; }
      if (g.mode === 'local') return sideCh === 'w' ? ['White', ''] : ['Black', ''];
      if (g.userSide === sideCh) return ['You', String(S.stats.rating)];
      return [this.botName(g), String(this.botRating(g.level, g.sfFallback))];
    };
    const [tn, tr2] = plate(tSide), [bn, br] = plate(bSide);
    out.topName = tn; out.topRating = tr2; out.botName = bn; out.botRating = br;
    out.topClock = g && g.tc ? this.fmtClock(g.clocks[tSide]) : '—';
    out.botClock = g && g.tc ? this.fmtClock(g.clocks[bSide]) : '—';
    const active = g && !g.over && g.running ? g.st.t : null;
    const low = (side) => g && g.tc && active === side && g.clocks[side] < 20000;
    out.topClockC = low(tSide) ? '#c0392b' : active === tSide ? 'var(--ink)' : 'var(--sub)'; out.topClockB = active === tSide ? (low(tSide) ? '#c0392b' : 'var(--acc)') : 'transparent';
    out.botClockC = low(bSide) ? '#c0392b' : active === bSide ? 'var(--ink)' : 'var(--sub)'; out.botClockB = active === bSide ? (low(bSide) ? '#c0392b' : 'var(--acc)') : 'transparent';
    out.topClockA = low(tSide) ? 'ocpulse 1s ease-in-out infinite' : 'none';
    out.botClockA = low(bSide) ? 'ocpulse 1s ease-in-out infinite' : 'none';
    out.flipBoard = () => { this.flipAt = Date.now(); this.setState({ flip: !S.flip }); };
    out.canTakeback = !!(g && !g.over && g.mode === 'bot' && g.hist.length); out.takeback = this.takeback;
    out.canResign = !!(g && !g.over); out.resign = this.resign;
    out.isOver = !!(g && g.over);
    out.dimOn = !!(g && g.over);
    out.ringOn = !!(g && g.over && g.over.winner);
    if (out.ringOn) {
      const ksq = g.st.b.indexOf(g.over.winner === 'w' ? 'K' : 'k');
      const di = S.flip ? 63 - ksq : ksq;
      out.ringX = (di & 7) * bpx; out.ringY = (di >> 3) * bpx;
    } else { out.ringX = 0; out.ringY = 0; }
    out.gameTitle = g ? (g.mode === 'bot' ? 'You vs ' + (g.level === 'M' ? (g.sfFallback ? 'Stockfish — unavailable, the built-in engine is playing' : 'Stockfish') : 'Level ' + g.level + (g.sfFallback ? ' (Stockfish unavailable, the built-in engine is playing)' : '')) : 'Pass & play') : '';
    out.statusLine = !g ? '' : g.over ? g.over.title + '.' : S.thinking ? 'Thinking…' : (g.mode === 'local' ? (g.st.t === 'w' ? 'White' : 'Black') + ' to move.' : g.st.t === g.userSide ? (E.inCheck(g.st) ? 'Check.' : 'Your move.') : 'Waiting…');
    out.statusC = g && !g.over && E.inCheck(g.st) ? '#e5534b' : 'var(--ink)';
    out.statusAnim = S.thinking ? 'ocblink 1.6s infinite' : 'none';
    out.resultTitle = g && g.over ? g.over.title : '';
    out.resultSub = g && g.over ? ('by ' + g.over.reason + (S.lastDelta != null ? ' · rating ' + (S.lastDelta >= 0 ? '+' : '') + S.lastDelta : '')) : '';
    out.rematch = this.rematch;
    out.newGame = this.discardGame;
    out.promoOpen = !!S.promo;
    out.promoQ = () => this.completePromo('q'); out.promoR = () => this.completePromo('r'); out.promoN = () => this.completePromo('n'); out.promoB = () => this.completePromo('b');
    out.moveRows = [];
    if (g) for (let i = 0; i < g.hist.length; i += 2) out.moveRows.push({ n: i / 2 + 1, w: g.hist[i].san, b: g.hist[i + 1] ? g.hist[i + 1].san : '', wW: i === g.hist.length - 1 ? '600' : '400', bW: i + 1 === g.hist.length - 1 ? '600' : '400' });
    // PUZZLES
    const z = S.puz;
    let checkSqZ = -1;
    if (z && E.inCheck(z.st)) checkSqZ = z.st.b.indexOf(z.st.t === 'w' ? 'K' : 'k');
    out.sqPuz = z ? this.buildSquares(this.PL.puz.board, { flip: z.userSide === 'b', sel: z.sel, targets: z.targets, last: z.last, hint: z.hint, flash: z.flash, checkSq: checkSqZ, over: ov('puz'), onClick: (i) => this.clickPuz(i), coords: false }) : out.sqPlay;
    out.pcPuz = z ? this.pcFor('puz', z.userSide === 'b', z.phase === 'solving' && z.st.t === z.userSide ? z.userSide : null) : [];
    out.puzTitle = z ? (z.isDaily ? 'Daily puzzle' : 'Puzzle') + ' \u00b7 ' + z.p.rating : S.puzLoad === 'error' ? 'Puzzles unavailable' : 'Loading puzzles\u2026';
    out.puzCatLabel = z ? (z.phase === 'solved' || z.phase === 'revealed' ? this.puzThemeLabel(z.p) : z.p.band[0].toUpperCase() + z.p.band.slice(1)) : '';
    out.puzObjective = z ? this.puzObjectiveText(z) : '';
    out.puzMsg = z ? z.msg : S.puzLoad === 'error' ? 'The puzzle file could not be loaded. Check the connection, then hit next to try again.' : '';
    out.puzMsgC = z ? (z.msgC === 'ok' ? '#2c7a4b' : z.msgC === 'bad' ? '#c0392b' : 'var(--sub)') : S.puzLoad === 'error' ? '#c0392b' : 'var(--sub)';
    out.puzMeta = z ? (z.phase === 'intro' ? 'The opponent moves first\u2026' : z.phase === 'solving' ? 'Drag a piece or tap-tap to move.' : z.phase === 'solved' ? 'Nice. Hit next for another.' : z.phase === 'revealing' ? 'Watching the solution\u2026' : 'Study the line, then hit next.') : '';
    out.puzLink = z && (z.phase === 'solved' || z.phase === 'revealed') ? 'https://lichess.org/training/' + z.p.id : '';
    const today = localDay();
    out.puzStreakLine = S.daily.last === today ? 'Today\u2019s puzzle solved \u00b7 streak ' + S.daily.streak : S.daily.done === today ? 'Today\u2019s puzzle done \u00b7 the streak counts first-try solves.' : 'Today\u2019s puzzle is waiting.';
    out.puzHint = this.puzHint; out.puzReveal = this.puzReveal; out.puzNext = this.puzNext;
    out.puzCats = PUZ_CATS.map(c => ({ label: c.label, ...chip(S.puzCat === c.label), click: () => this.setCat(c.label) }));
    out.puzBands = PUZ_BANDS.map(b => ({ label: b, ...chip(S.puzBand === b), click: () => this.setBand(b) }));
    out.puzRating = S.stats.puzzleRating; out.puzSolvedCount = S.stats.puzzlesSolved; out.dailyStreak = this.liveStreak(S.daily);
    // LEARN
    const L = S.learn, li = this.learnItem(L);
    out.sqLearn = this.buildSquares(this.PL.learn.board, { flip: false, coords: false });
    out.pcLearn = this.pcFor('learn', false, null);
    out.learnPrev = () => this.learnStep(-1); out.learnNext = () => this.learnStep(1);
    out.toggleLearnAuto = this.toggleLearnAuto;
    out.learnAutoLabel = S.learnAuto ? '\u23f8 Pause' : '\u25b6 Autoplay';
    out.learnAutoBd = S.learnAuto ? 'var(--acc)' : 'var(--line)';
    out.learnProgress = 'move ' + L.ply + ' / ' + (li.steps.length - 1);
    out.learnMoveSan = L.ply ? li.steps[L.ply].san : '';
    out.learnTitle = li.title + ' \u00b7 ' + li.sub;
    out.learnDesc = li.desc;
    out.learnSub = L.kind === 'game' ? 'Fifty games worth replaying, from 1851 to today.' : 'Eight openings worth knowing, move by move.';
    out.learnKinds = [['opening', 'Openings'], ['game', 'Famous games']].map(([k, label]) => ({ label, ...chip(L.kind === k), click: () => this.learnKind(k) }));
    out.openingRows = L.kind === 'game'
      ? this.games.map((g, i) => ({ name: g.white + ' \u2013 ' + g.black, eco: String(g.year), w: i === L.sel ? '600' : '400', c: i === L.sel ? 'var(--acc)' : 'var(--ink)', click: () => this.learnSel(i) }))
      : this.openings.map((o, i) => ({ name: o.name, eco: o.eco, w: i === L.sel ? '600' : '400', c: i === L.sel ? 'var(--acc)' : 'var(--ink)', click: () => this.learnSel(i) }));
    // ANALYSIS
    const A = S.ana;
    if (A.hist.length) {
      const ast = E.fromFEN(A.hist[A.ptr].fen);
      let checkSqA = -1;
      if (E.inCheck(ast)) checkSqA = ast.b.indexOf(ast.t === 'w' ? 'K' : 'k');
      out.sqAna = this.buildSquares(this.PL.ana.board, { flip: A.flip, sel: this.anaSel ?? -1, targets: this.anaTargets || [], checkSq: checkSqA, over: ov('ana'), onClick: (i) => this.clickAna(i), coords: false, best: A.best });
      out.pcAna = this.pcFor('ana', A.flip, ast.t);
      const cp = this.cpShow ?? A.cp;
      out.evalPct = Math.max(4, Math.min(96, 50 + 50 * (2 / (1 + Math.exp(-(A.cp) / 350)) - 1)));
      out.evalText = A.mate ? (A.mate > 0 ? '+M' : '\u2212M') + Math.abs(A.mate) : Math.abs(A.cp) > 8000 ? (A.cp > 0 ? '+M' : '\u2212M') : (cp >= 0 ? '+' : '\u2212') + (Math.abs(cp) / 100).toFixed(2);
      out.evalMeta = A.engine === 'sf' ? 'Stockfish 10 \u00b7 depth ' + A.depth + (A.busy ? '\u2026' : '') : A.engine === 'end' ? 'no legal moves' : A.busy ? 'thinking\u2026' : 'depth ' + A.depth + ' \u00b7 built-in engine';
      out.deeperLabel = this.sfFailed ? 'Deeper (d4)' : 'Deeper (4 s)';
      out.anaBestLine = A.pvSan || '';
      out.anaDeeper = () => this.anaEval(4);
      out.anaTokens = A.hist.slice(1).map((h, i) => ({ label: (i % 2 === 0 ? (i / 2 + 1) + '. ' : '') + h.san, bg: A.ptr === i + 1 ? 'var(--soft)' : 'transparent', fg: 'var(--ink)', w: A.ptr === i + 1 ? '600' : '400', click: () => this.anaJump(i + 1) }));
      out.anaStart = () => this.anaJump(0); out.anaEnd = () => this.anaJump(A.hist.length - 1);
      out.anaPrev = () => this.anaJump(Math.max(0, A.ptr - 1)); out.anaNext = () => this.anaJump(Math.min(A.hist.length - 1, A.ptr + 1));
      out.anaFlip = () => { this.flipAt = Date.now(); this.setState({ ana: { ...A, flip: !A.flip } }); };
      out.anaReset = () => this.anaSetHist([{ san: '', fen: E.START }], 0, false);
      out.anaLoadFen = this.anaFen; out.anaImportPgn = this.anaImport; out.anaLoadLast = this.anaLoadLast;
      out.anaNote = 'Moves you play on the board branch from the current position. Promotions auto-queen here.';
    }
    // STATS
    const st = S.stats;
    out.stRating = this.easeStat(st.rating); out.stWdl = this.easeStat(st.w) + ' / ' + this.easeStat(st.d) + ' / ' + this.easeStat(st.l); out.stGames = this.easeStat(st.w + st.d + st.l); out.stPuz = this.easeStat(st.puzzlesSolved); out.stStreak = this.easeStat(this.liveStreak(S.daily));
    const hist = st.ratingHist.length ? st.ratingHist : [{ r: st.rating }];
    const rs = hist.map(h => h.r), mn = Math.min(...rs) - 20, mx = Math.max(...rs) + 20;
    out.chartMin = 'low ' + Math.min(...rs); out.chartMax = 'high ' + Math.max(...rs);
    out.chartPts = rs.length === 1 ? '0,' + (120 - (rs[0] - mn) / (mx - mn) * 100 - 10) + ' 560,' + (120 - (rs[0] - mn) / (mx - mn) * 100 - 10) : rs.map((r, i) => (i / (rs.length - 1) * 560).toFixed(1) + ',' + (120 - ((r - mn) / (mx - mn)) * 100).toFixed(1)).join(' ');
    out.gameRows = st.games.map((gm) => ({ d: gm.d, opp: gm.opp, res: gm.res, tc: gm.tc, len: gm.n + ' moves', click: () => this.loadPgnToAna(gm.pgn, gm.side === 'b') }));
    out.noGamesNote = st.games.length ? '' : 'No games yet — play one and it lands here.';
    return out;
  }
  lastFT(g) {
    const E = this.E, h = g.hist[g.hist.length - 1];
    if (!h) return null;
    return { f: E.idx(h.uci.slice(0, 2)), t: E.idx(h.uci.slice(2, 4)) };
  }
  render() { return renderTpl(React.createElement, React.Fragment, this.renderVals()); }
}
