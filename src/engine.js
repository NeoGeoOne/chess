// OpenChess engine: rules, FEN/SAN/PGN, eval, search, mate verification.
const FL = 'abcdefgh';
export const alg = i => FL[i & 7] + (8 - (i >> 3));
export const idx = a => FL.indexOf(a[0]) + (8 - +a[1]) * 8;
const isW = p => p >= 'A' && p <= 'Z';
const KN = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const KG = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const DIA = [[-1,-1],[-1,1],[1,-1],[1,1]], ORT = [[-1,0],[1,0],[0,-1],[0,1]];
export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function fromFEN(fen) {
  const p = fen.trim().split(/\s+/), b = Array(64).fill(null);
  let i = 0;
  for (const ch of p[0]) { if (ch === '/') continue; if (ch >= '1' && ch <= '8') i += +ch; else b[i++] = ch; }
  return { b, t: p[1] || 'w', c: { K: /K/.test(p[2] || ''), Q: /Q/.test(p[2] || ''), k: /k/.test(p[2] || ''), q: /q/.test(p[2] || '') }, ep: p[3] && p[3] !== '-' ? idx(p[3]) : -1, hm: +(p[4] || 0), fm: +(p[5] || 1) };
}
export function toFEN(s) {
  let out = '';
  for (let r = 0; r < 8; r++) { let e = 0; for (let f = 0; f < 8; f++) { const p = s.b[r * 8 + f]; if (!p) e++; else { if (e) { out += e; e = 0; } out += p; } } if (e) out += e; if (r < 7) out += '/'; }
  const c = (s.c.K ? 'K' : '') + (s.c.Q ? 'Q' : '') + (s.c.k ? 'k' : '') + (s.c.q ? 'q' : '');
  return out + ' ' + s.t + ' ' + (c || '-') + ' ' + (s.ep >= 0 ? alg(s.ep) : '-') + ' ' + s.hm + ' ' + s.fm;
}
export const init = () => fromFEN(START);
export const clone = s => ({ b: s.b.slice(), t: s.t, c: { ...s.c }, ep: s.ep, hm: s.hm, fm: s.fm });
const kingSq = (s, w) => s.b.indexOf(w ? 'K' : 'k');

export function attacked(s, sq, byW) {
  const r = sq >> 3, f = sq & 7;
  const pr = byW ? r + 1 : r - 1, pp = byW ? 'P' : 'p';
  if (pr >= 0 && pr < 8) { if (f > 0 && s.b[pr * 8 + f - 1] === pp) return true; if (f < 7 && s.b[pr * 8 + f + 1] === pp) return true; }
  for (const [dr, df] of KN) { const nr = r + dr, nf = f + df; if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue; const p = s.b[nr * 8 + nf]; if (p && isW(p) === byW && (p === 'N' || p === 'n')) return true; }
  for (const [dr, df] of KG) { const nr = r + dr, nf = f + df; if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue; const p = s.b[nr * 8 + nf]; if (p && isW(p) === byW && (p === 'K' || p === 'k')) return true; }
  for (const [dr, df] of DIA) { let nr = r + dr, nf = f + df; while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) { const p = s.b[nr * 8 + nf]; if (p) { const l = p.toLowerCase(); if (isW(p) === byW && (l === 'b' || l === 'q')) return true; break; } nr += dr; nf += df; } }
  for (const [dr, df] of ORT) { let nr = r + dr, nf = f + df; while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) { const p = s.b[nr * 8 + nf]; if (p) { const l = p.toLowerCase(); if (isW(p) === byW && (l === 'r' || l === 'q')) return true; break; } nr += dr; nf += df; } }
  return false;
}
export const inCheck = (s, w) => attacked(s, kingSq(s, w === undefined ? s.t === 'w' : w), !(w === undefined ? s.t === 'w' : w));

