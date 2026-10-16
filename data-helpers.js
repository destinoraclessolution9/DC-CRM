/**
 * Feng Shui CRM — Data-layer pure helpers (Phase 11.3 partial: separation of concerns).
 *
 * These are the STATELESS classifier/parser functions the DataStore used to carry
 * as instance methods even though they touch no `this` state. Extracting them into
 * a dedicated, independently-testable module decouples the data layer's pure logic
 * from its stateful orchestration (network/cache/sync/queue), per the clean-arch
 * brief. DataStore keeps thin delegator methods (so every existing call site —
 * this._classifyQueueError(e), etc. — is unchanged), but the implementation lives
 * here and is unit-tested directly (ci/test-data-helpers.js).
 *
 * Loaded as a classic script BEFORE data.js (see index.html). No imports, no state.
 */
(function () {
    'use strict';

    // Classify a Supabase/PostgREST write error so the sync queue can decide:
    // duplicate (drop), fk (bounded retry), permanent (park), transient (retry).
    function classifyQueueError(error) {
        const code = String((error && error.code) || '');
        const msg = [error && error.message, error && error.details, error && error.hint]
            .filter(Boolean).join(' ');
        if (code === '23505' || /duplicate key value/i.test(msg)) return 'duplicate';
        // FK violation (23503): the referenced parent row may simply not have
        // synced YET — e.g. an activity created offline replays before its
        // prospect. Dead-lettering it loses the record even though a later pass
        // (once the parent lands) would succeed. Classify as bounded-retry 'fk';
        // the caller retries a few times before parking.
        if (code === '23503' || /violates foreign key constraint/i.test(msg)) return 'fk';
        if (/^22/.test(code) || /^23/.test(code) || code === '42501' || code === '42703' || code === 'PGRST204'
            || /invalid input syntax|violates (not-null|check) constraint|row-level security|schema cache/i.test(msg)) {
            return 'permanent';
        }
        return 'transient';
    }

    // Extract the offending column name from a schema-mismatch error, if any.
    function extractUnknownCol(e) {
        const sources = [e && e.message, e && e.details, e && e.hint, e && e.error].filter(Boolean).join(' ');
        if (!sources) return null;
        // PostgREST/Supabase: "Could not find the 'col' column of 'table' in the schema cache"
        return (sources.match(/find the '(\w+)' column/) || [])[1]
            || (sources.match(/find the "(\w+)" column/) || [])[1]
            // PostgreSQL: column "col" of relation / column "col" does not exist
            || (sources.match(/column "?(\w+)"? of relation/) || [])[1]
            || (sources.match(/column "?(\w+)"? does not exist/) || [])[1]
            || null;
    }

    // True when the error is a schema-cache / unknown-column mismatch (→ retry with '*').
    function isSchemaError(e) {
        const s = [e && e.code, e && e.message, e && e.details].filter(Boolean).join(' ');
        return /PGRST204|42703|schema cache|does not exist|could not find/i.test(s);
    }

    // True when a read was aborted by abortInflight() (view-change) — not a real error.
    function isAbortError(err) {
        if (!err) return false;
        if (err.name === 'AbortError') return true;
        // DOMException.ABORT_ERR === 20. A native DOMException exposes `code` as
        // the NUMBER 20, so the string compare alone never matches a real abort —
        // accept both the numeric and string forms.
        if (err.code === 20 || err.code === '20') return true;
        // A real server-side failure carries a Postgres/PostgREST error code (e.g.
        // statement timeout 57014 → "canceling statement due to statement timeout",
        // failed transaction 25P02 → "current transaction is aborted"). Those
        // messages contain 'cancel'/'abort' but must NOT be treated as harmless
        // client aborts, or _getInRange would return a partial page as a complete
        // result. Only fall back to substring matching when there is no such code.
        const code = String((err && err.code) || '');
        if (code && /^\d/.test(code)) return false;
        const msg = String(err.message || err.toString() || '').toLowerCase();
        return msg.includes('abort') || msg.includes('cancel');
    }

    // Stable content hash of a row's scalar fields — used as the fingerprint
    // fallback when a row carries NO modified-stamp. Some tables (data.js
    // _NO_DELTA_TABLES: special_program_participants, cps_intake_requests,
    // pipeline_config, pipeline_config_history) lack updated_at/created_at/
    // modified_at entirely, so an `id:` stamp degrades to a constant and an
    // in-place field edit (same id, same length, no bumped timestamp) would be
    // invisible — suppressing the SWR view refresh. Serializing the row's
    // sorted scalar columns makes such edits detectable. Objects/arrays are
    // skipped (cheap, deterministic, avoids deep-walk cost on hot SWR path).
    function rowContentHash(r) {
        if (!r || typeof r !== 'object') return String(r);
        return Object.keys(r).sort().map(k => {
            const v = r[k];
            if (v === null || v === undefined) return `${k}=`;
            const t = typeof v;
            if (t === 'object') return `${k}=~`; // skip nested objects/arrays
            return `${k}=${v}`;
        }).join(',');
    }

    // Cheap structural diff of two row snapshots used by SWR to decide whether a
    // background refresh changed anything. Fingerprints each row by id + its
    // last-modified stamp; for rows that expose NO modified-stamp it falls back
    // to a content hash of the row's scalar fields so a server-side field edit
    // on a timestamp-less table (same id, same length, no bumped timestamp) is
    // still detected instead of silently compared equal.
    function snapshotsDiffer(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return true;
        if (a.length !== b.length) return true;
        const fingerprint = (arr) =>
            arr.map(r => {
                const stamp = r && (r.updated_at || r.created_at || r.modified_at);
                // No modified-stamp → fall back to a content-aware hash so
                // in-place edits on timestamp-less tables aren't missed.
                return stamp ? `${r.id}:${stamp}` : `${r && r.id}:#${rowContentHash(r)}`;
            }).sort().join('|');
        return fingerprint(a) !== fingerprint(b);
    }

    // Referral-network counts for the mobile Clients list: for each person,
    // how many CPS-verified people they referred directly, and how many are in
    // their entire downline group (all levels). Pure — takes plain row arrays.
    //
    // Model notes (see MOBILE_REFERRAL_COUNT_PLAN.md):
    // - Three referral write shapes exist: {referrer_id, referrer_type} (CPS
    //   intake + manual referral), {referrer_customer_id} (customer "Refer a
    //   Friend" — carries NO referrer_id), plus prospects stamped with
    //   referred_by_id/referred_by_type (safety net for rows whose auto-referral
    //   insert failed; deduped against the referrals rows by (parent, child)).
    // - A customer with converted_from_prospect_id collapses into its prospect
    //   node so chains survive conversion (B converts, then refers → still B's
    //   group).
    // - Only members that "did CPS" are COUNTED, but traversal passes through
    //   every member (A→M(no CPS)→N(CPS): N counts for A, M doesn't). Markers:
    //   referral row source 'CPS', prospect cps_form_date/cps_form_url/
    //   cps_agent_id, or a CPS activity on either identity.
    function buildReferralCounts(opts) {
        const referrals  = (opts && opts.referrals)  || [];
        const prospects  = (opts && opts.prospects)  || [];
        const customers  = (opts && opts.customers)  || [];
        const activities = (opts && opts.activities) || [];

        const custToProspect = new Map();
        for (const c of customers) {
            if (c && c.id != null && c.converted_from_prospect_id != null) {
                custToProspect.set(String(c.id), String(c.converted_from_prospect_id));
            }
        }
        const canon = (type, id) => {
            if (id == null || id === '') return null;
            const t = String(type || 'prospect').toLowerCase();
            if (t === 'customer') {
                const p = custToProspect.get(String(id));
                return p ? `prospect:${p}` : `customer:${id}`;
            }
            return `${t}:${id}`;
        };

        const cps = new Set();
        for (const a of activities) {
            if (!a || a.activity_type !== 'CPS') continue;
            if (a.prospect_id != null) cps.add(canon('prospect', a.prospect_id));
            if (a.customer_id != null) cps.add(canon('customer', a.customer_id));
        }
        for (const p of prospects) {
            if (!p || p.id == null) continue;
            if (p.cps_form_date || p.cps_form_url || p.cps_agent_id) cps.add(`prospect:${p.id}`);
        }

        // parent canonical key → Set of child canonical keys (children are
        // always prospects — referred_prospect_id is the only child pointer).
        const children = new Map();
        const addEdge = (parentKey, childProspectId, viaCpsIntake) => {
            if (!parentKey || childProspectId == null) return;
            const childKey = canon('prospect', childProspectId);
            if (childKey === parentKey) return; // self-referral bad data
            let set = children.get(parentKey);
            if (!set) { set = new Set(); children.set(parentKey, set); }
            set.add(childKey);
            // A referral row written by the CPS intake flow is itself proof the
            // referred person came for CPS (survives RLS-scoped-out activities).
            if (viaCpsIntake) cps.add(childKey);
        };
        for (const r of referrals) {
            if (!r || r.referred_prospect_id == null) continue;
            const viaCps = r.referral_source === 'CPS';
            if (r.referrer_id != null) {
                addEdge(canon(r.referrer_type || 'prospect', r.referrer_id), r.referred_prospect_id, viaCps);
            } else if (r.referrer_customer_id != null) {
                addEdge(canon('customer', r.referrer_customer_id), r.referred_prospect_id, viaCps);
            }
        }
        for (const p of prospects) {
            if (!p || p.id == null || p.referred_by_id == null) continue;
            addEdge(canon(p.referred_by_type || 'prospect', p.referred_by_id), p.id, false);
        }

        // BFS with a visited set — referral data can contain cycles (A→B→A);
        // the walk must terminate and count each member once.
        const countsFor = (type, id) => {
            const start = canon(type, id);
            if (!start) return { direct: 0, total: 0 };
            const kids = children.get(start);
            let direct = 0;
            if (kids) for (const k of kids) { if (cps.has(k)) direct++; }
            let total = 0;
            const visited = new Set([start]);
            const queue = kids ? Array.from(kids) : [];
            for (let i = 0; i < queue.length; i++) {
                const k = queue[i];
                if (visited.has(k)) continue;
                visited.add(k);
                if (cps.has(k)) total++;
                const next = children.get(k);
                if (next) for (const n of next) { if (!visited.has(n)) queue.push(n); }
            }
            return { direct, total };
        };

        return { countsFor };
    }

    // ── Meeting minutes (ChatGPT paste) ─────────────────────────────────────
    // Agents write their minutes in ChatGPT with a fixed 8-section prompt and
    // paste the result into the Minutes form. parseMeetingMinutes splits it by
    // section header; matchMinutesItems maps free-text bullets onto the form's
    // checkbox lists. Both are pure — the DOM side lives in the activities chunk.
    // Tolerant of: `1.` / `1、` / `###` / `**bold**` headers, `Header: value` on
    // one line, `-` `*` `•` bullets, Chinese/English/mixed, missing sections,
    // and the template's own placeholder lines ("[Action 1]").
    const MINUTES_SECTIONS = [
        { key: 'outcome',       list: false, kw: ['会面结果', '会议结果', '见面结果', 'meeting result', 'meeting outcome', 'outcome', 'result'] },
        { key: 'background',    list: false, kw: ['客户背景', 'customer background', 'client background', 'background'] },
        { key: 'keyPoints',     list: false, kw: ['会面重点', '会议重点', '见面重点', 'meeting key points', 'key points discussed', 'key points'] },
        { key: 'advisor',       list: false, kw: ['顾问观察与建议', '顾问观察', '顾问建议', 'advisor observations & suggestions', 'advisor observations and suggestions', 'advisor observations', 'advisor observation', 'advisor suggestions', 'advisor'] },
        { key: 'reaction',      list: false, kw: ['客户反应与dc记录', '客户反应', 'dc记录', 'customer reaction & dc records', 'customer reaction and dc records', 'customer reaction', 'dc records', 'reaction'] },
        { key: 'nextActions',   list: true,  kw: ['后续跟进与下一步行动', '后续跟进', '下一步行动', '下一步', 'next actions', 'next action', 'next steps', 'follow up', 'follow-up'] },
        { key: 'opportunities', list: true,  kw: ['潜在机会与产品', '潜在机会', 'potential & opportunities', 'potential and opportunities', 'potential & opportunity', 'opportunities', 'opportunity', 'products'] },
        { key: 'grade',         list: false, kw: ['客户评级', '评级', '等级', 'grade'] },
    ];
    const _HDR_DECOR = /^\s*(?:#{1,6}\s*|\*\*|【|(?:\d{1,2}|[一二三四五六七八九十])\s*[.、)）]\s*)/;
    const _BULLET = /^\s*(?:[-•·▪●◦]|\*(?!\*))\s*/;
    const _PLACEHOLDER = /^\s*(?:\[[^\]]*\]|(?:action|product|item)\s*\d+|-{3,}.*|.*output format (?:start|end).*)\s*$/i;
    const _stripDecor = (s) => String(s)
        .replace(/^\s*#{1,6}\s*/, '').replace(/\*\*/g, '').replace(/[【】]/g, '')
        .replace(/^\s*(?:\d{1,2}|[一二三四五六七八九十])\s*[.、)）]\s*/, '')
        .trim();

    // Returns { key, rest } when the line is a section header, else null.
    function _minutesHeader(line, seen) {
        if (_BULLET.test(line) && !/^\s*\*\*/.test(line)) return null;
        const decorated = _HDR_DECOR.test(line);
        const body = _stripDecor(line);
        if (!body) return null;
        const ci = body.search(/[:：]/);
        const head = (ci >= 0 ? body.slice(0, ci) : body).trim();
        const rest = ci >= 0 ? body.slice(ci + 1).trim() : '';
        if (!head || head.length > 70) return null;
        const lower = head.toLowerCase();
        for (const sec of MINUTES_SECTIONS) {
            const kws = sec.kw.slice().sort((a, b) => b.length - a.length);
            const hit = kws.find(k => lower.includes(k));
            if (!hit) continue;
            // Residue = what's left after removing the section's own words and the
            // bilingual "(English name)" — a real header is (almost) nothing else.
            let residue = lower.replace(/[(（][^)）]*[)）]/g, '');
            for (const k of kws) residue = residue.split(k).join('');
            residue = residue.replace(/[\s与和及&/,，、.。:：\-–—]|and/g, '');
            if (!decorated && !lower.startsWith(hit) && !lower.replace(/[(（][^)）]*[)）]/g, '').trim().endsWith(hit)) return null;
            if (residue.length > (decorated ? 6 : 1)) return null;
            if (seen.has(sec.key)) return null; // second "header" of a seen section = content
            return { key: sec.key, rest };
        }
        return null;
    }

    function _minutesGrade(text) {
        const s = String(text || '').trim();
        const up = s.match(/(?:^|[^A-Za-z])([ABCDF])(?![A-Za-z])/);
        if (up) return up[1];
        const lone = s.match(/^[\s\-•*]*([abcdf])[\s.。]*$/);
        return lone ? lone[1].toUpperCase() : null;
    }

    // Order matters: "not interested" contains "interested"; 没兴趣 before 兴趣.
    const _OUTCOME_SYNONYMS = [
        ['not_interested', /not[\s_-]*interested|没兴趣|没有兴趣|不感兴趣|无兴趣|不想要|拒绝|停止|🚫/i],
        ['negative', /negative|cooled?|负面|消极|冷淡|不好|👎/i],
        ['neutral', /neutral|中立|中性|一般|普通|还好|😐/i],
        ['positive', /positive|moving forward|正面|积极|良好|顺利|很好|有兴趣|感兴趣|👍/i],
    ];
    function _minutesOutcome(text) {
        const s = String(text || '');
        for (const [val, re] of _OUTCOME_SYNONYMS) if (re.test(s)) return val;
        return null;
    }

    function parseMeetingMinutes(text) {
        const out = { sections: {}, found: [], grade: null, outcome: null, recognized: false };
        const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
        const seen = new Set();
        const buf = {};
        let cur = null;
        for (const raw of lines) {
            if (!raw.trim()) continue;
            const hdr = _minutesHeader(raw, seen);
            if (hdr) {
                cur = hdr.key;
                seen.add(cur);
                buf[cur] = [];
                if (hdr.rest && !_PLACEHOLDER.test(hdr.rest)) buf[cur].push({ text: hdr.rest, bullet: false });
                continue;
            }
            if (!cur) continue; // preamble before the first header
            if (_PLACEHOLDER.test(raw.replace(_BULLET, ''))) continue;
            const bullet = _BULLET.test(raw) || /^\s*\d{1,2}[.)、]\s+/.test(raw);
            const t = raw.replace(_BULLET, '').replace(/^\s*\d{1,2}[.)、]\s+/, '').replace(/\*\*/g, '').trim();
            if (!t || _PLACEHOLDER.test(t)) continue;
            buf[cur].push({ text: t, bullet });
        }
        for (const sec of MINUTES_SECTIONS) {
            const items = buf[sec.key];
            if (!items) continue;
            out.recognized = true;
            if (!items.length) continue;
            if (sec.list) {
                out.sections[sec.key] = items.map(i => i.text);
            } else {
                const multi = items.length > 1;
                out.sections[sec.key] = items.map(i => (multi && i.bullet ? '• ' : '') + i.text).join('\n');
            }
            out.found.push(sec.key);
        }
        if (out.sections.grade) out.grade = _minutesGrade(out.sections.grade);
        if (out.sections.outcome) out.outcome = _minutesOutcome(out.sections.outcome);
        return out;
    }

    // Map free-text bullets onto a checkbox list (product names / next-action
    // categories). Exact containment first (longest name wins, so 汇集简易-Condo
    // beats 汇集-简易), then a unique distinctive-run match (CJK ≥2 chars or a
    // Latin phrase ≥5 chars), else the bullet is a leftover for the remarks box.
    // A matched bullet that carries extra detail (a date, a reason) is ALSO
    // returned in `extra` so the detail is kept in remarks, never lost.
    const _mNorm = (s) => String(s || '').normalize('NFKC').toLowerCase()
        .replace(/[\s\-–—_·•.,，。、:：;；!?！？()（）[\]【】'"“”‘’/\\|+*#~]/g, '');
    const _mRuns = (s) => {
        const runs = [];
        const str = String(s || '').normalize('NFKC').toLowerCase();
        (str.match(/[㐀-鿿]{2,}/g) || []).forEach(r => runs.push(r));
        (str.match(/[a-z0-9][a-z0-9 &]*[a-z0-9]/g) || []).forEach(r => { const n = _mNorm(r); if (n.length >= 5) runs.push(n); });
        return runs;
    };
    function matchMinutesItems(items, candidates) {
        const cands = Array.from(new Set((candidates || []).filter(Boolean).map(String)))
            .map(name => ({ name, n: _mNorm(name), runs: _mRuns(name) }))
            .filter(c => c.n.length >= 2);
        const matched = [];
        const leftovers = [];
        const extra = [];
        for (const item of (items || [])) {
            const n = _mNorm(item);
            if (!n) continue;
            let hits = cands.filter(c => n.includes(c.n));
            if (hits.length > 1) hits = hits.filter(h => !hits.some(o => o !== h && o.n.includes(h.n)));
            if (!hits.length && n.length >= 2) {
                const rev = cands.filter(c => c.n.includes(n));
                if (rev.length === 1) hits = rev;
            }
            if (!hits.length) {
                const byRun = cands.filter(c => c.runs.some(r => n.includes(r)));
                if (byRun.length === 1) hits = byRun;
            }
            if (!hits.length) { leftovers.push(item); continue; }
            hits.forEach(h => { if (!matched.includes(h.name)) matched.push(h.name); });
            const longest = Math.max(...hits.map(h => h.n.length));
            if (n.length - longest >= 2) extra.push(item);
        }
        return { matched, leftovers, extra };
    }

    // ── Prospect → customer profile copy (2026-10-16) ─────────────────────────
    // After conversion the CUSTOMER is the one editable record, so it must carry
    // every person-profile field the prospect had. The conversion paths used to
    // hand-pick ~25 fields each (and differently), which silently dropped e.g.
    // life_chart_type on 89 of 154 customers and ming_gua on 42. One list, used
    // by every customer-creating path. Sales-pipeline fields (pipeline_stage,
    // protection_deadline, deal_value, manual_grade, closing_record, ...) are NOT
    // here: they stay on the prospect as frozen history. `country` is left to the
    // caller (it needs UI.countryByCode normalization).
    const PROSPECT_PROFILE_FIELDS = [
        'title', 'full_name', 'nickname', 'gender', 'nationality', 'phone', 'email',
        'ic_number', 'date_of_birth', 'lunar_birth', 'life_chart_type', 'ming_gua', 'element',
        'occupation', 'company_name', 'income_range',
        'address', 'city', 'state', 'postal_code',
        'marital_status', 'children', 'spouse_name',
        'referred_by', 'referred_by_id', 'referred_by_type', 'referral_relationship',
        'responsible_agent_id',
        // customers columns added by migrations/customer_profile_columns_2026-10-16.sql
        'is_own_business', 'business_name', 'business_industry', 'business_area',
        'business_title_role', 'business_started', 'company_size',
        'source', 'original_source', 'cps_interest',
        'cps_form_url', 'cps_form_name', 'cps_form_date', 'cps_attachment',
        'notes', 'interests', 'pain_points', 'budget_range', 'decision_maker', 'tags',
    ];
    const _isBlankVal = (v) => v == null
        || (typeof v === 'string' && v.trim() === '')
        || (Array.isArray(v) && v.length === 0)
        || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

    // Customer fields copied from a prospect. Blank prospect values become null —
    // never '' (DATE columns reject an empty string, which used to fail every
    // conversion of a prospect with no DOB). `closingRecord` fills the contact
    // details captured at the sale (order-form photo / IC) that the profile lacks.
    function customerFieldsFromProspect(prospect, closingRecord) {
        const p = prospect || {};
        const cr = closingRecord || {};
        const out = {};
        PROSPECT_PROFILE_FIELDS.forEach(f => { out[f] = _isBlankVal(p[f]) ? null : p[f]; });
        ['phone', 'email', 'ic_number'].forEach(f => {
            if (out[f] == null && !_isBlankVal(cr[f])) out[f] = cr[f];
        });
        if (out.date_of_birth == null && /^\d{4}-\d{2}-\d{2}$/.test(String(cr.date_of_birth || ''))) out.date_of_birth = cr.date_of_birth;
        // A structured address (city/state/postcode) wins over the closing's one-line address.
        if (out.address == null && out.city == null && out.state == null && out.postal_code == null && !_isBlankVal(cr.address)) out.address = cr.address;
        return out;
    }

    // Patch that fills the customer's BLANK profile fields from its prospect —
    // never overwrites a value the customer already has (it may be newer).
    function customerBackfillPatch(customer, prospect) {
        const c = customer || {};
        const src = customerFieldsFromProspect(prospect);
        const patch = {};
        PROSPECT_PROFILE_FIELDS.forEach(f => {
            if (f === 'responsible_agent_id') return; // ownership is managed on the customer
            if (_isBlankVal(c[f]) && src[f] != null) patch[f] = src[f];
        });
        return patch;
    }

    const api = { classifyQueueError, extractUnknownCol, isSchemaError, isAbortError, snapshotsDiffer, buildReferralCounts, parseMeetingMinutes, matchMinutesItems, PROSPECT_PROFILE_FIELDS, customerFieldsFromProspect, customerBackfillPatch };
    // Browser global (loaded before data.js). Also export for Node tests.
    if (typeof window !== 'undefined') window._dataHelpers = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
