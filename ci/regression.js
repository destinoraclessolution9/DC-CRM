#!/usr/bin/env node
/**
 * ci/regression.js — full regression gate
 *
 * Runs all CI checks and compares key metrics against ci/baseline.json.
 * Fail if any check fails OR if structural metrics deviate unexpectedly.
 *
 * Usage:
 *   node ci/regression.js           # compare against baseline
 *   node ci/regression.js --init    # same as snapshot.js --save (creates baseline)
 */
'use strict';
const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'baseline.json');

if (process.argv.includes('--init')) {
  execSync(`node "${path.join(__dirname,'snapshot.js')}" --save`, { stdio: 'inherit' });
  process.exit(0);
}

let fails = 0;
const warn  = (msg) => { console.warn('  WARN  ' + msg); };
const fail  = (msg) => { console.error('  FAIL  ' + msg); fails++; };
const pass  = (msg) => { console.log ('  PASS  ' + msg); };

// ── Step 1: Ghost-call + manifest audit ────────────────────────────────────
console.log('\n── Step 1: Ghost-call audit ──────────────────────────────');
try {
  execSync(`node "${path.join(__dirname,'audit.js')}"`, { stdio: 'inherit' });
  pass('audit.js clean');
} catch {
  fail('audit.js reported issues (see above)');
}

// ── Step 2: Build check ────────────────────────────────────────────────────
console.log('\n── Step 2: Build check ───────────────────────────────────');
try {
  const out = execSync(`node "${path.join(ROOT,'build.mjs')}"`, { cwd: ROOT }).toString();
  const hasError = /error/i.test(out) && !/\[WARNING\]/.test(out);
  if (hasError) {
    fail('build.mjs reported errors');
  } else {
    pass('build.mjs succeeded');
  }
} catch (e) {
  fail('build.mjs threw: ' + e.message.slice(0, 100));
}

// ── Step 3: Snapshot comparison ────────────────────────────────────────────
console.log('\n── Step 3: Snapshot comparison ───────────────────────────');
if (!fs.existsSync(BASELINE_PATH)) {
  warn('No baseline.json — run: node ci/regression.js --init');
} else {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const current  = JSON.parse(
    execSync(`node "${path.join(__dirname,'snapshot.js')}"`, { cwd: ROOT }).toString()
  );

  // Lines should only decrease (we're removing code)
  if (current.script.lines > baseline.script.lines) {
    warn(`script.js grew: ${baseline.script.lines} → ${current.script.lines} lines`);
  } else {
    pass(`script.js lines: ${baseline.script.lines} → ${current.script.lines} (${baseline.script.lines - current.script.lines} removed)`);
  }

  // Return keys: a key dropped from the static return object is acceptable
  // IF it is now provided by a chunk's Object.assign (lazy-loaded API).
  const baseRet = new Set(baseline.script.returnKeys);
  const currRet = new Set(current.script.returnKeys);
  // Build set of all functions now exported by chunks
  const chunkExports = new Set(current.chunks.flatMap(c => c.exports));
  const dropped = [...baseRet].filter(k => !currRet.has(k) && !chunkExports.has(k));
  if (dropped.length) {
    fail(`Return keys DROPPED and not in any chunk: ${dropped.join(', ')}`);
  } else {
    pass(`Return keys: ${baseline.script.returnKeys.length} → ${current.script.returnKeys.length} (none dropped)`);
  }

  // State vars: must not grow (migrating TO _appState reduces them)
  const baseVars = baseline.script.stateVars.length;
  const currVars = current.script.stateVars.length;
  if (currVars > baseVars) {
    warn(`State vars grew: ${baseVars} → ${currVars} (expected same or fewer)`);
  } else {
    pass(`State vars: ${baseVars} → ${currVars}`);
  }

  // Chunks: must not lose exports
  const baseExports = {};
  baseline.chunks.forEach(c => { baseExports[c.file] = c.exports; });
  current.chunks.forEach(c => {
    const prev = baseExports[c.file];
    if (!prev) { pass(`  New chunk: ${c.file} (${c.exports.length} exports)`); return; }
    const dropped2 = prev.filter(k => !c.exports.includes(k));
    if (dropped2.length) {
      fail(`  ${c.file} lost exports: ${dropped2.join(', ')}`);
    } else {
      pass(`  ${c.file}: ${prev.length} → ${c.exports.length} exports`);
    }
  });

  // appState bridge: must only grow
  const baseBridge = new Set(baseline.appStateBridge);
  const currBridge = new Set(current.appStateBridge);
  const lostBridge = [...baseBridge].filter(k => !currBridge.has(k));
  if (lostBridge.length) {
    fail(`_appState bridge keys REMOVED: ${lostBridge.join(', ')}`);
  } else {
    pass(`_appState bridge: ${baseline.appStateBridge.length} → ${current.appStateBridge.length} keys`);
  }
}

// ── Step 4: React-island defineProperty canary ─────────────────────────────
// The live "Property description must be an object" crash root caused to
// esbuild es2020 lowering of React Query private class fields in
// react-island.js, which emitted Object.defineProperty(obj, key, null). Fixed
// by target: 'es2022' in vite.config.mjs. This canary fails the regression if a
// future esbuild/vite target downgrade reintroduces a null/undefined property
// descriptor. Absent island = skip (PASS), not a failure.
console.log('\n── Step 4: React-island defineProperty canary ────────────');
{
  const islandPath = path.join(ROOT, 'react-dist', 'react-island.js');
  if (!fs.existsSync(islandPath)) {
    pass('react-dist/react-island.js absent — skipping canary');
  } else {
    const islandSrc = fs.readFileSync(islandPath, 'utf8');
    if (/defineProperty\([^)]*,\s*(null|void 0|undefined)\)/.test(islandSrc)) {
      fail('react-island.js has Object.defineProperty(…, null/undefined) — es2020 private-field lowering regressed; check vite.config.mjs target (es2022)');
    } else {
      pass('react-island.js: no null/undefined property descriptors');
    }
  }
}

// ── Step 5: Anti-duplication pattern lint ──────────────────────────────────
console.log('\n── Step 5: Pattern lint ──────────────────────────────────');
try {
  execSync(`node "${path.join(__dirname,'lint-patterns.js')}" --enforce`, { stdio: 'inherit' });
  pass('lint-patterns within allowance');
} catch {
  fail('lint-patterns exceeded allowance (ci/lint-allowance.json)');
}

// ── Step 6: Size budgets ───────────────────────────────────────────────────
console.log('\n── Step 6: Size budgets ──────────────────────────────────');
try {
  execSync(`node "${path.join(__dirname,'size-budget.js')}"`, { stdio: 'inherit' });
  pass('all files within size budget');
} catch {
  fail('a source file exceeded its size budget (ci/size-budgets.json)');
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────────────────');
if (fails === 0) {
  console.log('REGRESSION PASS  All checks green.\n');
  process.exit(0);
} else {
  console.error(`REGRESSION FAIL  ${fails} check(s) failed.\n`);
  process.exit(1);
}