function genPseudo(s, capsOnly) { // capsOnly: captures and promotions, for the quiescence search
  const ms = [], w = s.t === 'w';
  for (let i = 0; i < 64; i++) {
    const p = s.b[i]; if (!p || isW(p) !== w) continue;
    const r = i >> 3, f = i & 7, l = p.toLowerCase();
    if (l === 'p') {
      const dir = w ? -8 : 8, one = i + dir, promoRank = w ? 0 : 7;
      if (one >= 0 && one < 64 && !s.b[one]) {
        if ((one >> 3) === promoRank) { for (const pr of ['q', 'r', 'b', 'n']) ms.push({ f: i, t: one, p, promo: pr }); }
        else if (!capsOnly) {
          ms.push({ f: i, t: one, p });
          const startRank = w ? 6 : 1;
          if (r === startRank && !s.b[i + 2 * dir]) ms.push({ f: i, t: i + 2 * dir, p, flag: 'd' });
        }
      }
      for (const df of [-1, 1]) {
        const nf = f + df; if (nf < 0 || nf > 7) continue;
        const t = one + df; if (t < 0 || t > 63) continue;
        const tp = s.b[t];
        if (tp && isW(tp) !== w) {
          if ((t >> 3) === promoRank) { for (const pr of ['q', 'r', 'b', 'n']) ms.push({ f: i, t, p, cap: tp, promo: pr }); }
          else ms.push({ f: i, t, p, cap: tp });
        } else if (t === s.ep) ms.push({ f: i, t, p, cap: w ? 'p' : 'P', flag: 'e' });
      }
    } else if (l === 'n' || l === 'k') {
      for (const [dr, df] of (l === 'n' ? KN : KG)) {
        const nr = r + dr, nf = f + df; if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
        const t = nr * 8 + nf, tp = s.b[t];
        if (tp ? isW(tp) !== w : !capsOnly) ms.push({ f: i, t, p, cap: tp || undefined });
      }
      if (l === 'k' && !capsOnly) {
        const home = w ? 60 : 4;
        if (i === home && !inCheck(s, w)) {
          if ((w ? s.c.K : s.c.k) && !s.b[home + 1] && !s.b[home + 2] && !attacked(s, home + 1, !w) && !attacked(s, home + 2, !w)) ms.push({ f: i, t: home + 2, p, flag: 'ck' });
          if ((w ? s.c.Q : s.c.q) && !s.b[home - 1] && !s.b[home - 2] && !s.b[home - 3] && !attacked(s, home - 1, !w) && !attacked(s, home - 2, !w)) ms.push({ f: i, t: home - 2, p, flag: 'cq' });
        }
      }
    } else {
      const dirs = l === 'b' ? DIA : l === 'r' ? ORT : DIA.concat(ORT);
      for (const [dr, df] of dirs) {
        let nr = r + dr, nf = f + df;
        while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
          const t = nr * 8 + nf, tp = s.b[t];
          if (!tp) { if (!capsOnly) ms.push({ f: i, t, p }); }
          else { if (isW(tp) !== w) ms.push({ f: i, t, p, cap: tp }); break; }
          nr += dr; nf += df;
        }
      }
    }
  }
  return ms;
}

