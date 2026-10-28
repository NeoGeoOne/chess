// Builds src/games.js (50 famous games) from pgnmentor.com player collections.
// Move sequences are facts; the captions below are original text. Usage:
//   node tools/fetch-games.mjs --list      # show candidates per spec (to disambiguate)
//   node tools/fetch-games.mjs             # write src/games.js
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as E from '../src/engine.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const cache = process.env.PGN_CACHE || resolve(root, '.cache/pgn');
mkdirSync(cache, { recursive: true });
const LIST = process.argv.includes('--list');

// id, zip, white/black regex on the PGN tags, years, result, optional `contains` (a SAN token) / `prefix` (SAN string),
// display names, event, caption.
const SPEC = [
  ['immortal', 'Anderssen', /Anderssen/, /Kieseritz/, [1851], '1-0', { plies: 45 }, 'Adolf Anderssen', 'Lionel Kieseritzky', 'London', 'The Immortal Game: Anderssen gives up both rooks, a bishop and finally the queen, and mates with the three minor pieces he has left.'],
  ['evergreen', 'Anderssen', /Anderssen/, /Dufresne/, [1852], '1-0', {}, 'Adolf Anderssen', 'Jean Dufresne', 'Berlin', 'The Evergreen Game: a quiet rook move, 19.Rad1, prepares a queen sacrifice and a mating net that analysts argued about for a century.'],
  ['paulsen-morphy', 'Morphy', /Paulsen/, /Morphy/, [1857], '0-1', { contains: 'Qxf3' }, 'Louis Paulsen', 'Paul Morphy', 'New York', 'Morphy’s 17...Qxf3!! tears open a calm position; the two bishops and a rook do the rest. First American Chess Congress.'],
  ['opera', 'Morphy', /Morphy/, /Isouard/, [1858], '1-0', {}, 'Paul Morphy', 'Duke Karl & Count Isouard', 'Paris', 'The Opera Game, played in a box at the Paris opera: fast development, a rook sacrifice on d7 and a queen sacrifice to mate with the last two pieces.'],
  ['bird-morphy', 'Morphy', /Bird/, /Morphy/, [1858], '0-1', { contains: 'Qa3' }, 'Henry Bird', 'Paul Morphy', 'London', 'Morphy’s ...Qa3!! offers the queen where it cannot be taken; the attack switches to the queenside and mate follows.'],
  ['zukertort-blackburne', 'Zukertort', /Zukertort/, /Blackburne/, [1883], '1-0', { contains: 'Qb4' }, 'Johannes Zukertort', 'Joseph Blackburne', 'London', '28.Qb4!! gives up the queen to open the seventh rank; one of the most quoted combinations of the nineteenth century.'],
  ['lasker-bauer', 'Lasker', /Lasker/, /Bauer/, [1889], '1-0', { plies: 75 }, 'Emanuel Lasker', 'Johann Bauer', 'Amsterdam', 'The original double bishop sacrifice on h7 and g7: the pattern every attacking player learns from this game.'],
  ['steinitz-chigorin', 'Steinitz', /Steinitz/, /Chigorin|Tschigorin/, [1892], '1-0', { contains: 'Rxh7' }, 'Wilhelm Steinitz', 'Mikhail Chigorin', 'World Championship, Havana', 'Steinitz, the champion of defence, attacks: a rook sacrifice on h7 and a king hunt decide a World Championship game.'],
  ['steinitz-bardeleben', 'Steinitz', /Steinitz/, /Bardeleben/, [1895], '1-0', {}, 'Wilhelm Steinitz', 'Curt von Bardeleben', 'Hastings', 'Every White piece hangs at once and none can be taken. Von Bardeleben left the hall rather than face the mate in ten.'],
  ['pillsbury-lasker', 'Lasker', /Pillsbury/, /Lasker/, [1895, 1896], '0-1', { contains: 'Rxc3' }, 'Harry Pillsbury', 'Emanuel Lasker', 'St. Petersburg', 'Lasker’s 17...Rxc3!! exchange sacrifice wrecks the king’s cover; the champion converts with a queen-and-rook attack.'],
  ['rotlewi-rubinstein', 'Rubinstein', /Rotlewi/, /Rubinstein/, [1907], '0-1', { prefix: 'd4 d5 Nf3 e6 e3 c5', contains: 'Rh3' }, 'Georg Rotlewi', 'Akiba Rubinstein', 'Lodz', 'Rubinstein’s Immortal: a rook and both bishops are sacrificed in three moves and the whole line is calculated to mate.'],
  ['rubinstein-lasker', 'Rubinstein', /Rubinstein/, /Lasker/, [1909], '1-0', {}, 'Akiba Rubinstein', 'Emanuel Lasker', 'St. Petersburg', 'Rubinstein beats the world champion with a small combination and then a rook endgame played like a textbook.'],
  ['levitsky-marshall', 'Marshall', /Levitsk|Lewitzk/, /Marshall/, [1912], '0-1', { contains: 'Qg3' }, 'Stepan Levitsky', 'Frank Marshall', 'Breslau', '23...Qg3!! puts the queen where three pieces can take it and every capture loses. Legend says gold coins rained on the board.'],
  ['nimzowitsch-tarrasch', 'Nimzowitsch', /Nimzo/, /Tarrasch/, [1914], '0-1', {}, 'Aron Nimzowitsch', 'Siegbert Tarrasch', 'St. Petersburg', 'Tarrasch repeats Lasker’s double bishop sacrifice against Nimzowitsch and adds a rook lift to finish.'],
  ['capablanca-bernstein', 'Capablanca', /Capablanca/, /Bernstein/, [1911], '1-0', {}, 'José Raúl Capablanca', 'Ossip Bernstein', 'San Sebastián', 'Capablanca’s European debut: Bernstein had objected to inviting the unknown Cuban. The newcomer beat him and took the brilliancy prize.'],
  ['lasker-capablanca', 'Lasker', /Lasker/, /Capablanca/, [1914], '1-0', {}, 'Emanuel Lasker', 'José Raúl Capablanca', 'St. Petersburg', 'Needing a win, Lasker chooses the quiet Exchange Ruy Lopez and outplays Capablanca in a slow squeeze.'],
  ['capablanca-marshall', 'Capablanca', /Capablanca/, /Marshall/, [1918], '1-0', {}, 'José Raúl Capablanca', 'Frank Marshall', 'New York', 'Marshall unveils the gambit he had kept secret for years; Capablanca, seeing it for the first time, defends perfectly at the board.'],
  ['bogoljubow-alekhine', 'Alekhine', /Bogolju/, /Alekhine/, [1922], '0-1', {}, 'Efim Bogoljubow', 'Alexander Alekhine', 'Hastings', 'Alekhine’s pawn odyssey: a passed pawn, a queen sacrifice and a promotion, all in one long combination.'],
  ['saemisch-nimzowitsch', 'Nimzowitsch', /S.{1,2}misch/, /Nimzo/, [1923], '0-1', { prefix: 'd4 Nf6 c4 e6 Nf3 b6 g3 Bb7' }, 'Friedrich Sämisch', 'Aron Nimzowitsch', 'Copenhagen', 'The Immortal Zugzwang Game: with all pieces on the board, White has no move that does not lose material.'],
  ['reti-bogoljubow', 'Reti', /R.{1,2}ti/, /Bogolju/, [1924], '1-0', {}, 'Richard Réti', 'Efim Bogoljubow', 'New York', '25.Be8!! — a quiet bishop move wins outright. Brilliancy prize of the New York 1924 tournament.'],
  ['capablanca-tartakower', 'Capablanca', /Capablanca/, /Tartakower/, [1924], '1-0', {}, 'José Raúl Capablanca', 'Savielly Tartakower', 'New York', 'A rook endgame lesson: Capablanca’s king walks to g6 under fire because activity matters more than pawns.'],
  ['reti-alekhine', 'Reti', /R.{1,2}ti/, /Alekhine/, [1925], '0-1', {}, 'Richard Réti', 'Alexander Alekhine', 'Baden-Baden', 'Alekhine’s rook sits en prise on e3 for several moves while a combination unfolds across the whole board.'],
  ['nimzowitsch-capablanca', 'Capablanca', /Nimzo/, /Capablanca/, [1927], '0-1', { prefix: 'e4 c6 d4 d5 e5 Bf5' }, 'Aron Nimzowitsch', 'José Raúl Capablanca', 'New York', 'Capablanca ties White down on both wings until every move loses something: positional play as a demonstration.'],
  ['alekhine-nimzowitsch', 'Alekhine', /Alekhine/, /Nimzo/, [1930], '1-0', {}, 'Alexander Alekhine', 'Aron Nimzowitsch', 'San Remo', 'Alekhine’s Gun: the queen lines up behind two rooks on one file and Nimzowitsch simply runs out of moves.'],
  ['botvinnik-capablanca', 'Botvinnik', /Botvinnik/, /Capablanca/, [1938], '1-0', {}, 'Mikhail Botvinnik', 'José Raúl Capablanca', 'AVRO, Rotterdam', '30.Ba3!! deflects the queen and the king hunt that follows is the most famous game of the AVRO tournament.'],
  ['averbakh-kotov', 'Kotov', /Averbakh/, /Kotov/, [1953], '0-1', {}, 'Yuri Averbakh', 'Alexander Kotov', 'Zurich Candidates', '30...Qxh3+!! and the White king is chased to g7 and back; a king hunt across the whole board.'],
  ['geller-euwe', 'Euwe', /Geller/, /Euwe/, [1953], '0-1', {}, 'Efim Geller', 'Max Euwe', 'Zurich Candidates', 'Euwe answers a raging attack with a counter-sacrifice: the rook lands where it cannot be taken and the tables turn.'],
  ['byrne-fischer-1956', 'Fischer', /Byrne/, /Fischer/, [1956], '0-1', {}, 'Donald Byrne', 'Bobby Fischer', 'New York', 'The Game of the Century: thirteen-year-old Fischer gives up his queen, wins with a windmill of checks and mates with minor pieces.'],
  ['botvinnik-tal', 'Tal', /Botvinnik/, /Tal/, [1960], '0-1', { contains: 'Nf4' }, 'Mikhail Botvinnik', 'Mikhail Tal', 'World Championship, Moscow', 'Game 6 of the title match: Tal’s 21...Nf4!? knight sacrifice is unclear, uncomfortable for Botvinnik and decisive.'],
  ['spassky-bronstein', 'Spassky', /Spassky/, /Bronstein/, [1960], '1-0', {}, 'Boris Spassky', 'David Bronstein', 'Leningrad', 'A rook sacrifice and a knight on f7: the game shown in the opening scene of the James Bond film From Russia with Love.'],
  ['byrne-fischer-1963', 'Fischer', /Byrne, Robert/, /Fischer/, [1963, 1964], '0-1', { prefix: 'd4 Nf6 c4 g6 g3 c6' }, 'Robert Byrne', 'Bobby Fischer', 'US Championship, New York', 'Byrne resigned after 21...Qd7 while the commentators still thought White was better. Fischer’s deepest short game.'],
  ['tal-larsen', 'Tal', /Tal/, /Larsen/, [1965], '1-0', { prefix: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 e6', contains: 'Nd5' }, 'Mikhail Tal', 'Bent Larsen', 'Candidates final, Bled', 'Tal’s 16.Nd5!! knight sacrifice in the Candidates final: intuitive, unclear at the board, and correct.'],
  ['larsen-spassky', 'Spassky', /Larsen/, /Spassky/, [1970], '0-1', { prefix: 'b3 e5' }, 'Bent Larsen', 'Boris Spassky', 'USSR vs Rest of the World, Belgrade', 'Seventeen moves: Spassky’s 14...Rh1!! rook sacrifice against the world number two.'],
  ['fischer-spassky', 'Fischer', /Fischer/, /Spassky/, [1972], '1-0', { prefix: 'c4 e6 Nf3 d5 d4 Nf6 Nc3 Be7 Bg5 O-O e3 h6' }, 'Bobby Fischer', 'Boris Spassky', 'World Championship, Reykjavik', 'Game 6, Reykjavik 1972: Fischer opens 1.c4 for the first time in the match and wins so cleanly that Spassky applauded with the audience.'],
  ['karpov-korchnoi', 'Karpov', /Karpov/, /Korchnoi|Kortschnoj/, [1974], '1-0', { prefix: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6' }, 'Anatoly Karpov', 'Viktor Korchnoi', 'Candidates final, Moscow', 'The game that made people say the Dragon was dead: Karpov’s attack with a rook sacrifice on h7.'],
  ['kasparov-portisch', 'Kasparov', /Kasparov/, /Portisch/, [1983], '1-0', {}, 'Garry Kasparov', 'Lajos Portisch', 'Nikšić', 'Kasparov’s double bishop sacrifice on h7 and g7, the Lasker pattern in a modern opening, with a rook lift to finish.'],
  ['karpov-kasparov-1985', 'Kasparov', /Karpov/, /Kasparov/, [1985], '0-1', { contains: 'Nd3' }, 'Anatoly Karpov', 'Garry Kasparov', 'World Championship, Moscow', 'The octopus knight: Kasparov’s 16...Nd3 paralyses Karpov’s queenside for the rest of game 16.'],
  ['kasparov-karpov-1990', 'Kasparov', /Kasparov/, /Karpov/, [1990], '1-0', { prefix: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Bb7 d4 Re8', contains: 'Bxd5+' }, 'Garry Kasparov', 'Anatoly Karpov', 'World Championship, Lyon', 'Game 20 of their last match, Lyon 1990: a long kingside attack in the Zaitsev Ruy Lopez, often named Kasparov\u2019s best game against Karpov.'],
  ['short-timman', 'Short', /Short/, /Timman/, [1991], '1-0', { contains: 'Kh2' }, 'Nigel Short', 'Jan Timman', 'Tilburg', 'Short’s king walks 31.Kh2, 32.Kg3, 33.Kf4, 34.Kg5 in the middlegame to support a mate on g7. Timman resigned before the last step.'],
  ['ivanchuk-yusupov', 'Ivanchuk', /Ivanchuk/, /Yusupov|Jussupow/, [1991], '0-1', {}, 'Vasyl Ivanchuk', 'Artur Yusupov', 'Candidates, Brussels', 'Yusupov’s King’s Indian attack: the black pieces pour into the white king’s corner, and after 39...Qg3 Ivanchuk has no defence.'],
  ['kasparov-anand', 'Kasparov', /Kasparov/, /Anand/, [1995], '1-0', { prefix: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4' }, 'Garry Kasparov', 'Viswanathan Anand', 'PCA World Championship, New York', 'Game 10 of the PCA final: Kasparov’s home preparation in the Open Ruy Lopez, 14.Bc2, refutes Anand’s line and the match turns.'],
  ['deepblue-kasparov', 'Kasparov', /Deep Blue|Comp/, /Kasparov/, [1997], '1-0', { prefix: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nd7 Ng5' }, 'Deep Blue', 'Garry Kasparov', 'New York', 'Game 6, 1997: a known Caro-Kann knight sacrifice, 8.Nxe6, and the first match loss of a world champion to a computer.'],
  ['topalov-shirov', 'Shirov', /Topalov/, /Shirov/, [1998], '0-1', { contains: 'Bh3' }, 'Veselin Topalov', 'Alexei Shirov', 'Linares', '47...Bh3!! — Shirov gives the bishop away for nothing but a tempo, and the black king reaches the pawns first.'],
  ['kasparov-topalov', 'Kasparov', /Kasparov/, /Topalov/, [1999], '1-0', { contains: 'Rxd4' }, 'Garry Kasparov', 'Veselin Topalov', 'Wijk aan Zee', 'Kasparov’s Immortal: 24.Rxd4!! starts a king hunt that drives the black king to b3 before the queen finishes.'],
  ['polgar-kasparov', 'PolgarJ', /Polgar/, /Kasparov/, [2002], '1-0', {}, 'Judit Polgár', 'Garry Kasparov', 'Russia vs Rest of the World, Moscow', 'Judit Polgár’s first win over Kasparov: a Berlin endgame squeezed with White in the rapid match.'],
  ['kramnik-leko', 'Kramnik', /Kramnik/, /Leko/, [2004], '1-0', {}, 'Vladimir Kramnik', 'Péter Lékó', 'World Championship, Brissago', 'Kramnik had to win the last game to keep his title. He did, with a Caro-Kann advance and a mating attack.'],
  ['kramnik-anand', 'Anand', /Kramnik/, /Anand/, [2008], '0-1', { prefix: 'd4 d5 c4 c6', contains: 'Nxb5', plies: 82 }, 'Vladimir Kramnik', 'Viswanathan Anand', 'World Championship, Bonn', 'Anand’s prepared Meran and a pawn sacrifice give Black a raging initiative; the game set the tone of the match.'],
  ['aronian-anand', 'Anand', /Aronian/, /Anand/, [2013], '0-1', {}, 'Levon Aronian', 'Viswanathan Anand', 'Wijk aan Zee', 'Anand’s 16...Nde5!! and a knight sacrifice on f2: a 23-move brilliancy against the world number three.'],
  ['carlsen-karjakin', 'Carlsen', /Carlsen/, /Karjakin/, [2016], '1-0', { contains: 'Qh6+' }, 'Magnus Carlsen', 'Sergey Karjakin', 'World Championship tiebreak, New York', 'The tiebreak that kept the title: Carlsen’s 50.Qh6+!! queen sacrifice mates in two ways.'],
  ['carlsen-nepomniachtchi', 'Carlsen', /Carlsen/, /Nepomniachtchi/, [2021], '1-0', { prefix: 'd4 Nf6 Nf3 d5 g3' }, 'Magnus Carlsen', 'Ian Nepomniachtchi', 'World Championship, Dubai', 'Game 6, Dubai 2021: 136 moves, the longest World Championship game ever, decided by queen against rook and knight.'],
];

function zipPath(name) {
  const zip = resolve(cache, name + '.zip'), pgn = resolve(cache, name + '.pgn');
  if (!existsSync(pgn)) {
    if (!existsSync(zip)) execFileSync('curl', ['-sS', '-L', '-m', '120', '-A', 'Mozilla/5.0', '-o', zip, `https://www.pgnmentor.com/players/${name}.zip`]);
    execFileSync('unzip', ['-o', '-q', zip, '-d', cache]);
    if (!existsSync(pgn)) { const alt = execFileSync('ls', [cache]).toString().split('\n').find(f => f.toLowerCase() === (name + '.pgn').toLowerCase()); if (alt) execFileSync('mv', [resolve(cache, alt), pgn]); }
  }
  return pgn;
}
const parsed = new Map();
function gamesOf(name) {
  if (parsed.has(name)) return parsed.get(name);
  const txt = readFileSync(zipPath(name), 'latin1');
  const out = [];
  for (const chunk of txt.split(/\n(?=\[Event )/)) {
    const tags = {}; for (const m of chunk.matchAll(/\[(\w+) "([^"]*)"\]/g)) tags[m[1]] = m[2];
    const movetext = chunk.replace(/\[[^\]]*\]\s*/g, '');
    if (!tags.White) continue;
    out.push({ tags, movetext });
  }
  parsed.set(name, out);
  return out;
}
function replay(movetext) {
  const sans = E.parsePGN(movetext);
  let st = E.init(); const out = [];
  for (const s of sans) { const m = E.moveFromSan(st, s); if (!m) return { ok: false, sans: out, bad: s }; out.push(E.sanFor(st, m)); st = E.applyMove(st, m); }
  return { ok: true, sans: out, mate: E.isMate(st) };
}
const strip = s => s.replace(/[+#]/g, '');

const results = [];
let problems = 0;
for (const [id, zip, wRe, bRe, years, result, opt, wName, bName, event, why] of SPEC) {
  const cands = gamesOf(zip).filter(g => wRe.test(g.tags.White) && bRe.test(g.tags.Black) && years.includes(+(g.tags.Date || '').slice(0, 4)) && (g.tags.Result === result))
    .map(g => ({ g, r: replay(g.movetext) }))
    .filter(x => x.r.ok && (!opt.contains || x.r.sans.some(s => strip(s) === strip(opt.contains))) && (!opt.prefix || x.r.sans.join(' ').startsWith(opt.prefix)) && (!opt.plies || x.r.sans.length === opt.plies));
  if (LIST) {
    console.log(`\n## ${id} — ${cands.length} candidate(s)`);
    for (const { g, r } of cands) console.log(`  ${g.tags.Date} ${g.tags.Event || ''} | ${g.tags.White} – ${g.tags.Black} ${g.tags.Result} | ${r.sans.length} plies | ${r.sans.slice(0, 8).join(' ')} … ${r.sans.slice(-3).join(' ')}${r.mate ? ' #' : ''}`);
    continue;
  }
  if (cands.length !== 1) { console.error(`${id}: ${cands.length} candidates`); problems++; continue; }
  const { g, r } = cands[0];
  results.push({ id, white: wName, black: bName, event, year: +(g.tags.Date || '').slice(0, 4), result, moves: r.sans.join(' '), why, src: `${g.tags.White} – ${g.tags.Black}, ${g.tags.Event || ''} ${g.tags.Date}` });
}
if (LIST) process.exit(0);
if (problems) { console.error(problems + ' spec(s) unresolved'); process.exit(1); }
results.sort((a, b) => a.year - b.year || SPEC.findIndex(s => s[0] === a.id) - SPEC.findIndex(s => s[0] === b.id));
const out = `// GENERATED by tools/fetch-games.mjs — 50 famous games. Move lists from public game records (pgnmentor.com
// player collections); captions are original text. Do not edit by hand; edit the SPEC in the tool.
export const GAMES = [
${results.map(r => `  ${JSON.stringify({ id: r.id, white: r.white, black: r.black, event: r.event, year: r.year, result: r.result, moves: r.moves, why: r.why })},`).join('\n')}
];
`;
writeFileSync(resolve(root, 'src/games.js'), out);
console.log(`wrote src/games.js with ${results.length} games (${(out.length / 1024).toFixed(0)} KB)`);
