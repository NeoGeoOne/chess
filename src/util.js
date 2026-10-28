// Pure helpers used by the app (no React, no DOM). Everything here is unit-tested in tests/util.test.js.

// ---------- saved data (validate everything read from storage or imported) ----------
export const DEFAULT_STATS = { rating: 1200, puzzleRating: 1000, w: 0, d: 0, l: 0, puzzlesSolved: 0, puzzlesRated: 0, ratingHist: [], games: [], solved: [] };
export const PREF_KEYS = ['dark', 'boardTheme', 'pieceSet', 'coords', 'level', 'tc', 'sound', 'autoFlip', 'ghostIdx'];

export const obj = x => (x && typeof x === 'object' && !Array.isArray(x)) ? x : {};
export const int = (x, d, min = 0, max = 1e9) => (Number.isInteger(x) && x >= min && x <= max) ? x : d;
export const str = (x, max = 200) => typeof x === 'string' ? x.slice(0, max) : '';

export function sanitizeStats(st) {
  st = obj(st);
  const o = { ...DEFAULT_STATS };
  o.rating = int(st.rating, o.rating, 100, 4000); o.puzzleRating = int(st.puzzleRating, o.puzzleRating, 100, 4000);
  for (const k of ['w', 'd', 'l', 'puzzlesSolved', 'puzzlesRated']) o[k] = int(st[k], 0);
  if (st.puzzlesRated == null) o.puzzlesRated = o.puzzlesSolved; // saves from before the K schedule: an established solver is not a newcomer
  o.ratingHist = Array.isArray(st.ratingHist) ? st.ratingHist.filter(h => h && Number.isFinite(h.t) && Number.isFinite(h.r)).map(h => ({ t: h.t, r: h.r })).slice(-60) : [];
  o.solved = Array.isArray(st.solved) ? st.solved.filter(x => typeof x === 'string' && x.length < 16).slice(-4000) : []; // the set has 2000 puzzles; a puzzle is rated once, so solved ids must not fall off
  o.games = Array.isArray(st.games) ? st.games.filter(g => g && typeof g === 'object').map(g => ({ d: str(g.d, 10), opp: str(g.opp, 40), res: str(g.res, 8), side: g.side === 'b' ? 'b' : 'w', tc: str(g.tc, 8), pgn: str(g.pgn, 20000), n: int(g.n, 0) })).slice(0, 50) : [];
  return o;
}
export function sanitizeDaily(d) {
  d = obj(d);
  const day = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  return { last: day(d.last), done: day(d.done), streak: int(d.streak, 0), best: int(d.best, 0) };
}
// Preferences: every value checked against the known lists; unknown or malformed values fall back to defaults.
export function sanitizePrefs(p, { themes, tcs, pieceSets, defaultPieces, gamesCount, defaultLevel = 4, defaultTc = '10+5' }) {
  p = obj(p);
  return {
    dark: p.dark !== false, sound: p.sound === true, autoFlip: p.autoFlip !== false, coords: p.coords !== false,
    boardTheme: themes.includes(p.boardTheme) ? p.boardTheme : themes[0],
    pieceSet: pieceSets.includes(p.pieceSet) ? p.pieceSet : defaultPieces,
    level: (p.level === 'M' || (Number.isInteger(p.level) && p.level >= 1 && p.level <= 8)) ? p.level : defaultLevel,
    tc: tcs.includes(p.tc) ? p.tc : defaultTc,
    ghostIdx: int(p.ghostIdx, 0, 0, Math.max(0, gamesCount - 1)),
  };
}
export const pickPrefs = p => Object.fromEntries(PREF_KEYS.filter(k => k in obj(p)).map(k => [k, p[k]]));