export function make(s, m) {
  const u = { cap: null, capSq: -1, c: null, ep: s.ep, hm: s.hm, fm: s.fm };
  const w = s.t === 'w';
  s.ep = -1;
  if (m.flag === 'e') { u.capSq = m.t + (w ? 8 : -8); u.cap = s.b[u.capSq]; s.b[u.capSq] = null; }
  else if (m.cap !== undefined || s.b[m.t]) { u.capSq = m.t; u.cap = s.b[m.t]; }
  s.b[m.t] = m.promo ? (w ? m.promo.toUpperCase() : m.promo) : m.p;
  s.b[m.f] = null;
  if (m.flag === 'd') { // record the e.p. square only if an enemy pawn can actually take — keeps repetition detection exact
    const ep = w ? 'p' : 'P', tf = m.t & 7;
    if ((tf > 0 && s.b[m.t - 1] === ep) || (tf < 7 && s.b[m.t + 1] === ep)) s.ep = (m.f + m.t) / 2;
  }
  if (m.flag === 'ck') { s.b[m.t - 1] = s.b[m.t + 1]; s.b[m.t + 1] = null; }
  if (m.flag === 'cq') { s.b[m.t + 1] = s.b[m.t - 2]; s.b[m.t - 2] = null; }
  if (m.p === 'K' || m.p === 'k' || ROOK_HOME[m.f] || ROOK_HOME[m.t]) { // only these moves can change castling rights: copy on write
    u.c = s.c; s.c = { ...s.c };
    if (m.p === 'K') { s.c.K = s.c.Q = false; } if (m.p === 'k') { s.c.k = s.c.q = false; }
    if (m.f === 63 || m.t === 63) s.c.K = false; if (m.f === 56 || m.t === 56) s.c.Q = false;
    if (m.f === 7 || m.t === 7) s.c.k = false; if (m.f === 0 || m.t === 0) s.c.q = false;
  }
  s.hm = (m.p.toLowerCase() === 'p' || u.cap) ? 0 : s.hm + 1;
  if (!w) s.fm++;
  s.t = w ? 'b' : 'w';
  return u;
}
export function unmake(s, m, u) {
  const w = s.t === 'b'; // mover was white if now black to move
  s.t = w ? 'w' : 'b';
  s.b[m.f] = m.p; s.b[m.t] = null;
  if (u.cap) s.b[u.capSq] = u.cap;
  if (m.flag === 'ck') { s.b[m.t + 1] = s.b[m.t - 1]; s.b[m.t - 1] = null; }
  if (m.flag === 'cq') { s.b[m.t - 2] = s.b[m.t + 1]; s.b[m.t + 1] = null; }
  if (u.c) s.c = u.c; s.ep = u.ep; s.hm = u.hm; s.fm = u.fm;
}
const ROOK_HOME = { 0: true, 7: true, 56: true, 63: true };
const aligned = (a, b) => { const dr = (a >> 3) - (b >> 3), df = (a & 7) - (b & 7); return dr === 0 || df === 0 || dr === df || dr === -df; };

export function legalMoves(s, capsOnly) {
  const out = [], w = s.t === 'w', k = kingSq(s, w), chk = attacked(s, k, !w);
  for (const m of genPseudo(s, capsOnly)) {
    // Only a king move, an en-passant capture, a move out of check or a move of a piece standing on a line with the
    // king can leave the king attacked; every other move is legal without trying it out.
    if (!chk && m.p !== 'K' && m.p !== 'k' && m.flag !== 'e' && !aligned(m.f, k)) { out.push(m); continue; }
    const u = make(s, m);
    if (!attacked(s, m.p === 'K' || m.p === 'k' ? m.t : k, !w)) out.push(m);
    unmake(s, m, u);
  }
  return out;
}
export const applyMove = (s, m) => { const n = clone(s); make(n, m); return n; };

export function status(s, legal) {
  legal = legal || legalMoves(s);
  const chk = inCheck(s);
  if (!legal.length) return chk ? { over: true, mate: true, winner: s.t === 'w' ? 'b' : 'w' } : { over: true, stale: true };
  const pieces = s.b.filter(Boolean).map(p => p.toLowerCase()).filter(p => p !== 'k');
  let insuff = pieces.length === 0 || (pieces.length === 1 && (pieces[0] === 'n' || pieces[0] === 'b'));
  if (!insuff && pieces.every(p => p === 'b')) { // only bishops: all on one square colour = dead draw
    const cols = new Set(); s.b.forEach((p, i) => { if (p && p.toLowerCase() === 'b') cols.add(((i >> 3) + (i & 7)) & 1); });
    insuff = cols.size === 1;
  }
  if (insuff) return { over: true, insufficient: true };
  if (s.hm >= 100) return { over: true, fifty: true };
  return { over: false, check: chk };
}

