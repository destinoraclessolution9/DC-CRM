#!/usr/bin/env node
/**
 * ci/onclick-check.js — DEAD inline-handler guard (broken-button detector)
 *
 * The CRM wires its UI with inline handlers emitted from JS template strings, e.g.
 *     `<button onclick="app.editProspect(${id})">Edit</button>`
 * If `editProspect` is never actually registered on `window.app`, that button is a
 * silent no-op at runtime (ReferenceError / "app.editProspect is not a function").
 * Nothing at build time catches it because the handler lives inside a string.
 *
 * This guard:
 *   1. Collects every `app.<name>(` / `window.app.<name>(` REFERENCED inside the
 *      app's onclick-driven UI across the canonical (non-minified) sources.
 *   2. Builds the global set of REGISTERED app methods from every registration
 *      form (app.register / Object.assign(window.app) / direct window.app.x =
 *      assignments / the main IIFE return object), using brace-balanced parsing
 *      (same approach as ci/audit.js + ci/snapshot.js, extended to also capture
 *      `key: value` entries, not only shorthand `key,` entries).
 *   3. Reports DEAD handlers (referenced inside an inline on*="..." attribute but
 *      NOT registered anywhere) and WARN ambiguous cases (referenced only as a
 *      bare `app.x(` outside any inline handler — could be a real JS call site or
 *      an HTML-embedded handler; a human should decide).
 *
 * Exit 1 if any DEAD handler is found, else exit 0.
 *
 * Usage:  node ci/onclick-check.js  [--verbose]
 *
 * ── Scope / honesty notes ────────────────────────────────────────────────────
 * - Only un-minified sources are scanned (script.js, script-features.js,
 *   chunks/*.js). The shipped *.min.js are derived and skipped.
 * - The registered set is GLOBAL across all scanned files, so a method defined in
 *   one file and referenced from another is NOT flagged.
 * - app.register(...) / app.todo(...) are the registry mechanism + the universal
 *   placeholder; both are always present, never flagged (see ALWAYS_PRESENT).
 * - Chained calls (`app.foo().bar(`) only ever match `foo` here — the regex
 *   requires `app.` immediately before the name, so `.bar(` after `)` is ignored.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');

// ── Allowlist: methods that are always present on window.app but may not be
// captured by the static extraction below. Kept deliberately tiny + documented.
//   register/todo  — defined imperatively at the very top of script.js
//                    (window.app.register = function ... ; todo is in the return
//                    object but listed here as a belt-and-braces safety net).
//   init           — the app entry point, always in the return object.
// These are never reported as DEAD even if extraction missed them.
const ALWAYS_PRESENT = new Set(['register', 'todo', 'init']);

// ── Inline-handler attribute names we treat as UI handlers.
const HANDLER_ATTRS = ['onclick', 'ondblclick', 'onchange', 'oninput', 'onkeyup', 'onsubmit'];

// ── Canonical (non-minified) source files. Mirrors ci/lint-patterns.js.
function sourceFiles() {
  const out = [];
  if (fs.existsSync(path.join(ROOT, 'script.js')))          out.push('script.js');
  if (fs.existsSync(path.join(ROOT, 'script-features.js'))) out.push('script-features.js');
  const chunkDir = path.join(ROOT, 'chunks');
  if (fs.existsSync(chunkDir)) {
    for (const f of fs.readdirSync(chunkDir).sort()) {
      if (f.endsWith('.js') && !f.includes('.min')) out.push(path.join('chunks', f));
    }
  }
  return out;
}

// Strip a JS line comment (// ...) without touching `://` inside string URLs.
// Conservative: only strips a `//` that is preceded by whitespace or start-of-line
// and not immediately preceded by a `:` (so http:// survives). Good enough to keep
// commented-out example handlers (e.g. `// onclick="app.foo("`) out of the scan.
function stripLineComment(line) {
  const m = line.match(/(^|[^:\\])\/\/.*/);
  if (!m) return line;
  // keep the captured leading char (group 1), drop from `//` onward
  return line.slice(0, m.index + m[1].length);
}

// ── Brace-balanced object-literal extractor ─────────────────────────────────
// Given source text and the index of the `{` that opens an object literal, return
// the substring of that object's body (between the matching braces). String- and
// comment-aware so braces inside strings/regex/comments don't unbalance the count.
function extractBalanced(src, openIdx) {
  let depth = 0, i = openIdx;
  let inStr = null;      // current string/template quote char, or null
  let inLineC = false, inBlockC = false;
  const start = openIdx + 1;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (inLineC) { if (c === '\n') inLineC = false; continue; }
    if (inBlockC) { if (c === '*' && src[i + 1] === '/') { inBlockC = false; i++; } continue; }
    if (inStr) {
      if (c === '\\') { i++; continue; }           // escaped char
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { inLineC = true; i++; continue; }
    if (c === '/' && src[i + 1] === '*') { inBlockC = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i); }
  }
  return src.slice(start); // unbalanced — return rest (defensive)
}

