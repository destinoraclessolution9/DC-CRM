// ci/test-workflows.js — GitHub Actions files that fail silently (owner 2026-11-02).
//
// WHY: these failures produced no error anywhere anyone looks.
//   • uptime.yml and deploy.yml used `secrets.` inside `if:`. GitHub refuses such
//     a file before any job starts, so the uptime alarm never ran once.
//   • backup.yml connected to db.<ref>.supabase.co, which has IPv6 records only;
//     GitHub's runners have no IPv6. 28 weekly backups failed from 2026-04-26.
//   • Before that it used a pooler host from memory. aws-0 in this region answers
//     "tenant/user not found"; the host Supabase reports for this project is aws-1.
// This pins all three, plus what the restore test needs from a plain postgres image.
//
// HARNESS: reads the real workflow files. No network, no YAML dependency.
// Run: node ci/test-workflows.js
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, got) => {
    if (got) { pass++; return; }
    fail++; console.error(`FAIL ${name}`);
};
const dir = path.join(__dirname, '..', '.github', 'workflows');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
const noComments = (s) => s.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

// `secrets` is not available in any `if:`. One such line rejects the whole file.
const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f));
ok('found the workflow files', files.length >= 5);
for (const f of files) {
    const bad = noComments(read(f)).split('\n').filter(l => /^\s*(-\s*)?if:.*\bsecrets\./.test(l));
    ok(`${f}: no secrets. inside an if:`, bad.length === 0);
    // Job-level `if:` is indented 4 spaces; `env` is not available there either.
    const jobIf = noComments(read(f)).split('\n').filter(l => /^ {4}if:.*\benv\./.test(l));
    ok(`${f}: no env. inside a job-level if:`, jobIf.length === 0);
}

const backup = noComments(read('backup.yml'));
ok('backup: never the IPv6-only direct host', !/db\.[a-z0-9]+\.supabase\.co/.test(backup));
ok('backup: the pooler host Supabase reports for this project', /PGHOST: aws-1-ap-south-1\.pooler\.supabase\.com/.test(backup));
ok('backup: session mode, pg_dump cannot use transaction mode', /PGPORT: 5432\b/.test(backup) && !/\b6543\b/.test(backup));
ok('backup: pooler user carries the project ref', /PGUSER: postgres\.remuwhxvzkzjtgbzqjaa/.test(backup));
ok('backup: password is not built into a URL', !/postgres(ql)?:\/\/[^\s]*\$\{\{/.test(backup));
ok('backup: password comes from the secret', /PGPASSWORD: \$\{\{ secrets\.SUPABASE_DB_PASSWORD \}\}/.test(backup));
ok('backup: both schemas dumped', /--schema=public/.test(backup) && /--schema=auth/.test(backup));
ok('backup: refuses an unencrypted upload', /refusing to upload an unencrypted backup/.test(backup));

// Everything the RLS policies, defaults and trigram indexes need from a plain image.
for (const need of ['CREATE ROLE anon', 'CREATE ROLE authenticated', 'CREATE SCHEMA extensions',
    'CREATE EXTENSION "uuid-ossp" SCHEMA extensions', 'CREATE EXTENSION pg_trgm SCHEMA public']) {
    ok(`restore test prepares: ${need}`, backup.includes(need));
}
ok('restore test: keeps public, where pg_trgm lives', /grep -vxE 'DROP SCHEMA IF EXISTS "public";\|CREATE SCHEMA "public";'/.test(backup));
ok('restore test: stops at the first error', (backup.match(/ON_ERROR_STOP=1/g) || []).length >= 2);

const uptime = noComments(read('uptime.yml'));
ok('uptime: still on its 10-minute schedule', /cron: '\*\/10 \* \* \* \*'/.test(uptime));
ok('uptime: webhook guard reads env', /failure\(\) && env\.OPS_SLACK_WEBHOOK != ''/.test(uptime));
ok('uptime: env copy of the secret exists', /^ {6}OPS_SLACK_WEBHOOK: \$\{\{ secrets\.OPS_SLACK_WEBHOOK \}\}/m.test(uptime));

const deploy = noComments(read('deploy.yml'));
ok('deploy: webhook guard reads env', /failure\(\) && env\.OPS_SLACK_WEBHOOK != ''/.test(deploy));
ok('deploy: promote still only on manual dispatch', /^ {4}if: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}/m.test(deploy));
ok('deploy: promote is a no-op with no hook set', /-z "\$VERCEL_PROD_DEPLOY_HOOK"[\s\S]*?exit 0/.test(deploy));

console.log(`test-workflows: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
