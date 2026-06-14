/**
 * Phase 0 (#10) — test runner. Chains the incremental TypeScript check and the
 * data-layer contract suite. Wire ahead of deploy:  node ci/test.mjs
 * (The existing ci/regression.js — ghost-call audit + build + snapshot — still runs separately.)
 */
import { execSync } from 'node:child_process';

function step(name, cmd) {
  process.stdout.write(`\n── ${name} ${'─'.repeat(Math.max(0, 48 - name.length))}\n`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`  PASS  ${name}`);
    return true;
  } catch {
    console.log(`  FAIL  ${name}`);
    return false;
  }
}

let ok = true;
// Type-check the incrementally-typed surface (lib/types/api/tests). Non-fatal
// only while bootstrapping — flip to fatal once tsc is clean in CI.
ok = step('TypeScript (tsc --noEmit, scoped)', 'npx -y -p typescript@5.5.4 tsc --noEmit') && ok;
ok = step('Data-layer contract tests', 'node --test tests/contract/data-store.contract.test.mjs') && ok;

console.log('\n' + '─'.repeat(52));
console.log(ok ? 'TEST PASS  All green.' : 'TEST FAIL  See above.');
process.exit(ok ? 0 : 1);
