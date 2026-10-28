// Build-time compiler: src/template.html (.dc template) → src/render.gen.js
// Mirrors the semantics of the design runtime (support.js compile.ts/expr.ts) but emits
// plain React.createElement calls so no template runtime ships to production.
import { parseFragment } from 'parse5';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const src = readFileSync(resolve(root, 'src/template.html'), 'utf8');
const frag = parseFragment(src);

const INTERP = /{{\s*([\s\S]*?)\s*}}/g;
const WHOLE = /^\s*{{\s*([\s\S]*?)\s*}}\s*$/;
const EVENTS = { onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onpointerdown: 'onPointerDown', onpointerup: 'onPointerUp', onpointermove: 'onPointerMove', onkeydown: 'onKeyDown', onkeyup: 'onKeyUp', onsubmit: 'onSubmit', onfocus: 'onFocus', onblur: 'onBlur', oncontextmenu: 'onContextMenu', onmouseenter: 'onMouseEnter', onmouseleave: 'onMouseLeave', ondblclick: 'onDoubleClick' };
const DROP = new Set(['hint-placeholder-count', 'hint-placeholder-val', 'hint-size', 'sc-name', 'data-dc-tpl', 'data-screen-label', 'data-nofocus']);

const kebabToCamel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// ---- expressions (same grammar the runtime resolves: paths, !x, ==/!=/===/!==, literals) ----
function compileExpr(raw, scope) {
  const e = raw.trim();
  if (!e) return 'undefined';
  if (e[0] === '(' && e[e.length - 1] === ')') return '(' + compileExpr(e.slice(1, -1), scope) + ')';
  const eq = e.match(/^(.*?)\s*(===|!==|==|!=)\s*(.*)$/);
  if (eq && eq[1].trim()) return `(${compileExpr(eq[1], scope)} ${eq[2]} ${compileExpr(eq[3], scope)})`;
  if (e[0] === '!') return '!(' + compileExpr(e.slice(1), scope) + ')';
  if (e === 'true' || e === 'false' || e === 'null' || e === 'undefined') return e;
  if (/^-?\d+(\.\d+)?$/.test(e)) return e;
  if (e.length >= 2 && (e[0] === '"' || e[0] === "'") && e[e.length - 1] === e[0]) return JSON.stringify(e.slice(1, -1));
  const m = e.match(/^([A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)$/);
  if (!m) throw new Error('dc2jsx: unsupported expression: ' + raw);
  const head = m[1];
  let out = scope.has(head) ? head : 'v.' + head;
  const rest = m[2];
  const re = /\.([A-Za-z_$][\w$]*)|\[([^\]]+)\]/g;
  let mm;
  while ((mm = re.exec(rest))) out += mm[1] !== undefined ? '?.' + mm[1] : '?.[' + compileExpr(mm[2], scope) + ']';
  return out;
}
const str = s => JSON.stringify(s);
const text = (expr) => `S(${expr})`; // runtime helper: String(x ?? '')

// mixed string with interpolations → JS expression producing a string
function compileMixed(value, scope) {
  const parts = [];
  let last = 0, m;
  INTERP.lastIndex = 0;
  while ((m = INTERP.exec(value))) {
    if (m.index > last) parts.push(str(value.slice(last, m.index)));
    parts.push(text(compileExpr(m[1], scope)));
    last = m.index + m[0].length;
  }
  if (last < value.length) parts.push(str(value.slice(last)));
  if (!parts.length) return '""';
  return parts.join(' + ');
}
function compileAttrValue(value, scope) {
  const w = value.match(WHOLE);
  if (w) return compileExpr(w[1], scope);
  if (!value.includes('{{')) return str(value);
  return compileMixed(value, scope);
}

