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
// Collect all function names exported by chunks so the return-key check
// can exempt them (they reach window.app via Object.assign, not IIFE scope).
const allChunkExports = new Set();

chunkFiles.forEach(cf => {
  const src  = fs.readFileSync(path.join(chunkDir, cf), 'utf8');
  // Use matchAll + take last match so inline comments like
  // "// Object.assign(window.app, { ... })" don't shadow the real one.
  // Match BOTH the legacy Object.assign(window.app, {...}) export and the new
  // ownership-registry form app.register('domain', {...}) (#1 god-object).
  const allMatches = [...src.matchAll(/(?:Object\.assign\(window\.app|(?:window\.)?app\.register\(\s*['"][^'"]*['"])\s*,\s*\{([^}]+)\}/gs)];
  const m = allMatches.length ? allMatches[allMatches.length - 1] : null;
  if (!m) return;

  const keys = [...m[1].matchAll(/([a-zA-Z_$][a-zA-Z0-9_$]*),/g)].map(x => x[1]);
  exported += keys.length;
  keys.forEach(k => allChunkExports.add(k));

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

// Find the IIFE's main return object — identified by being the `    return {` whose
// next few lines contain `        init,` (distinguishes it from inner-function returns).
let returnObjStart = -1;
for (let i = 0; i < scriptLines.length - 5; i++) {
  if (/^    return \{/.test(scriptLines[i]) &&
      scriptLines.slice(i + 1, i + 6).some(l => /^        init,/.test(l))) {
    returnObjStart = i;
    break;
  }
}
// Scan forward to the closing `    };` (semicolon required).
// Bare `    }` also appears inside the return for catch/finally blocks.
let returnObjEnd = returnObjStart;
for (let i = returnObjStart + 1; i < scriptLines.length; i++) {
  if (/^    \};\s*$/.test(scriptLines[i])) { returnObjEnd = i; break; }
}
const returnSection = returnObjStart >= 0
  ? scriptLines.slice(returnObjStart, returnObjEnd + 1).join('\n')
  : '';
const retKeys = [...returnSection.matchAll(/^        ([a-zA-Z_$][a-zA-Z0-9_$]*),\s*$/gm)]
  .map(m => m[1]);

// Known browser-global names resolved via window scope (not IIFE-local)
const WINDOW_GLOBALS = new Set(['UI', 'AppDataStore', 'supabase']);

// A return key is OK if it is:
//   (a) locally defined in the IIFE scope (defined set), OR
//   (b) a well-known browser global
// NOTE: being in allChunkExports is NOT sufficient — the IIFE return statement is
// evaluated synchronously at load time. Chunk functions only land in window.app via
// Object.assign AFTER their script tag executes (lazy). A return key that is only
// in a chunk and not locally stubbed will throw ReferenceError at startup.
// Therefore we do NOT exempt allChunkExports here.
const missingRet = retKeys.filter(k => !defined.has(k) && !WINDOW_GLOBALS.has(k));
if (missingRet.length) {
  console.error('RETURN  keys in return object not defined in script.js scope:');
  missingRet.forEach(k => console.error(`        ${k}`));
  issues += missingRet.length;
}

// ── 3. Ghost IIFE-var refs in chunks ──────────────────────────────────────
// Chunks are separate script files and cannot access `let _*` vars declared
// inside script.js's IIFE.  Detect bare references before they ReferenceError.
// Allowed: (a) chunk declares its own `let/const _name` alias, or (b) var is
// accessed only via `_state.key` (the _appState bridge).
const privateVars = [];
scriptLines.forEach(l => {
  const m = l.match(/^    let (_[a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=;]/);
  if (m) privateVars.push(m[1]);
});

chunkFiles.forEach(cf => {
  const csrc  = fs.readFileSync(path.join(chunkDir, cf), 'utf8');
  const clines = csrc.split('\n');

  // Names declared locally in this chunk (let/const/var aliases)
  const localDecls = new Set();
  clines.forEach(l => {
    const m = l.match(/\b(?:const|let|var)\s+(_[a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=;]/);
    if (m) localDecls.add(m[1]);
  });

  privateVars.forEach(varName => {
    if (localDecls.has(varName)) return;
    const ePat = varName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    // Flag bare word-boundary matches; skip lines where the only match is
    // prefixed by a dot (i.e. it's a property access, not a bare variable ref)
    const hits = [];
    clines.forEach((line, i) => {
      const noComment = line.replace(/\/\/.*/, '');
      if (/^\s*\*/.test(noComment)) return;               // block comment line
      const re = new RegExp('\\b' + ePat + '\\b', 'g');
      let m2;
      while ((m2 = re.exec(noComment)) !== null) {
        const before = noComment[m2.index - 1];
        if (before === '.') continue;                      // property access
        hits.push({ n: i + 1, text: noComment.trim().slice(0, 80) });
        break;
      }
    });
    if (hits.length) {
      console.error(`GHOSTVAR  ${cf} → ${varName} (not locally declared, not via _state):`);
      hits.slice(0, 2).forEach(h => console.error(`          L${h.n}: ${h.text}`));
      issues++;
    }
  });
});

// ── 4. Manifest vs chunk files ─────────────────────────────────────────────
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
