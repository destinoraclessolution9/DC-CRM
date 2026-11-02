// ci/test-registration-keys.js — the reader behind ci/audit.js, ci/snapshot.js
// and ci/onclick-check.js. A misread here does not fail loudly: it reports working
// buttons as dead, or silently drops exports from the guards. The first two
// fixtures are the real shapes that did exactly that (2026-11-02).
'use strict';
const { extractBalanced, topLevelKeys, registeredKeys } = require('./registration-keys');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
};

// ── Shapes that misfired ────────────────────────────────────────────────────
eq('several keys on one line', topLevelKeys(`
    expireOldOverrides,
    bjcInput, bjcCat, bjcPage, bjcToggle,
    other,
`), ['expireOldOverrides', 'bjcInput', 'bjcCat', 'bjcPage', 'bjcToggle', 'other']);

eq('an inline arrow with a brace does not end the block', registeredKeys(`
    app.register('pipeline', {
        before,
        _plSetGoalMonthForTest: (m) => { _plGoalMonth = m; },
        after,
    });
`), ['before', '_plSetGoalMonthForTest', 'after']);

// ── The left side of a pair is the name; everything else is not a key ───────
eq('key: value keeps the key, not the value', topLevelKeys('canApproveSales: _canApprove, cwFill: _cwFill,'), ['canApproveSales', 'cwFill']);
eq('words in a comment are not keys', topLevelKeys(`
    // activity, venueVal, locationAddressEl — local vars inside updateActivity
    /* typeSelect, setField */
    real,
`), ['real']);
eq('arguments and nested keys are not keys', topLevelKeys(`
    viewEntityDetail: async (entity, id) => { switch (entity) { default: return { nested: 1, deep }; } },
    tail,
`), ['viewEntityDetail', 'tail']);
eq('a comma or brace in a string is not structure', topLevelKeys(`
    label: 'a, b } c',
    tpl: \`x, \${y}\`,
    last,
`), ['label', 'tpl', 'last']);

// ── Forms a block may use ───────────────────────────────────────────────────
eq('last key needs no trailing comma', topLevelKeys('a, b'), ['a', 'b']);
eq('methods and async methods count', topLevelKeys('foo() { return 1; }, async bar(x) { return x; },'), ['foo', 'bar']);
eq('spread, computed and quoted keys are skipped', topLevelKeys(`...base, [dyn]: 1, 'quoted': 2, kept,`), ['kept']);

// ── Blocks ──────────────────────────────────────────────────────────────────
eq('all blocks in a file count', registeredKeys(`
    app.register('a', { one });
    Object.assign(window.app, { two });
    window.app.register("b", { three });
`), ['one', 'two', 'three']);
eq('a head on a comment line is an example', registeredKeys(`
    // Object.assign(window.app, { commented, out });
     * app.register('x', { docs });
    app.register('a', { real });
`), ['real']);
eq('no block, no keys', registeredKeys('const a = 1;'), []);
eq('extractBalanced returns the rest when braces never balance', extractBalanced('{ a, b', 0), ' a, b');

console.log(`registration-keys: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
