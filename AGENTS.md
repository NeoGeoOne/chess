# AGENTS.md

Conventions for everyone changing this repository, contributors and coding agents alike. README.md covers
features, layout and commands; this file holds only what is easy to get wrong.

## Commands

```bash
npm ci                          # install exactly what package-lock.json pins (CI does the same, on Node 22)
npm test                        # all suites; keep the glob in the script: `node --test tests/` fails on current Node
node --test tests/util.test.js  # one suite
npm run gen                     # src/template.html -> src/render.gen.js
npm run build                   # gen, then src/ + public/ -> dist/ (hashed files, CSP hash in index.html)
npm run serve                   # preview dist/ at http://127.0.0.1:8941/
```

## Where to edit

- Layout and text: `src/template.html`. It is not JSX. Loops are `<sc-for list="{{ … }}" as="…">`, conditions
  `<sc-if value="{{ … }}">`. `{{ }}` accepts only a name or path, `!x`, `==`/`!=`/`===`/`!==`, literals and
  parentheses; anything else fails the build. Names resolve to fields of `renderVals()` in `src/logic.js`:
  compute values there. `<style>`, `<script>` and `<template>` blocks in the template are dropped silently; put
  CSS in `src/styles.css`. `style="…"` attributes in the template are fine (they compile to React style props).
- `src/render.gen.js` is generated: never edit it. After a template change run `npm run gen` and commit
  `render.gen.js` with the template; CI does not check that they match.
- Behaviour and state: `src/logic.js`. Pure helpers (sanitizers, Elo, UCI parsing, PGN writers, puzzle labels):
  `src/util.js`, with a test in `tests/util.test.js`.
- `src/games.js` and `src/puzzles.data.js` are generated; regenerate, never hand-edit. Game picks and captions
  live in `SPEC` in `tools/fetch-games.mjs` (downloads from pgnmentor.com). `tools/fetch-puzzles.mjs` needs the
  lichess puzzle CSV (and `zstd` for the `.zst` file). If you cannot regenerate, stop and say so.
- `logic.js` and the template have no automated tests, and `src/` does not run unbuilt. Check UI changes with
  `npm run build && npm run serve`, also at 360 px width and in the light theme.

## Constraints

- No request to any other host: fonts, React, Stockfish and piece sets are bundled. No `eval`, no CDN.
- Content-Security-Policy in `src/index.html`: do not loosen it. The build hashes the single bare `<script>`
  and fails if there are zero or several. Inline scripts with attributes are not hashed, so a second
  executable one (e.g. `type="module"`) is blocked at runtime; the `application/ld+json` block is data. No
  `<style>` or `style=` in `src/index.html` (`style-src 'self'`).
- Keep every asset URL relative (`pieces/…`, `engine/…`) so `dist/` works from any base path.
- `localStorage` keys start with `chess_`. Validate everything read from storage or imported: saved data and
  backups with the sanitizers in `src/util.js`, FEN and PGN with the validators in `src/engine.js`. An
  unreadable store is reset, never trusted.
- Keyboard access is generated: the template compiler gives every clickable element (other than `a`, `button`,
  `input`, `select`) `role="button"`, `tabIndex` and Enter/Space handling. Everything inside a `data-board`
  element (squares, promotion picker) is excluded on purpose. Use `data-nofocus` only when another control
  covers the same action, as the ‹ › buttons do for the analysis move tokens. Keep the visible focus ring in
  `src/styles.css`.
- Assets need a license that allows commercial use; non-commercial (CC BY-NC) and unlicensed sets stay out.
  A piece set lives in five places: `public/pieces/<id>/` (12 SVGs, `wK.svg` … `bP.svg`), `PIECE_SETS` in
  `src/logic.js`, the options of the piece-set `<select>` and the credits paragraph in `src/template.html`, and
  `public/pieces/LICENSES.txt`. Change all five together; CC BY sets need the credit.
- Stockfish plays levels 8 and Max and powers analysis. If it cannot load, the game says so and falls back to
  the built-in engine; keep that fallback.
- The level ratings in README.md were measured with level-against-level matches. Do not change engine search,
  evaluation or level parameters without an issue the maintainer has replied to; the repository has no match
  harness.
- Counts in user-facing text (README, the description and social tags in `src/index.html`, the share image
  source `tools/og.html` and its render `public/og.png`) follow the data: puzzles, games, levels.
- Tests guard the data: 50 games in chronological order, captions of at most 220 characters whose cited moves
  match the game, at least 1,900 valid puzzles. Fix the data, not the test.
- English everywhere: UI, code, comments, docs, commits.

## Pull requests

- Open a pull request only for an issue the maintainer has replied to, and link it (`Closes #N`).
- One topic per pull request. Run `npm test` and `npm run build` before pushing; CI runs both.
- Only the maintainer merges.