// inline CSS string → React style object literal (custom properties kept as-is)
function compileStyle(value, scope) {
  const w = value.match(WHOLE);
  if (w) return compileExpr(w[1], scope);
  const decls = [];
  for (const d of splitDecls(value)) {
    const i = d.indexOf(':');
    if (i < 0) continue;
    const prop = d.slice(0, i).trim();
    const val = d.slice(i + 1).trim();
    if (!prop) continue;
    const key = prop.startsWith('--') ? prop : prop.startsWith('-') ? prop[1].toUpperCase() + kebabToCamel(prop.slice(2)) : kebabToCamel(prop);
    const w2 = val.match(WHOLE); // the runtime stringifies the whole style attr, so a lone {{x}} is String(x ?? '')
    decls.push(`${str(key)}: ${w2 ? text(compileExpr(w2[1], scope)) : compileAttrValue(val, scope)}`);
  }
  return '{' + decls.join(', ') + '}';
}
function splitDecls(css) {
  const out = []; let depth = 0, cur = '';
  for (const ch of css) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ---- nodes ----
function compileChildren(nodes, scope, inBoard = false) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.nodeName === '#comment') continue;
    if (n.nodeName === '#text') { out.push(...compileText(n.value, scope)); continue; }
    out.push(compileElement(n, scope, inBoard));
  }
  return out;
}
function compileText(value, scope) {
  if (!value.trim()) return value.includes('\n') ? [] : [str(' ')];
  let t = value.replace(/\s+/g, ' ');
  if (/^\s*\n/.test(value)) t = t.replace(/^ /, '');
  if (/\n\s*$/.test(value)) t = t.replace(/ $/, '');
  const parts = [];
  let last = 0, m;
  INTERP.lastIndex = 0;
  while ((m = INTERP.exec(t))) {
    if (m.index > last) parts.push(str(t.slice(last, m.index)));
    parts.push(text(compileExpr(m[1], scope)));
    last = m.index + m[0].length;
  }
  if (last < t.length) parts.push(str(t.slice(last)));
  return parts;
}
function attrsOf(el) { const o = {}; for (const a of el.attrs) o[a.name] = a.value; return o; }

function compileElement(el, scope, inBoard) {
  const tag = el.nodeName;
  const attrs = attrsOf(el);
  if (tag === 'sc-for') {
    const listExpr = compileExpr(attrs.list.match(WHOLE)[1], scope);
    const as = attrs.as || 'item';
    const inner = new Set([...scope, as, '$index']);
    const kids = compileChildren(el.childNodes, inner, inBoard);
    return `...A(${listExpr}).map((${as}, $index) => h(F, {key: $index}, ${kids.join(', ')}))`;
  }
  if (tag === 'sc-if') {
    const cond = compileExpr(attrs.value.match(WHOLE)[1], scope);
    const kids = compileChildren(el.childNodes, scope, inBoard);
    return `(${cond}) ? h(F, null, ${kids.join(', ')}) : null`;
  }
  if (tag === 'template' || tag === 'script' || tag === 'style' || tag === 'helmet' || tag === 'sc-helmet') return 'null';
  const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
  const props = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (DROP.has(name)) continue;
    let key = name;
    if (name === 'style') { props.push(`style: ${compileStyle(value, scope)}`); continue; }
    if (name === 'class') key = 'className';
    else if (name === 'for') key = 'htmlFor';
    else if (name.startsWith('on')) key = EVENTS[name] || ('on' + name[2].toUpperCase() + name.slice(3));
    else if (isSvg && name.includes('-') && !name.startsWith('data-') && !name.startsWith('aria-')) key = kebabToCamel(name);
    let cv = compileAttrValue(value, scope);
    if (key === 'value') cv = `(${cv} ?? '')`; else if (key === 'checked') cv = `(${cv} ?? false)`;
    props.push(`${str(key)}: ${cv}`);
  }
  // keyboard access: clickable divs/spans become focusable buttons (board squares excluded — 64 tab stops would be
  // noise — and so are elements marked data-nofocus, e.g. the analysis move tokens, which the ‹ › buttons cover)
  const clickProp = props.find(p => p.startsWith('"onClick"'));
  if (clickProp && !inBoard && !('data-nofocus' in attrs) && tag !== 'a' && tag !== 'button' && tag !== 'select' && tag !== 'input') {
    const handler = clickProp.slice('"onClick": '.length);
    props.push('role: "button"', 'tabIndex: 0', `onKeyDown: K(${handler})`);
  }
  const kids = compileChildren(el.childNodes, scope, inBoard || 'data-board' in attrs);
  const propsSrc = props.length ? '{' + props.join(', ') + '}' : 'null';
  return `h(${str(tag)}, ${propsSrc}${kids.length ? ', ' + kids.join(', ') : ''})`;
}

const top = compileChildren(frag.childNodes, new Set());
const out = `// GENERATED by tools/dc2jsx.mjs from src/template.html — do not edit by hand.
const S = x => x == null ? '' : String(x);
const A = x => Array.isArray(x) ? x : [];
const K = fn => e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (typeof fn === 'function') fn(e); } };
export default function render(h, F, v) {
  return h(F, null, ${top.join(', ')});
}
`;
writeFileSync(resolve(root, 'src/render.gen.js'), out);
console.log('dc2jsx: wrote src/render.gen.js (' + out.length + ' bytes)');