// ---------- ratings ----------
export function eloDelta(R, P, score, K = 32) { const exp = 1 / (1 + Math.pow(10, (P - R) / 400)); return Math.round(K * (score - exp)); }
// K as in FIDE: new players move fast, established ones slowly. n = rated results so far.
export const kFactor = (n, rating) => n < 30 ? 40 : rating >= 2400 ? 10 : 20;
// Calendar days in the visitor's local time zone (the daily puzzle and its streak follow the visitor's midnight, not UTC)
export const localDay = (t = Date.now()) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
export const dayIndex = (t = Date.now()) => Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 86400000);
export const prevDay = day => { const [y, m, d] = day.split('-').map(Number); return localDay(new Date(y, m - 1, d - 1).getTime()); }; // calendar arithmetic, safe across DST days
export const signed = d => (d > 0 ? '+' : '\u2212') + Math.abs(d);
// A fixed pseudo-random order of n items (Fisher–Yates over a seeded LCG). The puzzle set is sorted by rating, so
// indexing it by day number would make the daily puzzle harder every day for years; this walks the set in a fixed shuffle.
export function seededOrder(n, seed = 20260913) {
  const a = Array.from({ length: n }, (_, i) => i); let s = seed >>> 0;
  const r = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- puzzles (lichess set) ----------
export const PUZ_CATS = [{ label: 'Daily' }, { label: 'All' }, { label: 'Mate in 1', theme: 'mateIn1' }, { label: 'Mate in 2', theme: 'mateIn2' }, { label: 'Mate in 3', theme: 'mateIn3' }, { label: 'Fork', theme: 'fork' }, { label: 'Pin', theme: 'pin' }, { label: 'Skewer', theme: 'skewer' }, { label: 'Discovered', theme: 'discoveredAttack' }, { label: 'Back rank', theme: 'backRankMate' }, { label: 'Endgame', theme: 'endgame' }];
export const PUZ_BANDS = ['Any', 'Easy', 'Medium', 'Hard'];
export const puzBand = rating => rating < 1200 ? 'easy' : rating < 1800 ? 'medium' : 'hard';
export function puzThemeLabel(p) { const c = PUZ_CATS.find(x => x.theme && p.themes.includes(x.theme)); return c ? c.label : 'Tactics'; }

// ---------- Stockfish (UCI) and analysis text ----------
// Parses one `info …` line into {depth, cpStm, mateStm, pv}; scores are from the side to move. Returns null for
// lines without a usable score/pv, bound-only scores and secondary multipv lines.
export function sfParseInfo(line) {
  if (typeof line !== 'string' || !line.startsWith('info ')) return null;
  if (/\b(upperbound|lowerbound)\b/.test(line) || / multipv ([2-9]|\d\d)/.test(line)) return null;
  const d = / depth (\d+)/.exec(line), sc = / score (cp|mate) (-?\d+)/.exec(line), pv = / pv (.+)$/.exec(line);
  if (!d || !sc || !pv) return null;
  const v = +sc[2];
  return { depth: +d[1], cpStm: sc[1] === 'cp' ? v : (v > 0 ? 10000 - v : -10000 - v), mateStm: sc[1] === 'mate' ? v : null, pv: pv[1].trim().split(/\s+/) };
}
// "4. O-O Nxe4 5. Nc3" for a white-to-move position, "1… e5 2. Nf3" when black is to move.
export function pvToSan(E, st, pv, max = 8) {
  let s = E.clone(st); const out = [];
  for (const uci of (pv || []).slice(0, max)) {
    const m = E.moveFromUci(s, uci); if (!m) break;
    const n = s.t === 'w' ? s.fm + '. ' : (out.length ? '' : s.fm + '\u2026 ');
    out.push(n + E.sanFor(s, m)); s = E.applyMove(s, m);
  }
  return out.join(' ');
}
export const uciSquares = (E, uci) => (typeof uci === 'string' && uci.length >= 4) ? { f: E.idx(uci.slice(0, 2)), t: E.idx(uci.slice(2, 4)) } : null;

// ---------- PGN ----------
const pgnDate = d => d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
const tag = (k, v) => '[' + k + ' "' + String(v).replace(/["\\]/g, '') + '"]';
// Movetext (+ result) for a game object of the app; with headers, a complete PGN.
// PGN Site tag: the page the game was played on, '?' (unknown) outside a browser
const pgnSite = () => (typeof location !== 'undefined' && /^https?:/.test(location.protocol) ? location.origin + location.pathname : '?');
export function pgnOf(g, headers, now = new Date()) {
  const mt = g.hist.map((h, i) => (i % 2 === 0 ? (i / 2 + 1) + '. ' : '') + h.san).join(' ');
  const res = g.over ? (g.over.winner === null ? '1/2-1/2' : g.over.winner === 'w' ? '1-0' : '0-1') : '*';
  if (!headers) return mt + (mt ? ' ' : '') + res;
  const bot = g.level === 'M' ? (g.sfFallback ? 'Engine (Max, fallback)' : 'Stockfish 10') : g.sf && !g.sfFallback ? 'Stockfish 10 (level ' + g.level + ')' : 'Engine level ' + g.level + (g.sfFallback ? ' (fallback)' : '');
  const w = g.mode === 'local' ? 'White' : g.userSide === 'w' ? 'You' : bot, b = g.mode === 'local' ? 'Black' : g.userSide === 'b' ? 'You' : bot;
  const tags = [['Event', 'Casual game'], ['Site', pgnSite()], ['Date', pgnDate(now)], ['Round', '-'], ['White', w], ['Black', b], ['Result', res], ['TimeControl', g.tc ? g.tc[0] + '+' + g.tc[1] : '-']];
  if (g.over) tags.push(['Termination', g.over.reason]);
  return tags.map(([k, v]) => tag(k, v)).join('\n') + '\n\n' + mt + (mt ? ' ' : '') + res + '\n';
}
// Archive entries saved before headers existed carry only the movetext; rebuild the headers from the row.
export function pgnFromArchive(gm) {
  if (typeof gm.pgn === 'string' && gm.pgn.startsWith('[')) return gm.pgn;
  const res = gm.res === '1\u20130' ? '1-0' : gm.res === '0\u20131' ? '0-1' : gm.res === '\u00bd\u2013\u00bd' ? '1/2-1/2' : '*';
  const w = gm.side === 'w' ? 'You' : gm.opp, b = gm.side === 'b' ? 'You' : gm.opp;
  return [tag('Event', 'Casual game'), tag('Site', pgnSite()), tag('Date', String(gm.d || '').replace(/-/g, '.')), tag('Round', '-'), tag('White', w), tag('Black', b), tag('Result', res)].join('\n') + '\n\n' + (gm.pgn || '') + ' ' + res + '\n';
}