export function sanFor(s, m, legal) {
  if (m.flag === 'ck' || m.flag === 'cq') { return suffix(s, m, m.flag === 'ck' ? 'O-O' : 'O-O-O'); }
  legal = legal || legalMoves(s);
  const l = m.p.toLowerCase();
  let out = '';
  if (l === 'p') { if (m.cap !== undefined) out = FL[m.f & 7] + 'x'; out += alg(m.t); if (m.promo) out += '=' + m.promo.toUpperCase(); }
  else {
    out = m.p.toUpperCase() === m.p ? m.p : m.p.toUpperCase();
    const others = legal.filter(x => x.p === m.p && x.t === m.t && x.f !== m.f);
    if (others.length) {
      const sameFile = others.some(x => (x.f & 7) === (m.f & 7)), sameRank = others.some(x => (x.f >> 3) === (m.f >> 3));
      if (!sameFile) out += FL[m.f & 7];
      else if (!sameRank) out += (8 - (m.f >> 3));
      else out += alg(m.f);
    }
    if (m.cap !== undefined) out += 'x';
    out += alg(m.t);
  }
  return suffix(s, m, out);
}
function suffix(s, m, san) {
  const n = applyMove(s, m);
  const lg = legalMoves(n);
  if (inCheck(n)) san += lg.length ? '+' : '#';
  return san;
}
const normSan = x => x.replace(/[+#!?]+$/g, '').replace(/0-0-0/, 'O-O-O').replace(/0-0/, 'O-O');
export function moveFromSan(s, san) {
  const target = normSan(san.trim()).replace(/^P/, '');
  const legal = legalMoves(s);
  if (target === 'O-O' || target === 'O-O-O') return legal.find(m => m.flag === (target === 'O-O' ? 'ck' : 'cq')) || null;
  // fast path: parse the token and match it against the legal moves directly (handles over-disambiguation,
  // missing 'x', e.p.); only when that is ambiguous is SAN generated for every legal move
  const mm = target.replace(/e\.p\./, '').match(/^([NBRQK]?)([a-h]?)([1-8]?)x?([a-h][1-8])(?:=?([NBRQ]))?$/);
  if (mm) {
    const [, pc, ff, fr, dest, promo] = mm;
    const w = s.t === 'w';
    const want = pc ? (w ? pc : pc.toLowerCase()) : (w ? 'P' : 'p');
    const t = idx(dest);
    const cands = legal.filter(m => m.t === t && m.p === want && (!ff || FL[m.f & 7] === ff) && (!fr || (8 - (m.f >> 3)) === +fr) && (promo ? m.promo === promo.toLowerCase() : !m.promo || m.promo === 'q'));
    if (cands.length === 1) return cands[0];
    if (!cands.length) return null;
  }
  for (const m of legal) if (normSan(sanFor(s, m, legal)) === target) return m;
  return null;
}
// Strict FEN check for user-pasted positions. Returns null when valid, otherwise a short reason.
export function validateFEN(fen) {
  if (typeof fen !== 'string') return 'not a string';
  const p = fen.trim().split(/\s+/);
  if (p.length < 2 || p.length > 6) return 'expected 2 to 6 fields';
  const rows = p[0].split('/');
  if (rows.length !== 8) return 'expected 8 ranks';
  let K = 0, k = 0;
  for (let r = 0; r < 8; r++) {
    let n = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') n += +ch;
      else if ('pnbrqkPNBRQK'.includes(ch)) { n++; if (ch === 'K') K++; if (ch === 'k') k++; if ((ch === 'p' || ch === 'P') && (r === 0 || r === 7)) return 'pawn on the back rank'; }
      else return 'invalid character "' + ch + '"';
    }
    if (n !== 8) return 'rank ' + (8 - r) + ' does not have 8 squares';
  }
  if (K !== 1 || k !== 1) return 'each side needs exactly one king';
  if (p[1] !== 'w' && p[1] !== 'b') return 'side to move must be w or b';
  if (p[2] !== undefined && !/^(-|K?Q?k?q?)$/.test(p[2])) return 'bad castling field';
  if (p[3] !== undefined && !/^(-|[a-h][36])$/.test(p[3])) return 'bad en-passant field';
  if (p[4] !== undefined && !/^\d+$/.test(p[4])) return 'bad halfmove clock';
  if (p[5] !== undefined && !/^[1-9]\d*$/.test(p[5])) return 'bad move number';
  const s = fromFEN(fen);
  if ((s.c.K && (s.b[60] !== 'K' || s.b[63] !== 'R')) || (s.c.Q && (s.b[60] !== 'K' || s.b[56] !== 'R')) || (s.c.k && (s.b[4] !== 'k' || s.b[7] !== 'r')) || (s.c.q && (s.b[4] !== 'k' || s.b[0] !== 'r'))) return 'castling rights without king and rook on their squares';
  if (s.ep >= 0 && (s.t === 'w' ? (s.ep >> 3) !== 2 || s.b[s.ep + 8] !== 'p' : (s.ep >> 3) !== 5 || s.b[s.ep - 8] !== 'P')) return 'en-passant square without a pawn that just moved';
  if (inCheck(s, s.t !== 'w')) return 'the side not to move is in check';
  return null;
}
export function moveFromUci(s, uci) {
  const f = idx(uci.slice(0, 2)), t = idx(uci.slice(2, 4)), promo = uci[4];
  return legalMoves(s).find(m => m.f === f && m.t === t && (promo ? m.promo === promo : true)) || null;
}
export function parsePGN(txt) {
  let t = txt.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ').replace(/\$\d+/g, ' ');
  let depth = 0, out = '';
  for (const ch of t) { if (ch === '(') depth++; else if (ch === ')') depth--; else if (depth === 0) out += ch; }
  return out.split(/\s+/).filter(x => x && !/^\d+\.+$/.test(x) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(x)).map(x => x.replace(/^\d+\.+/, '')).filter(Boolean);
}

const V = { p: 100, n: 320, b: 330, r: 500, q: 950, k: 20000 };
const PST = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
};
// Endgame king table: centralise. The middlegame table above rewards the corner, which is exactly wrong once the
// queens are off — the attacking king must help, and the defending king must not be rewarded for hiding.
const KING_EG = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];
const PASSED = [0, 90, 60, 40, 25, 15, 10, 0]; // passed-pawn bonus by row from the pawn's own side (row 1 = one step from promotion)
const PHASE = { n: 1, b: 1, r: 2, q: 4 }; // 24 with everything on the board, 0 with kings and pawns only
const CENTRE_DIST = Array.from({ length: 64 }, (_, i) => Math.max(3 - (i & 7), (i & 7) - 4) + Math.max(3 - (i >> 3), (i >> 3) - 4));
const mirror = i => (7 - (i >> 3)) * 8 + (i & 7);
export function evaluate(s) {
  let sc = 0, phase = 0, wK = 0, bK = 0, wPieces = 0, bPieces = 0;
  const wp = [], bp = [];
  for (let i = 0; i < 64; i++) {
    const p = s.b[i]; if (!p) continue;
    const l = p.toLowerCase(), w = isW(p);
    if (l === 'k') { if (w) wK = i; else bK = i; continue; }
    const v = V[l] + PST[l][w ? i : mirror(i)];
    sc += w ? v : -v;
    if (l === 'p') (w ? wp : bp).push(i);
    else { phase += PHASE[l]; if (w) wPieces += V[l]; else bPieces += V[l]; }
  }
  const mg = Math.min(phase, 24) / 24; // 1 = opening, 0 = bare endgame; king tables are blended between the two
  sc += PST.k[wK] * mg + KING_EG[wK] * (1 - mg);
  sc -= PST.k[mirror(bK)] * mg + KING_EG[mirror(bK)] * (1 - mg);
  const pawnScale = 1 - mg * 0.5; // a passed pawn is worth more as the board empties
  for (const i of wp) { const f = i & 7, r = i >> 3; if (!bp.some(j => (j >> 3) < r && Math.abs((j & 7) - f) <= 1)) sc += PASSED[r] * pawnScale; }
  for (const i of bp) { const f = i & 7, r = i >> 3; if (!wp.some(j => (j >> 3) > r && Math.abs((j & 7) - f) <= 1)) sc -= PASSED[7 - r] * pawnScale; }
  // mop-up: against a bare king (or no pawns and a rook's worth less), drive it to the edge and bring our king close
  if (!bp.length && wPieces - bPieces >= 450) sc += 15 * CENTRE_DIST[bK] + 8 * (14 - kingDist(wK, bK));
  else if (!wp.length && bPieces - wPieces >= 450) sc -= 15 * CENTRE_DIST[wK] + 8 * (14 - kingDist(wK, bK));
  return s.t === 'w' ? sc : -sc;
}
const kingDist = (a, b) => Math.abs((a & 7) - (b & 7)) + Math.abs((a >> 3) - (b >> 3));
export const repKeyFromFEN = fen => fen.split(' ').slice(0, 4).join(' '); // position identity for repetition: placement, side, castling, e.p.
export const repKey = s => repKeyFromFEN(toFEN(s));
function orderMoves(ms) {
  return ms.sort((a, b) => ((b.cap ? V[b.cap.toLowerCase()] : 0) + (b.promo ? 800 : 0)) - ((a.cap ? V[a.cap.toLowerCase()] : 0) + (a.promo ? 800 : 0)));
}
// ---------- search ----------
// Iterative deepening under a time budget. Without a budget (analysis eval, tests) a node cap bounds each depth instead:
// bestMove abandons the iteration that hits it and keeps the previous depth's result, searchEval settles for static evals.
const NODE_CAP = 400000;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let NODES = 0, DEADLINE = 0, ABORT = false;
function visit() { NODES++; if (DEADLINE ? (NODES & 2047) === 0 && now() > DEADLINE : NODES > NODE_CAP) ABORT = true; }
function quiesce(s, a, b, qd) {
  visit();
  const stand = evaluate(s);
  if (stand >= b) return b;
  if (stand > a) a = stand;
  if (qd <= 0 || ABORT) return a;
  const caps = orderMoves(legalMoves(s, true)); // captures and promotions only
  for (const m of caps) {
    const u = make(s, m);
    const sc = -quiesce(s, -b, -a, qd - 1);
    unmake(s, m, u);
    if (sc >= b) return b;
    if (sc > a) a = sc;
  }
  return a;
}
function negamax(s, depth, a, b, ply, hist) {
  visit();
  if (ABORT) return DEADLINE ? 0 : evaluate(s); // out of time: this iteration is discarded anyway; over the node cap: static eval
  const legal = legalMoves(s);
  if (!legal.length) return inCheck(s) ? -99999 + ply : 0;
  if (s.hm >= 100) return 0;
  if (hist && ply <= 2 && hist[repKey(s)]) return 0; // a position the game has already seen counts as a draw: avoid it when ahead, seek it when behind
  if (depth <= 0) return quiesce(s, a, b, 6);
  orderMoves(legal);
  for (const m of legal) {
    const u = make(s, m);
    const sc = -negamax(s, depth - 1, -b, -a, ply + 1, hist);
    unmake(s, m, u);
    if (ABORT && DEADLINE) return 0;
    if (sc >= b) return b;
    if (sc > a) a = sc;
  }
  return a;
}
// Options: maxDepth, timeMs (0 = no budget), noise (scale in centipawns of Laplace-distributed jitter added to each root
// score before the best is picked: heavy tails make occasional blunders a smooth function of the scale, unlike uniform
// noise, which never exceeds its bound), history (map of repetition keys → count for the positions the game has seen).
const laplace = () => { const u = Math.random() - 0.5; return -Math.sign(u) * Math.log(1 - 2 * Math.abs(u)); }; // scale 1
export function bestMove(s, { maxDepth = 2, timeMs = 0, noise = 0, history = null } = {}) {
  const maxD = maxDepth;
  NODES = 0; ABORT = false; DEADLINE = timeMs > 0 ? now() + timeMs : 0;
  const st = clone(s);
  const legal = orderMoves(legalMoves(st));
  if (!legal.length) return null;
  let best = null, order = legal, reached = 0;
  for (let d = 1; d <= maxD; d++) {
    NODES = 0; // the node cap (no budget) applies per depth
    const scored = []; let alpha = -100000;
    for (const m of order) {
      const u = make(st, m);
      // moves far below the best so far are almost never picked (6 scales ≈ 99.8 %), so they may fail low (cheaper search)
      const sc = -negamax(st, d - 1, -100000, -(alpha - 6 * noise), 1, history);
      unmake(st, m, u);
      if (ABORT) break;
      scored.push({ m, sc });
      if (sc > alpha) alpha = sc;
    }
    if (ABORT) break;
    scored.sort((x, y) => y.sc - x.sc);
    best = scored; order = scored.map(x => x.m); reached = d;
    if (Math.abs(scored[0].sc) > 90000) break; // forced mate found: deeper search cannot improve on it
  }
  if (!best) best = legal.map(m => { const u = make(st, m); const sc = -evaluate(st); unmake(st, m, u); return { m, sc }; }).sort((x, y) => y.sc - x.sc); // not even depth 1 fit the budget
  let pick = best[0];
  if (noise) { let top = -Infinity; for (const x of best) { const sc = x.sc + noise * laplace(); if (sc > top) { top = sc; pick = { m: x.m, sc }; } } }
  return { move: pick.m, score: pick.sc, depth: reached, nodes: NODES };
}
export function searchEval(s, depth = 2) {
  NODES = 0; ABORT = false; DEADLINE = 0;
  const st = clone(s);
  const sc = negamax(st, depth, -100000, 100000, 0, null);
  return st.t === 'w' ? sc : -sc; // white POV centipawns
}
export function isMate(s) { const l = legalMoves(s); return !l.length && inCheck(s); }
// Settings per level. Levels 1–7 play with the built-in engine; 8 and Max play with Stockfish at the given Skill Level
// (0–20), their built-in settings being the fallback (rated fbRating) when Stockfish cannot run. Ratings are measured:
// level-vs-level self-play anchored to Stockfish's own Skill-Level ↔ UCI_Elo mapping (see README, "Levels and engine").
// noise is the scale in centipawns of the Laplace-distributed jitter added to the root scores.
export const BOT_LEVELS = {
  1: { maxDepth: 1, timeMs: 300, noise: 400, rating: 200 },
  2: { maxDepth: 1, timeMs: 300, noise: 250, rating: 550 },
  3: { maxDepth: 1, timeMs: 300, noise: 140, rating: 900 },
  4: { maxDepth: 1, timeMs: 300, noise: 60, rating: 1350 },
  5: { maxDepth: 2, timeMs: 600, noise: 40, rating: 1650 },
  6: { maxDepth: 3, timeMs: 600, noise: 15, rating: 2050 },
  7: { maxDepth: 6, timeMs: 1200, noise: 5, rating: 2300 },
  8: { maxDepth: 8, timeMs: 1500, noise: 5, rating: 2650, skill: 9, fbRating: 2350 },
  M: { maxDepth: 8, timeMs: 1500, noise: 5, rating: 3500, skill: 20, fbRating: 2350 },
};
