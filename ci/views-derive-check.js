#!/usr/bin/env node
/**
 * ci/views-derive-check.js — proves the consolidated VIEWS source-of-truth
 * derives _CHUNK_VIEWS / VIEW_TITLES / levelPermissions byte-identically to
 * the original literals captured from a frozen baseline (ci/views-baseline.json).
 *
 *   node ci/views-derive-check.js --save   # capture baseline from git HEAD's script.js
 *   node ci/views-derive-check.js           # eval current VIEWS derivations, deep-equal vs baseline
 *
 * The gate logic (navigateTo/updateNavVisibility/refreshCurrentView) is unchanged
 * and reads these three tables by name, so derived===baseline ⇒ behavior preserved.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const save = process.argv.includes('--save');

// Balanced { } / [ ] extractor that skips strings + comments.
function balancedAt(s, start) {
  const open = s[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, q = '';
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === q) inStr = false; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i++; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  throw new Error('unbalanced from ' + start);
}
function literal(src, decl) {
  const idx = src.indexOf(decl);
  if (idx < 0) throw new Error('not found: ' + decl);
  let i = idx + decl.length;
  while (i < src.length && src[i] !== '{' && src[i] !== '[') i++;
  return balancedAt(src, i);
}

// Original tables from a given script.js source (literal form).
function originalTables(src) {
  const chunkViews = literal(src, 'const _CHUNK_VIEWS = ');
  const viewTitles = literal(src, 'const VIEW_TITLES = ');
  const l12 = literal(src, 'const _l12 = ');
  const levelPerms = literal(src, 'const levelPermissions = ');
  // eslint-disable-next-line no-new-func
  return new Function(`const _l12 = ${l12};
    return { chunkViews: ${chunkViews}, viewTitles: ${viewTitles}, levelPermissions: ${levelPerms} };`)();
}

// Derived tables from the CURRENT working script.js (VIEWS + derivation fns).
function derivedTables() {
  const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const lines = src.split('\n');
  const start = lines.findIndex(l => /const _VIEW_NO_NAV\s*=/.test(l));
  const end = lines.findIndex(l => /const _CHUNK_VIEWS\s*=\s*_deriveChunkViews\(\)/.test(l));
  if (start < 0 || end < 0 || end <= start) throw new Error('VIEWS definition block not found');
  const block = lines.slice(start, end).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(`${block}
    return { chunkViews: _deriveChunkViews(), viewTitles: _deriveViewTitles(), levelPermissions: _deriveLevelPermissions() };`)();
}

if (save) {
  const headSrc = cp.execSync('git show HEAD:script.js', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  const base = originalTables(headSrc);
  fs.writeFileSync(path.join(__dirname, 'views-baseline.json'), JSON.stringify(base, null, 2));
  console.log('views-baseline.json saved from git HEAD:script.js');
  console.log(`  _CHUNK_VIEWS: ${Object.keys(base.chunkViews).length} keys`);
  console.log(`  VIEW_TITLES: ${Object.keys(base.viewTitles).length} keys`);
  console.log(`  levelPermissions: ${Object.keys(base.levelPermissions).length} keys`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'views-baseline.json'), 'utf8'));
const derived = derivedTables();
let fail = 0;
for (const t of ['chunkViews', 'viewTitles', 'levelPermissions']) {
  // JSON round-trip normalizes undefined-key omission the same way both sides built it.
  const a = JSON.stringify(baseline[t]);
  const b = JSON.stringify(derived[t]);
  try { assert.deepStrictEqual(JSON.parse(b), JSON.parse(a)); console.log(`PASS  ${t}: derived === baseline (${Object.keys(derived[t]).length} keys)`); }
  catch (e) {
    fail++;
    console.error(`FAIL  ${t}: derived !== baseline`);
    const bk = Object.keys(baseline[t]), dk = Object.keys(derived[t]);
    const missing = bk.filter(k => !dk.includes(k)), extra = dk.filter(k => !bk.includes(k));
    if (missing.length) console.error('   missing keys: ' + missing.join(', '));
    if (extra.length) console.error('   extra keys: ' + extra.join(', '));
    for (const k of bk) if (dk.includes(k) && JSON.stringify(baseline[t][k]) !== JSON.stringify(derived[t][k]))
      console.error(`   diff [${k}]: base=${JSON.stringify(baseline[t][k])} derived=${JSON.stringify(derived[t][k])}`);
  }
}
if (fail) { console.error(`\nviews-derive-check FAIL (${fail} table(s) drifted)`); process.exit(1); }
console.log('\nviews-derive-check PASS — VIEWS derives all 3 tables identically.');
process.exit(0);
