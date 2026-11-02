/**
 * ci/registration-keys.js — reads what a chunk registers on window.app
 *
 * Shared by ci/audit.js, ci/snapshot.js and ci/onclick-check.js so the three
 * gates agree. A registration block is the object literal passed to
 * `app.register('domain', {...})` or `Object.assign(window.app, {...})`.
 *
 * The object is walked, not pattern-matched, because real blocks hold all of:
 *   several keys on one line   bjcInput, bjcCat, bjcPage, bjcToggle,
 *   inline arrows with a `}`   _plSetGoalMonthForTest: (m) => { _plGoalMonth = m; },
 * Each of those once made a gate misreport: the first as dead handlers, the
 * second as 79 lost exports.
 */
'use strict';

// Calls visit(char, index) for each character of code from `from` on, skipping
// strings, template literals and comments. visit may return false to stop.
function walkCode(src, from, visit) {
  let inStr = null, inLineC = false, inBlockC = false;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
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
    if (visit(c, i) === false) return;
  }
}

// The body of the object literal whose `{` is at openIdx (between the matching
// braces). If the braces never balance, returns the rest of src.
function extractBalanced(src, openIdx) {
  let depth = 0, end = src.length;
  walkCode(src, openIdx, (c, i) => {
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i; return false; }
  });
  return src.slice(openIdx + 1, end);
}

// Top-level property names of an object-literal body, in order: `key,` shorthand,
// `key: value`, and `key() {` / `async key() {` methods. Skips spreads, computed
// keys and quoted keys, none of which can be trusted as an identifier.
function topLevelKeys(body) {
  const keys = new Set();
  let depth = 0, entry = '';
  const endEntry = () => {
    const m = entry.match(/^\s*(?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?::|\(|$)/);
    if (m) keys.add(m[1]);
    entry = '';
  };
  walkCode(body, 0, (c) => {
    if (c === ',' && depth === 0) { endEntry(); return; }
    if (depth === 0) entry += c;
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
  });
  endEntry();
  return [...keys];
}

// Every name src registers on window.app, across all of its registration blocks.
// A head on a comment line is an example, not a registration.
function registeredKeys(src) {
  const head = /(?:(?:window\.)?app\.register\(\s*['"][^'"]*['"]|Object\.assign\(\s*window\.app)\s*,\s*\{/g;
  const keys = new Set();
  let m;
  while ((m = head.exec(src)) !== null) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (/^\s*(?:\/\/|\/?\*)/.test(src.slice(lineStart, m.index))) continue;
    const openIdx = m.index + m[0].length - 1;
    for (const k of topLevelKeys(extractBalanced(src, openIdx))) keys.add(k);
  }
  return [...keys];
}

module.exports = { extractBalanced, topLevelKeys, registeredKeys };
