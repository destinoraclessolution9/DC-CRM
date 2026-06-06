#!/usr/bin/env node
/**
 * ci/patch-stubs.js — one-shot patch that adds missing stub forwarding functions
 * to script.js for every return key not locally defined in the IIFE scope.
 *
 * Without these stubs, the return statement `return { handleProspectDrag, ... }`
 * throws ReferenceError at load time and the IIFE never completes.
 *
 * Pattern: const fn = (...a) => (window.app.fn || noop)(...a)
 * A chunk's Object.assign overwrites window.app.fn with the real implementation
 * when it loads; until then the noop is harmless.
 *
 * Run once; commit the result.
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const scriptPath = path.join(ROOT, 'script.js');
const src        = fs.readFileSync(scriptPath, 'utf8');
const lines      = src.split('\n');

// ── 1. Collect locally defined symbols ────────────────────────────────────
const defined = new Set();
lines.forEach(l => {
  let m = l.match(/^[\s]*(?:async\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=;]/);
  if (m) defined.add(m[1]);
  m = l.match(/^[\s]*(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[\(\{]/);
  if (m) defined.add(m[1]);
});

// ── 2. Find the IIFE return object (the one followed by `        init,`) ───
// There are many `return {` in the file (inside functions). The IIFE's return
// is the one directly followed by `        init,` and `        navigateTo,`.
let retStart = -1;
for (let i = 0; i < lines.length - 3; i++) {
  if (/^    return \{/.test(lines[i]) &&
      lines.slice(i + 1, i + 5).some(l => /^        init,/.test(l))) {
    retStart = i;
    break;
  }
}
if (retStart < 0) { console.error('Could not find IIFE return {'); process.exit(1); }

// Scan forward to the closing `    };` (semicolon required).
// Bare `    }` also appears inside the return for catch/finally blocks.
let retEnd = retStart;
for (let i = retStart + 1; i < lines.length; i++) {
  if (/^    \};\s*$/.test(lines[i])) { retEnd = i; break; }
}

const retSection = lines.slice(retStart, retEnd + 1).join('\n');
// Match 8-space-indented bare key refs: `        keyName,`
const retKeys = [...retSection.matchAll(/^        ([a-zA-Z_$][a-zA-Z0-9_$]*),\s*$/gm)]
  .map(m => m[1]);

console.log(`Return keys found: ${retKeys.length}`);

// ── 3. Find keys that need stubs ───────────────────────────────────────────
const WINDOW_GLOBALS = new Set(['UI', 'AppDataStore', 'supabase']);
const missing = retKeys.filter(k => !defined.has(k) && !WINDOW_GLOBALS.has(k));

console.log(`Missing stubs: ${missing.length}`);
if (missing.length === 0) { console.log('Nothing to patch.'); process.exit(0); }

// ── 4. Build the stub block ────────────────────────────────────────────────
const stubLines = [
  '',
  '    // ── Auto-generated forwarding stubs (ci/patch-stubs.js, 2026-06-06) ─────────',
  '    // Every name in the return statement must be defined in the IIFE scope.',
  '    // Pattern: async so the stub always returns a Promise (safe for .catch() chains).',
  '    // Identity check prevents infinite recursion: after Object.assign, window.app.fn',
  '    // IS this stub. Once a chunk overrides it, window.app.fn !== stub → real fn runs.',
];

missing.forEach(fn => {
  stubLines.push(`    const ${fn} = async (...a) => { const _r = window.app.${fn}; if (_r && _r !== ${fn}) return _r(...a); };`);
});

stubLines.push('');

// ── 5. Insert the stub block just before the return statement ──────────────
const insertAt = retStart; // insert before return line
const newLines = [
  ...lines.slice(0, insertAt),
  ...stubLines,
  ...lines.slice(insertAt),
];

fs.writeFileSync(scriptPath, newLines.join('\n'));
console.log(`Patched script.js: inserted ${missing.length} stubs at line ${insertAt}.`);
