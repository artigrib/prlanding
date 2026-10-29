// Static scan of the module graph of a static site folder (no dependencies).
// Used by build-space.mjs (pull in files the sims import from outside their folder) and check-imports.mjs (CI guard).
//
// Follows, from every *.html under a root:
//   <script src>, inline <script type="module">, <link rel="modulepreload|preload|stylesheet" href>,
//   the page's <script type="importmap"> for bare specifiers,
// and in every reached .js/.mjs file:
//   import … from '…', import '…', export … from '…', import('…') and new URL('…', import.meta.url)
//   with string-literal specifiers (template literals and computed specifiers cannot be resolved statically).
// http(s):, data:, blob: and protocol-relative URLs are ignored; "/x" resolves against the root.
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');

export function jsSpecifiers(src) {
  const s = stripComments(src), out = [];
  const res = [
    /\bimport\s+(?:[\w$*{}\s,]+?\s+from\s+)?(['"])([^'"\n]+)\1/g,
    /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  ];
  for (const re of res) for (const m of s.matchAll(re)) out.push({ spec: m[2], kind: 'import' });
  for (const m of s.matchAll(/\bnew\s+URL\s*\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url\s*\)/g)) out.push({ spec: m[2], kind: 'url' });
  return out;
}

export function htmlRefs(src) {
  const refs = [], inline = [];
  let importmap = {};
  for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1], body = m[2];
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || '';
    const srcAttr = (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (type === 'importmap') { try { importmap = JSON.parse(body).imports || {}; } catch { refs.push({ spec: '(invalid importmap)', kind: 'importmap' }); } }
    else if (srcAttr) refs.push({ spec: srcAttr, kind: 'script' });
    else if (type === 'module') inline.push(body);
  }
  for (const m of src.matchAll(/<link\b([^>]*)>/gi)) {
    const rel = (m[1].match(/\brel\s*=\s*["']?([^"'>]+)/i) || [])[1] || '';
    const href = (m[1].match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (href && /\b(modulepreload|preload|stylesheet)\b/i.test(rel)) refs.push({ spec: href, kind: 'link' });
  }
  return { refs, inline, importmap };
}

const NODE_BUILTIN = new Set(builtinModules);

/**
 * Resolve a specifier from file `from` (absolute path) inside `root`; null when external, {bare} when unmapped.
 * `url` = true for HTML src/href and new URL(…, import.meta.url): plain relative URLs ("app.js"), not module specifiers.
 */
export function resolve(root, from, spec, importmap = {}, url = false) {
  if (Object.hasOwn(importmap, spec)) spec = importmap[spec], from = importmap.__base || from;
  else {
    const prefix = Object.keys(importmap).filter((k) => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (prefix) spec = importmap[prefix] + spec.slice(prefix.length), from = importmap.__base || from;
  }
  if (EXTERNAL.test(spec)) return null;
  const clean = spec.split(/[?#]/)[0];
  if (clean.startsWith('/')) return path.join(root, clean);
  if (url || clean.startsWith('./') || clean.startsWith('../')) return path.resolve(path.dirname(from), clean);
  if (NODE_BUILTIN.has(spec) || spec.startsWith('node:')) return null;   // Node-only branches (Emscripten glue)
  return { bare: spec };
}

/**
 * Walk the graph from every HTML file under `root`. `exists(abs)` says whether a target is present.
 * Returns [{ from, spec, target, problem }] for every unresolved reference.
 */
export function walkGraph(root, { exists = (p) => fs.existsSync(p) && fs.statSync(p).isFile(), onMissing } = {}) {
  const problems = [], seen = new Set();
  const htmls = listFiles(root).filter((f) => f.endsWith('.html'));
  const visitJs = (file, importmap) => {
    const key = file + '\0' + JSON.stringify(importmap);
    if (seen.has(key)) return; seen.add(key);
    if (!exists(file)) return;
    if (!/\.(m?js)$/.test(file)) return;
    for (const { spec, kind } of jsSpecifiers(fs.readFileSync(file, 'utf8'))) step(file, spec, kind, importmap);
  };
  const step = (from, spec, kind, importmap) => {
    const t = resolve(root, from, spec, importmap, kind === 'url' || kind === 'link' || kind === 'script');
    if (t === null) return;
    if (t.bare) { problems.push({ from, spec, problem: 'bare specifier not in the page importmap' }); return; }
    if (!t.startsWith(root + path.sep)) { problems.push({ from, spec, target: t, problem: 'outside the published folder' }); return; }
    if (kind === 'url' && spec.split(/[?#]/)[0].endsWith('/')) {      // base URL of a folder (new URL('./', import.meta.url))
      if (!fs.existsSync(t) || !fs.statSync(t).isDirectory()) problems.push({ from, spec, target: t, problem: 'missing folder' });
      return;
    }
    if (!exists(t) && !(onMissing && onMissing(t) && exists(t))) { problems.push({ from, spec, target: t, problem: 'missing' }); return; }
    if (kind === 'import' || kind === 'script' || (kind === 'link' && /\.m?js$/.test(t))) visitJs(t, importmap);
  };
  for (const html of htmls) {
    const { refs, inline, importmap } = htmlRefs(fs.readFileSync(html, 'utf8'));
    const map = { ...importmap, __base: html };
    for (const r of refs) step(html, r.spec, r.kind, map);
    for (const body of inline) for (const { spec, kind } of jsSpecifiers(body)) step(html, spec, kind, map);
  }
  const uniq = new Map();
  for (const p of problems) uniq.set(`${p.from}\0${p.spec}`, p);
  return [...uniq.values()];
}

export function listFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out); else out.push(p);
  }
  return out;
}
