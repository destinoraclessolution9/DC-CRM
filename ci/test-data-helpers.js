// Phase 11.3 (partial): unit tests for the extracted pure data-layer helpers.
// data-helpers.js exports via module.exports in Node — no browser globals needed.
const h = require('../data-helpers.js');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  if (got === exp) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`); }
}

// classifyQueueError — the sync-queue routing decision.
eq('dup-code', h.classifyQueueError({ code: '23505' }), 'duplicate');
eq('dup-msg', h.classifyQueueError({ message: 'duplicate key value violates unique' }), 'duplicate');
eq('fk-code', h.classifyQueueError({ code: '23503' }), 'fk');
eq('fk-msg', h.classifyQueueError({ message: 'violates foreign key constraint' }), 'fk');
eq('perm-rls', h.classifyQueueError({ message: 'new row violates row-level security policy' }), 'permanent');
eq('perm-42501', h.classifyQueueError({ code: '42501' }), 'permanent');
eq('perm-42703', h.classifyQueueError({ code: '42703' }), 'permanent');
eq('perm-pgrst204', h.classifyQueueError({ code: 'PGRST204' }), 'permanent');
eq('perm-notnull', h.classifyQueueError({ message: 'violates not-null constraint' }), 'permanent');
eq('transient', h.classifyQueueError({ code: '503', message: 'service unavailable' }), 'transient');
eq('transient-empty', h.classifyQueueError({}), 'transient');
eq('transient-null', h.classifyQueueError(null), 'transient');

// extractUnknownCol
eq('col-find-single', h.extractUnknownCol({ message: "Could not find the 'foo_bar' column of 'x' in the schema cache" }), 'foo_bar');
eq('col-relation', h.extractUnknownCol({ message: 'column "baz" of relation "tbl" does not exist' }), 'baz');
eq('col-does-not-exist', h.extractUnknownCol({ message: 'column "qux" does not exist' }), 'qux');
eq('col-none', h.extractUnknownCol({ message: 'unrelated error' }), null);
eq('col-empty', h.extractUnknownCol({}), null);

// isSchemaError
eq('schema-pgrst204', h.isSchemaError({ code: 'PGRST204' }), true);
eq('schema-42703', h.isSchemaError({ code: '42703' }), true);
eq('schema-cache', h.isSchemaError({ message: 'schema cache reload' }), true);
eq('schema-no', h.isSchemaError({ message: 'connection refused' }), false);

// isAbortError
eq('abort-name', h.isAbortError({ name: 'AbortError' }), true);
eq('abort-msg-abort', h.isAbortError({ message: 'The operation was aborted' }), true);
eq('abort-msg-cancel', h.isAbortError({ message: 'request cancelled' }), true);
eq('abort-code20', h.isAbortError({ code: '20' }), true);
eq('abort-no', h.isAbortError({ message: 'genuine failure' }), false);
eq('abort-null', h.isAbortError(null), false);

// snapshotsDiffer
eq('snap-same', h.snapshotsDiffer([{ id: 1, updated_at: 'a' }], [{ id: 1, updated_at: 'a' }]), false);
eq('snap-same-order', h.snapshotsDiffer([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]), false);
eq('snap-len', h.snapshotsDiffer([{ id: 1 }], [{ id: 1 }, { id: 2 }]), true);
eq('snap-stamp', h.snapshotsDiffer([{ id: 1, updated_at: 'a' }], [{ id: 1, updated_at: 'b' }]), true);
eq('snap-nonarray', h.snapshotsDiffer(null, []), true);

// customerFieldsFromProspect — the prospect→customer profile copy (2026-10-16).
{
  const p = {
    id: 7, full_name: 'TEST Lee', phone: '0123', email: '', ic_number: null, date_of_birth: '',
    life_chart_type: 'both', ming_gua: 'MG4', business_name: 'Kopi Co', is_own_business: false,
    tags: [], notes: 'likes tea', cps_attachment: {}, children: '[{"name":"A"}]',
    // pipeline-only — must NOT be copied
    pipeline_stage: 'won', protection_deadline: '2026-01-01', manual_grade: 'A', closing_record: { x: 1 },
  };
  const c = h.customerFieldsFromProspect(p, { email: 'cr@x.com', ic_number: '900101-01-1234', date_of_birth: '1990-01-01', address: 'Jalan 1' });
  eq('copy-name', c.full_name, 'TEST Lee');
  eq('copy-lct', c.life_chart_type, 'both');           // was dropped by every old path
  eq('copy-mg', c.ming_gua, 'MG4');
  eq('copy-business', c.business_name, 'Kopi Co');
  eq('copy-false-kept', c.is_own_business, false);      // false is a value, not blank
  eq('copy-notes', c.notes, 'likes tea');
  eq('copy-children', c.children, '[{"name":"A"}]');
  eq('blank-array-null', c.tags, null);
  eq('blank-object-null', c.cps_attachment, null);
  eq('cr-email-fill', c.email, 'cr@x.com');             // profile blank → closing value
  eq('cr-ic-fill', c.ic_number, '900101-01-1234');
  eq('cr-dob-fill', c.date_of_birth, '1990-01-01');
  eq('cr-address-fill', c.address, 'Jalan 1');
  eq('no-pipeline', 'pipeline_stage' in c, false);
  eq('no-grade', 'manual_grade' in c, false);
  eq('no-closing', 'closing_record' in c, false);
  eq('no-id', 'id' in c, false);
  eq('no-country', 'country' in c, false);              // caller normalizes country
  // Profile value beats the closing's; a bad closing DOB never reaches a DATE column.
  const c2 = h.customerFieldsFromProspect({ email: 'p@x.com', city: 'KL' }, { email: 'cr@x.com', date_of_birth: '01/01/1990', address: 'Jalan 1' });
  eq('profile-wins', c2.email, 'p@x.com');
  eq('bad-dob-null', c2.date_of_birth, null);
  eq('structured-address-wins', c2.address, null);
  eq('dob-never-empty-string', h.customerFieldsFromProspect({ date_of_birth: '' }).date_of_birth, null);
  // Every listed field is present on the output (so a create writes all of them).
  eq('all-fields', h.PROSPECT_PROFILE_FIELDS.every(f => f in h.customerFieldsFromProspect({})), true);

  // customerBackfillPatch — fills blanks only, never overwrites.
  const patch = h.customerBackfillPatch(
    { full_name: 'Newer Name', life_chart_type: null, ming_gua: '', phone: '0199', responsible_agent_id: 5 },
    { full_name: 'Old Name', life_chart_type: 'solar', ming_gua: 'MG2', phone: '0123', responsible_agent_id: 9, notes: 'n' });
  eq('bf-fill-lct', patch.life_chart_type, 'solar');
  eq('bf-fill-mg', patch.ming_gua, 'MG2');
  eq('bf-fill-notes', patch.notes, 'n');
  eq('bf-keep-name', 'full_name' in patch, false);
  eq('bf-keep-phone', 'phone' in patch, false);
  eq('bf-keep-owner', 'responsible_agent_id' in patch, false);
  eq('bf-empty', Object.keys(h.customerBackfillPatch({ full_name: 'A' }, { full_name: 'B' })).length, 0);
}

// Inline files in closing_record / closing_records_history (2026-11-02): the data
// layer finds every base64 data URL, uploads it, and swaps in the storage path.
{
  const jpg = 'data:image/jpeg;base64,' + Buffer.from('JPEGBYTES').toString('base64');
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4').toString('base64');
  const cr = { status: 'approved', invoice_file: 'invoices/1_a.jpg', delivery_proof: jpg,
    pre2025_purchases: [{ product: 'Ring', attachment_data: pdf }, { product: 'B', attachment_data: null }] };
  const hist = [{ invoice_file: jpg, n: 3 }, { invoice_file: 'https://x/y.png' }];
  const found = h.findInlineFiles([cr, hist]);
  eq('find-count-dedup', found.length, 2);
  eq('find-jpg', found.includes(jpg), true);
  eq('find-pdf', found.includes(pdf), true);
  eq('find-none-paths', h.findInlineFiles({ a: 'invoices/x.jpg', b: ['https://q/data:x'], c: 5, d: null }).length, 0);
  eq('find-not-text-data', h.findInlineFiles('data:text/plain,hello').length, 0);
  const swaps = new Map([[jpg, 'closing-files/9_1_inline_1.jpg'], [pdf, 'closing-files/9_2_inline_2.pdf']]);
  const cr2 = h.swapInlineFiles(cr, swaps);
  eq('swap-delivery', cr2.delivery_proof, 'closing-files/9_1_inline_1.jpg');
  eq('swap-nested', cr2.pre2025_purchases[0].attachment_data, 'closing-files/9_2_inline_2.pdf');
  eq('swap-keeps-path', cr2.invoice_file, 'invoices/1_a.jpg');
  eq('swap-keeps-null', cr2.pre2025_purchases[1].attachment_data, null);
  eq('swap-keeps-other', cr2.status, 'approved');
  eq('swap-copy', cr.delivery_proof, jpg);
  const hist2 = h.swapInlineFiles(hist, swaps);
  eq('swap-array', Array.isArray(hist2) && hist2[0].invoice_file === 'closing-files/9_1_inline_1.jpg' && hist2[0].n === 3, true);
  const d = h.decodeInlineFile(jpg);
  eq('decode-mime', d.mime, 'image/jpeg');
  eq('decode-ext', d.ext, '.jpg');
  eq('decode-bytes', Buffer.from(d.bytes).toString(), 'JPEGBYTES');
  eq('decode-pdf-ext', h.decodeInlineFile(pdf).ext, '.pdf');
  eq('decode-jpg-alias', h.decodeInlineFile('data:image/jpg;base64,QQ==').mime, 'image/jpeg');
  eq('decode-not-dataurl', h.decodeInlineFile('invoices/x.jpg'), null);
}

console.log(`\ndata-helpers-test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
