// Picks a balanced, engine-verified puzzle set from the lichess puzzle database (CC0) → src/puzzles.data.js
// Usage: node tools/fetch-puzzles.mjs /path/to/lichess_db_puzzle.csv.zst   (needs the `zstd` binary)
//        node tools/fetch-puzzles.mjs /path/to/lichess_db_puzzle.csv       (already decompressed)
// CSV columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
// Lichess semantics: FEN is the position BEFORE the opponent's move; Moves[0] is that move, then the solution.
//
// Balance: a puzzle may carry several of our nine themes (a back-rank mate in one is also "mateIn1", a fork in a
// rook ending is also "endgame"). The app's category filters count every tag, so the set is balanced on tag counts,
// not on a primary theme: within each band the theme with the fewest tags so far gets the next puzzle, preferring
// candidates whose other tags are not ahead either. Themes stay within one tag of each other.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createReadStream, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as E from '../src/engine.js';

const src = process.argv[2];
if (!src) { console.error('usage: node tools/fetch-puzzles.mjs <lichess_db_puzzle.csv[.zst]>'); process.exit(1); }
const root = resolve(new URL('..', import.meta.url).pathname);

const BANDS = [
  { id: 'easy', lo: 800, hi: 1200, n: 650 },
  { id: 'medium', lo: 1200, hi: 1800, n: 850 },
  { id: 'hard', lo: 1800, hi: 2300, n: 500 },
];
const THEMES = ['mateIn1', 'mateIn2', 'mateIn3', 'fork', 'pin', 'skewer', 'discoveredAttack', 'backRankMate', 'endgame'];
const MIN_PLAYS = 1000, MIN_POP = 90, MAX_RD = 80;

// deterministic PRNG so a rerun yields the same set
let seed = 20260913;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const cands = new Map(BANDS.map(b => [b.id, []])); // band → candidates
let rows = 0, kept = 0;
const input = src.endsWith('.zst') ? spawn('zstd', ['-dc', src], { stdio: ['ignore', 'pipe', 'inherit'] }).stdout : createReadStream(src);
const rl = createInterface({ input, crlfDelay: Infinity });
for await (const line of rl) {
  rows++;
  if (rows === 1 && line.startsWith('PuzzleId')) continue;
  const c = line.split(',');
  if (c.length < 8) continue;
  const rating = +c[3], rd = +c[4], pop = +c[5], plays = +c[6];
  if (!(rd < MAX_RD && plays > MIN_PLAYS && pop > MIN_POP)) continue;
  const band = BANDS.find(b => rating >= b.lo && rating < b.hi); if (!band) continue;
  const themes = c[7].split(' ');
  const mine = THEMES.filter(t => themes.includes(t)); if (!mine.length) continue;
  const moves = c[2].split(' ');
  if (moves.length < 2 || moves.length > 9) continue; // up to 4 solution moves keeps puzzles snappy
  kept++;
  cands.get(band.id).push({ id: c[0], fen: c[1], moves, rating, themes: mine, game: (c[8] || '').split('#')[0].replace(/\/(white|black)$/, '') }); // one game, whichever side
}
console.error(`rows ${rows}, candidates after filters ${kept}`);

const picked = [], seenGames = new Set(), seenIds = new Set();
for (const band of BANDS) {
  const pool = shuffle(cands.get(band.id));
  const byTheme = new Map(THEMES.map(t => [t, pool.filter(p => p.themes.includes(t))])); // each in pool (random) order
  const count = Object.fromEntries(THEMES.map(t => [t, 0])), used = new Set(), exhausted = new Set();
  let n = 0;
  while (n < band.n) {
    const open = THEMES.filter(t => !exhausted.has(t)); if (!open.length) break;
    const min = Math.min(...open.map(t => count[t]));
    const lows = open.filter(t => count[t] === min);
    const t = lows[Math.floor(rnd() * lows.length)];
    // the best candidate for theme t: all of its tags at the minimum (penalty = min); otherwise the lowest maximum
    let best = null, bestPen = Infinity;
    for (const rec of byTheme.get(t)) {
      if (used.has(rec)) continue;
      const pen = Math.max(...rec.themes.map(x => count[x]));
      if (pen < bestPen) { best = rec; bestPen = pen; if (pen === min) break; }
    }
    if (!best) { exhausted.add(t); continue; }
    used.add(best);
    if (seenGames.has(best.game) || seenIds.has(best.id) || !verify(best)) continue;
    picked.push({ ...best, band: band.id }); seenGames.add(best.game); seenIds.add(best.id); n++;
    for (const x of best.themes) count[x]++;
  }
  if (n < band.n) console.error(`band ${band.id}: only ${n} of ${band.n} puzzles available`);
}

function verify(rec) {
  try {
    let st = E.fromFEN(rec.fen);
    if (E.validateFEN(rec.fen)) return false;
    for (const uci of rec.moves) { const m = E.moveFromUci(st, uci); if (!m) return false; st = E.applyMove(st, m); }
    const mateIn = rec.themes.find(t => /^mateIn\d$/.test(t));
    if (mateIn) { if (!E.isMate(st)) return false; if ((rec.moves.length - 1) !== 2 * (+mateIn.slice(6)) - 1) return false; }
    return true;
  } catch (e) { return false; }
}

picked.sort((a, b) => a.rating - b.rating);
const out = '// GENERATED by tools/fetch-puzzles.mjs from the lichess puzzle database (CC0, https://database.lichess.org/#puzzles).\n' +
  '// Each entry: [id, fen, moves (uci, first = opponent\'s move), rating, themes]. Do not edit by hand.\n' +
  'export const PUZZLES = [\n' + picked.map(p => `  ${JSON.stringify([p.id, p.fen, p.moves.join(' '), p.rating, p.themes.join(' ')])},`).join('\n') + '\n];\n';
writeFileSync(resolve(root, 'src/puzzles.data.js'), out);

// report: tag counts per theme and band (a multi-theme puzzle counts once per theme)
const tab = Object.fromEntries(THEMES.map(t => [t, Object.fromEntries(BANDS.map(b => [b.id, 0]))]));
let multi = 0;
for (const p of picked) { if (p.themes.length > 1) multi++; for (const t of p.themes) tab[t][p.band]++; }
console.error(`picked ${picked.length} (${multi} with more than one theme), ${(out.length / 1024).toFixed(0)} KB`);
console.error('theme'.padEnd(18) + BANDS.map(b => b.id.padStart(8)).join('') + '   total');
for (const t of THEMES) console.error(t.padEnd(18) + BANDS.map(b => String(tab[t][b.id]).padStart(8)).join('') + String(BANDS.reduce((s, b) => s + tab[t][b.id], 0)).padStart(8));
