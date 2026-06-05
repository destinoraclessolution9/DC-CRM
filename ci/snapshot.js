#!/usr/bin/env node
/**
 * ci/snapshot.js — structural inventory
 *
 * Captures a JSON baseline of the codebase structure.
 * Run BEFORE any refactor phase to record the starting state.
 * The regression.js tool compares future runs against this baseline.
 *
 * Usage:
 *   node ci/snapshot.js             # print to stdout
 *   node ci/snapshot.js --save      # write ci/baseline.json
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const save = process.argv.includes('--save');

function md5(filepath) {
  try {
    return crypto.createHash('md5').update(fs.readFileSync(filepath)).digest('hex').slice(0, 8);
  } catch { return 'missing'; }
}

function countLines(filepath) {
  try { return fs.readFileSync(filepath, 'utf8').split('\n').length; } catch { return 0; }
}

// ── script.js inventory ────────────────────────────────────────────────────
const scriptSrc   = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const scriptLines = scriptSrc.split('\n');

const defined = [];
scriptLines.forEach((l, i) => {
  let m = l.match(/^    (?:async\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/);
  if (m) defined.push({ name: m[1], line: i + 1, kind: 'const' });
  m = l.match(/^    (?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
  if (m) defined.push({ name: m[1], line: i + 1, kind: 'function' });
});

// Return object keys
const returnSection = scriptLines.slice(39000).join('\n');
const returnKeys = [...returnSection.matchAll(/^        ([a-zA-Z_$][a-zA-Z0-9_$]*),\s*$/gm)]
  .map(m => m[1]);

// Private state vars
const stateVars = scriptLines
  .filter(l => /^    let _/.test(l))
  .map(l => l.match(/^    let (_\w+)/)?.[1])
  .filter(Boolean);

// ── Chunks inventory ───────────────────────────────────────────────────────
const chunkDir = path.join(ROOT, 'chunks');
const chunkFiles = fs.readdirSync(chunkDir)
  .filter(f => f.endsWith('.js') && !f.includes('.min'));

const chunks = chunkFiles.map(cf => {
  const src = fs.readFileSync(path.join(chunkDir, cf), 'utf8');
  const m   = src.match(/Object\.assign\(window\.app\s*,\s*\{([^}]+)\}/s);
  const keys = m
    ? [...m[1].matchAll(/([a-zA-Z_$][a-zA-Z0-9_$]*),/g)].map(x => x[1])
    : [];
  return { file: cf, lines: src.split('\n').length, exports: keys };
});

// ── Manifest ───────────────────────────────────────────────────────────────
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mMatch = html.match(/window\.__ASSET_MANIFEST\s*=\s*(\{[^;]+\})/);
const manifest = mMatch ? JSON.parse(mMatch[1]) : {};

// ── _appState bridge coverage ──────────────────────────────────────────────
const appStateMatch = scriptSrc.match(/window\._appState\s*=\s*\{([^}]+)\}/s);
const bridgedKeys = appStateMatch
  ? [...appStateMatch[1].matchAll(/(?:get|set)\s+([a-zA-Z_$]\w*)\s*\(/g)].map(m => m[1])
  : [];

const snapshot = {
  generated:   new Date().toISOString(),
  script: {
    lines:       scriptLines.length,
    hash:        md5(path.join(ROOT, 'script.js')),
    definedCount: defined.length,
    stateVars,
    returnKeys,
  },
  appStateBridge: [...new Set(bridgedKeys)],
  chunks,
  manifest: Object.keys(manifest),
};

const json = JSON.stringify(snapshot, null, 2);

if (save) {
  const out = path.join(__dirname, 'baseline.json');
  fs.writeFileSync(out, json);
  console.log(`Baseline saved to ${out}`);
  console.log(`  script.js: ${snapshot.script.lines} lines, ${snapshot.script.definedCount} symbols`);
  console.log(`  stateVars: ${snapshot.script.stateVars.length}`);
  console.log(`  returnKeys: ${snapshot.script.returnKeys.length}`);
  console.log(`  chunks: ${snapshot.chunks.length} (${snapshot.chunks.reduce((n,c)=>n+c.exports.length,0)} exports)`);
  console.log(`  appState bridged: ${snapshot.appStateBridge.length} keys`);
} else {
  process.stdout.write(json + '\n');
}
