#!/usr/bin/env node
/**
 * ci/audit.js — permanent ghost-call sweep
 *
 * Checks that no chunk-exported function is called by bare name inside
 * script.js's IIFE scope. Run after every extraction.
 *
 * Exit 0 = clean. Exit 1 = issues found.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const scriptLines = script.split('\n');

function escRe(s) {
  return s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// ── 1. Ghost-call sweep ────────────────────────────────────────────────────
const chunkDir   = path.join(ROOT, 'chunks');
const chunkFiles = fs.readdirSync(chunkDir)
  .filter(f => f.endsWith('.js') && !f.includes('.min'));

let issues   = 0;
let exported = 0;

chunkFiles.forEach(cf => {
  const src  = fs.readFileSync(path.join(chunkDir, cf), 'utf8');
  // Use matchAll + take last match so inline comments like
  // "// Object.assign(window.app, { ... })" don't shadow the real one.
  const allMatches = [...src.matchAll(/Object\.assign\(window\.app\s*,\s*\{([^}]+)\}/gs)];
  const m = allMatches.length ? allMatches[allMatches.length - 1] : null;
  if (!m) return;

  const keys = [...m[1].matchAll(/([a-zA-Z_$][a-zA-Z0-9_$]*),/g)].map(x => x[1]);
  exported += keys.length;

  keys.forEach(fn => {
    const eFn    = escRe(fn);
    const defPat = new RegExp('(?:const|let|var|function)\\s+' + eFn + '\\b');
    const appPat = new RegExp('(?:app|window\\.app)\\.' + eFn + '\\s*\\(');
    const callPat= new RegExp('\\b' + eFn + '\\s*\\(');

    const hits = [];
    scriptLines.forEach((line, i) => {
      const stripped = line.replace(/\/\/.*/, '');
      if (callPat.test(stripped) && !appPat.test(stripped) && !defPat.test(stripped)) {
        hits.push({ n: i + 1, text: stripped.trim().slice(0, 90) });
      }
    });

    if (hits.length) {
      console.error(`GHOST  ${cf} exports ${fn} — direct call(s) in script.js:`);
      hits.slice(0, 3).forEach(h => console.error(`       L${h.n}: ${h.text}`));
      issues++;
    }
  });
});

// ── 2. Return-object undefined check ──────────────────────────────────────
const defined = new Set();
scriptLines.forEach(l => {
  let m2 = l.match(/^[\s]*(?:async\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=;]/);
  if (m2) defined.add(m2[1]);
  m2 = l.match(/^[\s]*(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[\(\{]/);
  if (m2) defined.add(m2[1]);
});

const returnSection = scriptLines.slice(39000).join('\n');
const retKeys = [...returnSection.matchAll(/^        ([a-zA-Z_$][a-zA-Z0-9_$]*),\s*$/gm)]
  .map(m => m[1]);

// Known browser-global names resolved via window scope (not IIFE-local)
const WINDOW_GLOBALS = new Set(['UI', 'AppDataStore', 'supabase']);

const missingRet = retKeys.filter(k => !defined.has(k) && !WINDOW_GLOBALS.has(k));
if (missingRet.length) {
  console.error('RETURN  keys in return object not defined in script.js scope:');
  missingRet.forEach(k => console.error(`        ${k}`));
  issues += missingRet.length;
}

// ── 3. Manifest vs chunk files ─────────────────────────────────────────────
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const manifestMatch = html.match(/window\.__ASSET_MANIFEST\s*=\s*(\{[^;]+\})/);
if (manifestMatch) {
  const manifest = JSON.parse(manifestMatch[1]);
  const chunkKeys = Object.keys(manifest).filter(k => k.startsWith('chunks/'));
  chunkKeys.forEach(k => {
    const hashed = manifest[k];
    const fp = path.join(ROOT, hashed);
    if (!fs.existsSync(fp)) {
      console.error(`MANIFEST  ${hashed} listed in manifest but file missing`);
      issues++;
    }
  });
}

// ── Summary ────────────────────────────────────────────────────────────────
const chunks = chunkFiles.length;
console.log(`\naudit.js  chunks=${chunks}  exported-fns=${exported}  issues=${issues}`);
if (issues === 0) {
  console.log('PASS  All checks clean.');
  process.exit(0);
} else {
  console.error(`FAIL  ${issues} issue(s) found.`);
  process.exit(1);
}
