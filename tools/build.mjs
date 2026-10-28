// Production build: regenerate generated sources, public/ → dist/, bundle the engine worker and the app
// (hashed file names), stamp dist/index.html (script/css names + CSP hash of the inline script).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const dist = resolve(root, 'dist');
const sha = (s, enc = 'hex') => createHash('sha256').update(s).digest(enc);

// 1. generated source: render.gen.js from the template (logic.js is hand-maintained source)
execFileSync(process.execPath, [resolve(root, 'tools/dc2jsx.mjs')], { stdio: 'inherit' });

// 2. clean dist, copy static assets
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(resolve(root, 'public'), dist, { recursive: true });

const common = { bundle: true, minify: true, format: 'iife', target: ['es2020', 'chrome90', 'firefox90', 'safari14'], legalComments: 'none', write: false, logLevel: 'info', define: { 'process.env.NODE_ENV': '"production"' } };

// 3. engine worker (built-in engine off the main thread)
const wk = await build({ ...common, entryPoints: [resolve(root, 'src/engine-worker.js')] });
const wjs = wk.outputFiles[0].text;
const workerName = `engine/worker.${sha(wjs).slice(0, 10)}.js`;
writeFileSync(resolve(dist, workerName), wjs);

// 4. puzzle set: a separate hashed JSON file the app fetches after start (≈ 90 KB gzipped that would otherwise sit in every page load)
const { PUZZLES } = await import(pathToFileURL(resolve(root, 'src/puzzles.data.js')).href);
const pjson = JSON.stringify(PUZZLES);
const puzName = `puzzles.${sha(pjson).slice(0, 10)}.json`;
writeFileSync(resolve(dist, puzName), pjson);

// 5. app bundle (knows the hashed names of the worker and the puzzle file)
const app = await build({ ...common, entryPoints: [resolve(root, 'src/main.js')], define: { ...common.define, __ENGINE_WORKER__: JSON.stringify(workerName), __PUZZLES_JSON__: JSON.stringify(puzName) } });
const js = app.outputFiles[0].text;
const jsName = `app.${sha(js).slice(0, 10)}.js`;
writeFileSync(resolve(dist, jsName), js);

// 6. css: fonts + base page css → one hashed file (fonts.css lives in fonts/, the bundle at the root)
const css = [
  readFileSync(resolve(root, 'public/fonts/fonts.css'), 'utf8').replace(/url\('/g, "url('fonts/"),
  readFileSync(resolve(root, 'src/styles.css'), 'utf8'),
].join('\n');
const cssName = `app.${sha(css).slice(0, 10)}.css`;
writeFileSync(resolve(dist, cssName), css);
rmSync(resolve(dist, 'fonts/fonts.css'));

// 7. index.html: asset names + CSP hash for the single inline script
let html = readFileSync(resolve(root, 'src/index.html'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (inline.length !== 1) throw new Error('index.html must contain exactly one inline <script> (found ' + inline.length + ')');
html = html.replace('__APP_JS__', jsName).replace('__APP_CSS__', cssName).replace('__INLINE_SHA__', `'sha256-${sha(inline[0], 'base64')}'`);
if (/__[A-Z_]+__/.test(html)) throw new Error('unreplaced placeholder in index.html');
writeFileSync(resolve(dist, 'index.html'), html);
if (existsSync(resolve(root, 'src/404.html'))) cpSync(resolve(root, 'src/404.html'), resolve(dist, '404.html'));

console.log(`built dist/${jsName} (${(js.length / 1024).toFixed(0)} KB), dist/${workerName} (${(wjs.length / 1024).toFixed(0)} KB), dist/${puzName} (${(pjson.length / 1024).toFixed(0)} KB, ${PUZZLES.length} puzzles), dist/${cssName}`);