// Extract the registered key names from an object-literal body. Captures BOTH
// shorthand entries (`foo,` / `foo`) and `key: value` entries (`foo: bar,`).
// Skips spread (`...x`), computed keys (`[expr]:`), and string keys we can't trust
// as identifiers. Only top-level keys matter; nested object braces are stripped by
// re-balancing, but for our registration blocks the keys are flat, so a line-wise
// scan of `^<indent><ident>[:,]` is sufficient and robust.
function keysFromObjectBody(body) {
  const keys = new Set();
  // Match an identifier that begins a property: at line start (allowing leading
  // whitespace) followed by either `:` (key: value) or `,`/end-of-line (shorthand).
  const re = /(?:^|\n)\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?::|,|$)/g;
  let m;
  while ((m = re.exec(body)) !== null) keys.add(m[1]);
  return keys;
}

// Find all `<head>(` registration object-literals for a given head regex and add
// their keys to `registered`. headRe must capture the position just before `{`.
function collectFromBlocks(src, registered, source, kind) {
  // Locate each occurrence of the block head, then brace-balance from its `{`.
  const heads = {
    register: /(?:window\.)?app\.register\(\s*['"][^'"]*['"]\s*,\s*\{/g,
    objassign: /Object\.assign\(\s*window\.app\s*,\s*\{/g,
  }[kind];
  let m;
  while ((m = heads.exec(src)) !== null) {
    const openIdx = src.indexOf('{', m.index);
    if (openIdx < 0) continue;
    const body = extractBalanced(src, openIdx);
    for (const k of keysFromObjectBody(body)) registered.add(k);
  }
}

// Direct assignments: `window.app.NAME =` or `app.NAME =` (not `==`/`===`).
// Excludes `app.register =` style internals are fine to include (harmless).
function collectFromAssignments(src, registered) {
  const re = /(?:window\.)?app\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=(?!=)/g;
  let m;
  while ((m = re.exec(src)) !== null) registered.add(m[1]);
}

// The main IIFE public surface: `const appLogic = (() => { ... return { ... } })()`
// in script.js. Find the IIFE's return object (the one whose body contains the
// `init,` entry, distinguishing it from inner-function returns) and take its keys.
function collectMainReturn(scriptSrc, registered) {
  const lines = scriptSrc.split('\n');
  let retLine = -1;
  for (let i = 0; i < lines.length - 6; i++) {
    if (/^    return \{/.test(lines[i]) &&
        lines.slice(i + 1, i + 7).some(l => /^        init,/.test(l))) {
      retLine = i; break;
    }
  }
  if (retLine < 0) return false; // could not locate — caller notes this
  // Char index of the `{` on that return line, then brace-balance.
  let charIdx = 0;
  for (let i = 0; i < retLine; i++) charIdx += lines[i].length + 1;
  const openIdx = scriptSrc.indexOf('{', charIdx);
  const body = extractBalanced(scriptSrc, openIdx);
  for (const k of keysFromObjectBody(body)) registered.add(k);
  return true;
}

// ── REFERENCE extraction ─────────────────────────────────────────────────────
// For each source line, find:
//   (A) inline-handler references: on*="...app.fn(...".  CLASS = 'handler'
//   (B) any other bare app.fn( / window.app.fn(.          CLASS = 'bare'
// We record per (name) the strongest class seen and an example location.
//
// A name that ever appears in class (A) and is unregistered => DEAD (broken button).
// A name that appears ONLY in class (B) and is unregistered => WARN (ambiguous:
//   could be a genuine JS call-site bug or an HTML-embedded handler — human picks).
const refAppCall = /(?:window\.)?app\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;

// Detect inline-handler attribute spans on a line and return the [start,end) char
// ranges of their value, so we can tag app.fn( matches that fall inside them.
function handlerRanges(line) {
  const ranges = [];
  for (const attr of HANDLER_ATTRS) {
    // attr = "....."  or  attr = '.....'  (value may itself contain escaped quotes
    // in template output; we capture up to the matching outer quote).
    const re = new RegExp(attr + '\\s*=\\s*(["\'])', 'gi');
    let m;
    while ((m = re.exec(line)) !== null) {
      const quote = m[1];
      const valStart = m.index + m[0].length;
      // find the closing quote (not escaped). In emitted HTML strings the JS
      // template uses the OPPOSITE quote for the attribute, so the first matching
      // quote char closes it; escaped \" is rare but handled.
      let end = valStart;
      while (end < line.length) {
        if (line[end] === quote && line[end - 1] !== '\\') break;
        end++;
      }
      ranges.push([valStart, end]);
      re.lastIndex = end;
    }
  }
  return ranges;
}

function main() {
  const files = sourceFiles();
  const notes = [];

  // ---- 1. Build REGISTERED set (global across all scanned files) -------------
  const registered = new Set(ALWAYS_PRESENT);
  let scriptReturnFound = false;
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    collectFromBlocks(src, registered, rel, 'register');
    collectFromBlocks(src, registered, rel, 'objassign');
    collectFromAssignments(src, registered);
    if (rel === 'script.js') {
      scriptReturnFound = collectMainReturn(src, registered);
    }
  }
  if (!scriptReturnFound) {
    notes.push('WARN: could not locate main IIFE return object in script.js — ' +
               'return-surface methods may be under-counted (extraction imperfect).');
  }

  // ---- 2. Collect REFERENCES -------------------------------------------------
  // name -> { handler: {file,line,text}|null, bare: {file,line,text}|null }
  const refs = new Map();
  function record(name, cls, file, lineNo, text) {
    let e = refs.get(name);
    if (!e) { e = { handler: null, bare: null }; refs.set(name, e); }
    if (cls === 'handler' && !e.handler) e.handler = { file, line: lineNo, text };
    if (cls === 'bare'    && !e.bare)    e.bare    = { file, line: lineNo, text };
  }

  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const lines = src.split('\n');
    lines.forEach((raw, idx) => {
      const line = stripLineComment(raw);
      if (!line.includes('app.')) return;
      const ranges = handlerRanges(line);
      refAppCall.lastIndex = 0;
      let m;
      while ((m = refAppCall.exec(line)) !== null) {
        const name = m[1];
        // Skip the registry mechanism itself.
        if (name === 'register') continue;
        const at = m.index;
        const inHandler = ranges.some(([s, e]) => at >= s && at < e);
        const snippet = line.trim().slice(0, 120);
        record(name, inHandler ? 'handler' : 'bare', rel, idx + 1, snippet);
      }
    });
  }

  // ---- 3. Classify -----------------------------------------------------------
  const referencedNames = [...refs.keys()];
  const dead = [];   // referenced in an inline handler, not registered
  const warn = [];   // referenced only as bare app.fn(, not registered
  for (const name of referencedNames) {
    if (registered.has(name)) continue;
    const e = refs.get(name);
    if (e.handler) dead.push({ name, ...e.handler });
    else if (e.bare) warn.push({ name, ...e.bare });
  }
  dead.sort((a, b) => a.name.localeCompare(b.name));
  warn.sort((a, b) => a.name.localeCompare(b.name));

  // ---- 4. Report -------------------------------------------------------------
  console.log('\nonclick-check  (DEAD inline-handler guard)');
  console.log(`  files scanned      : ${files.length} (script.js + ${files.length - 1} chunks)`);
  console.log(`  referenced names   : ${referencedNames.length}`);
  console.log(`  registered methods : ${registered.size}`);
  console.log(`  DEAD handlers      : ${dead.length}`);
  console.log(`  WARN ambiguous     : ${warn.length}`);
  console.log(`  allowlist          : ${[...ALWAYS_PRESENT].join(', ')}`);

  if (notes.length) {
    console.log('\n  Extraction notes:');
    notes.forEach(n => console.log('    ' + n));
  }

  if (dead.length) {
    console.log('\n  ── DEAD inline handlers (broken buttons) ──');
    for (const d of dead) {
      console.error(`  DEAD  ${d.name}  (referenced in ${d.file}:${d.line}, e.g. "${d.text}")`);
    }
  }

  if (warn.length) {
    console.log('\n  ── WARN ambiguous (bare app.fn( outside an inline handler; human decides) ──');
    for (const w of warn) {
      console.log(`  WARN  ${w.name}  (referenced in ${w.file}:${w.line}, e.g. "${w.text}")`);
    }
  }

  if (VERBOSE) {
    console.log('\n  Registered (sorted):');
    console.log('    ' + [...registered].sort().join(', '));
  }

  if (dead.length) {
    console.error(`\nFAIL  ${dead.length} dead inline handler(s) — these are real broken buttons.\n`);
    process.exit(1);
  }
  console.log('\nPASS  No dead inline handlers found.' +
              (warn.length ? `  (${warn.length} WARN to review — not failing.)` : '') + '\n');
  process.exit(0);
}

main();
