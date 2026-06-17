#!/usr/bin/env node
/**
 * ci/size-budget.js — ratchet-down file-size guard
 *
 * Records a max-LOC budget per canonical source file and fails the build if any
 * file grows past it. Budgets only ever go DOWN (re-init after a wave shrinks a
 * god-file). This locks in the Wave-2/3/4 decompositions so a future edit can't
 * silently re-bloat script-prospects.js back to 9,965 lines.
 *
 * Usage:
 *   node ci/size-budget.js          # check current LOC against ci/size-budgets.json
 *   node ci/size-budget.js --init   # (re)write budgets from current LOC + small headroom
 *
 * Headroom: budgets are set to current LOC + 2% (min +25) so trivial honest
 * growth doesn't trip CI, but a god-file can't double.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUDGETS_PATH = path.join(__dirname, 'size-budgets.json');
const INIT = process.argv.includes('--init');

function sourceFiles() {
  const out = [];
  for (const f of ['script.js', 'script-features.js', 'data.js', 'ui.js', 'app-init.js', 'auth.js', 'supabase-init.js', 'build.mjs']) {
    if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  }
  const chunkDir = path.join(ROOT, 'chunks');
  if (fs.existsSync(chunkDir)) {
    for (const f of fs.readdirSync(chunkDir)) {
      if (f.endsWith('.js') && !f.includes('.min')) out.push('chunks/' + f);
    }
  }
  return out;
}

const loc = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').length;

if (INIT) {
  const budgets = {};
  for (const f of sourceFiles()) budgets[f] = Math.max(loc(f) + 25, Math.ceil(loc(f) * 1.02));
  fs.writeFileSync(BUDGETS_PATH, JSON.stringify(budgets, null, 2) + '\n');
  console.log(`size-budget  wrote ${Object.keys(budgets).length} budgets to ci/size-budgets.json`);
  process.exit(0);
}

if (!fs.existsSync(BUDGETS_PATH)) {
  console.warn('  WARN  no ci/size-budgets.json — run: node ci/size-budget.js --init');
  process.exit(0);
}

const budgets = JSON.parse(fs.readFileSync(BUDGETS_PATH, 'utf8'));
let fails = 0;
for (const f of sourceFiles()) {
  const n = loc(f);
  const b = budgets[f];
  if (b === undefined) { console.log(`  NEW   ${f} (${n} lines) — run --init to budget it`); continue; }
  if (n > b) { console.error(`  FAIL  ${f}: ${n} lines > budget ${b}`); fails++; }
}
if (fails === 0) {
  console.log(`size-budget  PASS  all ${Object.keys(budgets).length} files within budget`);
  process.exit(0);
}
console.error(`size-budget  FAIL  ${fails} file(s) over budget`);
process.exit(1);
