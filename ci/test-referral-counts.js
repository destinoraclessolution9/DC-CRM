// Unit tests for buildReferralCounts (mobile Clients list CPS referral chips).
// Mirrors ci/test-data-helpers.js: data-helpers.js exports via module.exports in Node.
const h = require('../data-helpers.js');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${g} expected ${e}`); }
}

const cpsRef = (referrerId, referredId, type = 'prospect') => ({
  referrer_id: referrerId, referrer_type: type, referred_prospect_id: referredId, referral_source: 'CPS',
});

// ── 1. The user's canonical example — A→B,C,D; B→E,F; F→I,J,K; K→Y,Z (all CPS)
{
  const referrals = [
    cpsRef(1, 2), cpsRef(1, 3), cpsRef(1, 4),   // A → B C D
    cpsRef(2, 5), cpsRef(2, 6),                 // B → E F
    cpsRef(6, 7), cpsRef(6, 8), cpsRef(6, 9),   // F → I J K
    cpsRef(9, 10), cpsRef(9, 11),               // K → Y Z
  ];
  const c = h.buildReferralCounts({ referrals });
  eq('example-A', c.countsFor('prospect', 1), { direct: 3, total: 10 });
  eq('example-B', c.countsFor('prospect', 2), { direct: 2, total: 7 });
  eq('example-F', c.countsFor('prospect', 6), { direct: 3, total: 5 });
  eq('example-K', c.countsFor('prospect', 9), { direct: 2, total: 2 });
  eq('example-C-leaf', c.countsFor('prospect', 3), { direct: 0, total: 0 });
}

// ── 2. Traversal passes THROUGH a non-CPS member but does not count them
{
  const referrals = [
    { referrer_id: 1, referrer_type: 'prospect', referred_prospect_id: 20 }, // A→M manual, M no CPS
    cpsRef(20, 21),                                                          // M→N via CPS intake
  ];
  const c = h.buildReferralCounts({ referrals });
  eq('passthrough-A', c.countsFor('prospect', 1), { direct: 0, total: 1 }); // N counts, M doesn't
  eq('passthrough-M', c.countsFor('prospect', 20), { direct: 1, total: 1 });
}

// ── 3. Cycle in bad data must terminate and count each member once
{
  const referrals = [cpsRef(1, 2), { referrer_id: 2, referrer_type: 'prospect', referred_prospect_id: 1 }];
  const prospects = [{ id: 1, cps_form_date: '2026-01-01' }];
  const c = h.buildReferralCounts({ referrals, prospects });
  eq('cycle-A', c.countsFor('prospect', 1), { direct: 1, total: 1 });
  eq('cycle-B', c.countsFor('prospect', 2), { direct: 1, total: 1 });
}

// ── 4. Chain survives conversion + customer "Refer a Friend" rows (no referrer_id)
{
  const referrals = [
    cpsRef(1, 2),                                                  // A → B (prospect)
    { referrer_customer_id: 100, referred_prospect_id: 3 },        // B-as-customer → E
  ];
  const customers = [{ id: 100, converted_from_prospect_id: 2 }];
  const prospects = [{ id: 3, cps_form_url: 'https://x/y.jpg' }];  // E did CPS (row marker)
  const c = h.buildReferralCounts({ referrals, customers, prospects });
  eq('conversion-A', c.countsFor('prospect', 1), { direct: 1, total: 2 });
  eq('conversion-B-as-customer', c.countsFor('customer', 100), { direct: 1, total: 1 });
  eq('conversion-B-as-prospect', c.countsFor('prospect', 2), { direct: 1, total: 1 });
}

// ── 5. CPS marker via activities (manual referral, CPS recorded later)
{
  const referrals = [{ referrer_id: 1, referrer_type: 'prospect', referred_prospect_id: 2 }];
  const activities = [{ activity_type: 'CPS', prospect_id: 2 }];
  const c = h.buildReferralCounts({ referrals, activities });
  eq('activity-marker', c.countsFor('prospect', 1), { direct: 1, total: 1 });
  // CPS activity on the CUSTOMER identity of a converted member also marks them
  const c2 = h.buildReferralCounts({
    referrals,
    customers: [{ id: 200, converted_from_prospect_id: 2 }],
    activities: [{ activity_type: 'CPS', customer_id: 200 }],
  });
  eq('activity-marker-converted', c2.countsFor('prospect', 1), { direct: 1, total: 1 });
}

// ── 6. prospects.referred_by_id safety net + dedupe against the referrals row
{
  const prospects = [
    { id: 2, referred_by_id: 1, referred_by_type: 'prospect', cps_agent_id: 9 }, // stamp only (insert failed)
  ];
  const c = h.buildReferralCounts({ prospects });
  eq('stamp-only', c.countsFor('prospect', 1), { direct: 1, total: 1 });
  const c2 = h.buildReferralCounts({ referrals: [cpsRef(1, 2)], prospects }); // row AND stamp → one edge
  eq('stamp-dedupe', c2.countsFor('prospect', 1), { direct: 1, total: 1 });
}

// ── 7. Referrer types that aren't prospects; empty/garbage inputs
{
  const referrals = [cpsRef(50, 2, 'user')]; // consultant referrer
  const c = h.buildReferralCounts({ referrals });
  eq('user-referrer', c.countsFor('user', 50), { direct: 1, total: 1 });
  eq('unknown-person', c.countsFor('prospect', 999), { direct: 0, total: 0 });
  eq('null-id', c.countsFor('prospect', null), { direct: 0, total: 0 });
  const c2 = h.buildReferralCounts({});
  eq('empty-inputs', c2.countsFor('prospect', 1), { direct: 0, total: 0 });
  const c3 = h.buildReferralCounts({ referrals: [null, {}, { referred_prospect_id: 7 }] });
  eq('garbage-rows', c3.countsFor('prospect', 1), { direct: 0, total: 0 });
  // Self-referral row must not create a self-loop
  const c4 = h.buildReferralCounts({ referrals: [cpsRef(1, 1)] });
  eq('self-referral', c4.countsFor('prospect', 1), { direct: 0, total: 0 });
}

console.log(`test-referral-counts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
