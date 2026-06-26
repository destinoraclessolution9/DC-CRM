/**
 * CRM Lazy Chunk: Pipeline & Sales Force Module
 * Covers: Pipeline view, Pipeline config, Action Plan, Focus List, Pipeline Rules,
 *   Month Focus archive/history/search/team view.
 * Loaded on-demand when navigating to the pipeline view.
 * Extracted 2026-06-05 (~2837 lines).
 */
(() => {
    const _state = window._appState;
    const _utils = window._crmUtils;
    const esc     = (...a) => _utils.escapeHtml(...a);
    const escapeHtml = esc;
    const getVisibleUserIds = (u) => _utils.getVisibleUserIds(u);
    const isSystemAdmin        = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isMarketingManager   = (u) => _utils.isMarketingManager(u || _state.cu);
    const isAgent              = (u) => _utils.isAgent(u || _state.cu);
    const isManagement         = (u) => _utils.isManagement(u || _state.cu);
    const isTeamLeaderOrAbove  = (u) => _utils.isTeamLeaderOrAbove(u || _state.cu);
    const _getUserLevel        = (u) => _utils.getUserLevel(u);
    const getAgentsAndLeaders  = () => _utils.getAgentsAndLeaders();
    const navigateTo           = (v) => window.app.navigateTo(v);
    const withTimeout          = (...a) => _utils.withTimeout(...a);
    const isAgentOrLeader      = (u) => _utils.isAgentOrLeader(u || _state.cu);
    const getVisibleProspects  = () => _utils.getVisibleProspects();
    const getVisibleActivities = () => _utils.getVisibleActivities();
    // Cross-chunk helper: calculatePotentialValue lives as a LOCAL const inside the
    // marketing chunk IIFE and is NOT on window/_crmUtils, so referencing it bare here
    // threw ReferenceError (audit L2883/L3225). Prefer a shared _crmUtils copy if one is
    // ever published; otherwise use this local copy that mirrors the marketing version.
    const calculatePotentialValue = (prospect) => {
        if (_utils && typeof _utils.calculatePotentialValue === 'function') return _utils.calculatePotentialValue(prospect);
        if (!prospect) return 'RM 0';
        let baseValue = 5000;
        let scoreBonus = (prospect.score || 0) * 10;
        let modifier = 0;
        if (prospect.income_range && prospect.income_range.includes('15,000')) modifier += 2000;
        if (prospect.occupation && (prospect.occupation.toLowerCase().includes('business') || prospect.occupation.toLowerCase().includes('owner'))) modifier += 1500;
        const val = baseValue + scoreBonus + modifier;
        return `RM ${val.toLocaleString()} `;
    };
    let _draggedId = null; // shared between handleDragStart and handleDrop
    // Synchronous in-flight guard for the legacy drag-to-Closed-Won close path
    // (closeDealWon). Keyed on prospectId so a double-fire of the modal action / two
    // rapid drops can't create two customer rows for the same prospect (audit L2770).
    const _closeWonInFlight = new Set();
    // Guards for the expired-focus archive migration (see _runPipelineArchive).
    // _pipelineArchiveInFlight: prevents concurrent runs racing into double-archive.
    // _pipelineArchiveDone: per-session set of "userId|month|prospectId" keys already
    //   handled this session, so repeated view-opens don't re-process the same items.
    let _pipelineArchiveInFlight = false;
    const _pipelineArchiveDone = new Set();

// ========== PHASE 6: PIPELINE & SALES FORCE MODULE ==========

// ===== PIPELINE MANAGEMENT — v6 Activity-Scored Model with Editable Config =====
//
// Philosophy: CPS is a hard gate. After CPS, every activity adds a decay-weighted
// contribution to each product category via a multiplier matrix. The best-scoring
// category becomes the "Target to Sign". Referral from a recent-purchase customer
// adds a flat +20% bonus. All weights are editable by Super Admin at runtime and
// persisted in the pipeline_config Supabase table.

const DEFAULT_PIPELINE_CONFIG = {
    version: 1,
    updated_at: null,
    updated_by: null,
    categories: [
        { id: 'powerring',     name: 'Power Ring (九星助命)',      products: 'PR4 Power Ring — premium feng shui ring',       default_amount: 2500 },
        { id: 'fengshui',      name: '风水方案 (Fengshui Solution)', products: 'Residential audit, office audit, landform',   default_amount: 5000 },
        { id: 'calligraphy',   name: '画作 (Calligraphy)',           products: 'Wealth / health / blessing calligraphy pieces', default_amount: 2800 },
        { id: 'agent_package', name: '代理配套 (Agent Package)',    products: 'DC agent recruitment package',                  default_amount: null },
        { id: 'bujishu',       name: 'Bujishu (满堂系列)',           products: 'Bed set, curtains, sofa, furniture package',    default_amount: 8500 },
        { id: 'formula',       name: 'Formula Healthcare',            products: 'Formula supplements, health plan, wellness',    default_amount: 1200 },
    ],
    activity_weights: {
        CPS:      15,
        MUSEUM:    6,
        FSA:       8,
        FTF:       8,
        EVENT:     6,
        CALL:      3,
        WHATSAPP:  2,
        EMAIL:     2,
    },
    decay_tiers: [
        { max_days:  30, factor: 1.00, label: 'Hot — full signal' },
        { max_days:  60, factor: 0.50, label: 'Grey zone begins — cooling' },
        { max_days: 120, factor: 0.25, label: 'Deep grey — needs reactivation' },
        { max_days: null, factor: 0.00, label: 'Expired' },
    ],
    event_boosters: [
        { name: '个人风水基础课',     pattern: '个人风水基础课|personal.?fengshui.?basic',                  multipliers: { powerring: 2.0 } },
        { name: '个人改命分享会',     pattern: '个人改命分享会|personal.?destiny.?change',                   multipliers: { powerring: 2.0 } },
        { name: '环境风水基础课',     pattern: '环境风水基础课|environment.?fengshui.?basic',                multipliers: { fengshui: 2.0 } },
        { name: '老板每月主题课',     pattern: '老板每月主题课|boss.?monthly.?theme',                         multipliers: { fengshui: 1.8 } },
        { name: '运程讲座',           pattern: '运程讲座|fortune.?lecture',                                   multipliers: { fengshui: 1.5 } },
        { name: '汇集',               pattern: '汇集|hui.?ji',                                                 multipliers: { fengshui: 2.5, calligraphy: 2.5 } },
        { name: '风水改命分享会',     pattern: '风水改命分享会|fengshui.?destiny.?change',                   multipliers: { fengshui: 2.0 } },
        { name: '画作分享会',         pattern: '画作分享会|画作分|calligraphy.?sharing|painting.?sharing',    multipliers: { calligraphy: 2.0 } },
        { name: '艺品分享会',         pattern: '艺品分享会|art.?piece.?sharing',                             multipliers: { calligraphy: 2.0 } },
        { name: 'DC 招商会',          pattern: 'DC.?招商会|招商会|agent.?recruitment',                        multipliers: { agent_package: 2.5 } },
        { name: 'Bujishu 分享会',     pattern: 'bujishu.?分享会|bujishu.?sharing',                           multipliers: { bujishu: 2.0 } },
        { name: 'Bujishu 新品发布会', pattern: 'bujishu.?新品发布会|bujishu.?product.?launch',               multipliers: { bujishu: 2.5 } },
        { name: 'Formula 展览',       pattern: 'formula.?展览|formula.?exhibition',                          multipliers: { formula: 2.0 } },
        { name: 'Formula 新品发布会', pattern: 'formula.?新品发布会|formula.?product.?launch',               multipliers: { formula: 2.5 } },
        { name: 'Formula Member Day', pattern: 'formula.?member.?day',                                        multipliers: { formula: 2.0 } },
        { name: 'Formula 分享会',     pattern: 'formula.?分享会|formula.?sharing',                           multipliers: { formula: 2.0 } },
    ],
    activity_multipliers: {
        MUSEUM:        { powerring: 1.5, fengshui: 1.2, calligraphy: 1.2 },
        FSA:           { fengshui: 1.5, calligraphy: 2.0 },
        FTF:           { agent_package: 1.2, bujishu: 1.2 },
        FTF_HANDS_ON:  { bujishu: 2.5, _pattern: 'wang.?house|mattress|bed.?set|curtain|sofa' },
    },
    constants: {
        score_to_prob_k: 2.5,
        referral_customer_bonus_pct: 20,
        referral_customer_purchase_window_days: 180,
        cps_required: true,
        history_retention: 25,
    },
};

// Module-level cache — populated on first load, invalidated on save
let _pipelineConfig = null;
let _pipelineConfigLoading = null;

const loadPipelineConfig = async () => {
    if (_pipelineConfig) return _pipelineConfig;
    if (_pipelineConfigLoading) return _pipelineConfigLoading;
    _pipelineConfigLoading = (async () => {
        try {
            const rows = await AppDataStore.query('pipeline_config', { id: 1 });
            if (rows.length && rows[0].config_json) {
                const raw = rows[0].config_json;
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                // Shallow-merge with defaults so missing keys don't crash the engine
                _pipelineConfig = {
                    ...DEFAULT_PIPELINE_CONFIG,
                    ...parsed,
                    constants: { ...DEFAULT_PIPELINE_CONFIG.constants, ...(parsed.constants || {}) },
                    activity_weights: { ...DEFAULT_PIPELINE_CONFIG.activity_weights, ...(parsed.activity_weights || {}) },
                };
                return _pipelineConfig;
            }
        } catch (e) { /* fallthrough to defaults */ }
        _pipelineConfig = JSON.parse(JSON.stringify(DEFAULT_PIPELINE_CONFIG));
        return _pipelineConfig;
    })();
    try {
        return await _pipelineConfigLoading;
    } finally {
        _pipelineConfigLoading = null;
    }
};

const savePipelineConfigJson = async (newConfig, note = '') => {
    newConfig = {
        ...newConfig,
        version: (newConfig.version || 0) + 1,
        updated_at: new Date().toISOString(),
        updated_by: _state.cu?.id || null,
    };
    // 1. Write current config
    try {
        const existing = await AppDataStore.query('pipeline_config', { id: 1 });
        const payload = { id: 1, config_json: newConfig, updated_by: newConfig.updated_by, updated_at: newConfig.updated_at };
        if (existing.length) {
            await AppDataStore.update('pipeline_config', 1, payload);
        } else {
            await AppDataStore.create('pipeline_config', payload);
        }
    } catch (e) {
        console.warn('savePipelineConfigJson: primary write failed', e);
    }
    // 2. Append to history
    try {
        await AppDataStore.create('pipeline_config_history', {
            config_json: newConfig,
            updated_by: newConfig.updated_by,
            updated_at: newConfig.updated_at,
            note: note || `v${newConfig.version}`,
        });
        // Trim to retention limit (default 25)
        const retention = newConfig.constants?.history_retention || 25;
        const history = await AppDataStore.query('pipeline_config_history', {});
        if (history.length > retention) {
            const sorted = [...history].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
            const toDelete = sorted.slice(retention);
            for (const h of toDelete) {
                try { await AppDataStore.delete('pipeline_config_history', h.id); } catch (_) {}
            }
        }
    } catch (e) { /* offline fallback */ }
    _pipelineConfig = newConfig;
    return newConfig;
};

// ---- Perf helper: bucket activities by prospect_id ONCE (O(n)) so callers can
// do a Map lookup per prospect instead of a full-array .filter() per prospect
// (de-quadratifies the pipeline render). Preserves insertion order within each
// bucket, so `_actsByProspect.get(p.id) || []` is element-for-element identical
// to the old `allActivities.filter(a => a.prospect_id === p.id)` (raw `===` key).
const _groupActivitiesByProspect = (allActivities) => {
    const m = new Map();
    for (const a of (allActivities || [])) {
        const k = a.prospect_id;          // RAW key — preserve existing `=== p.id` semantics
        let bucket = m.get(k);
        if (!bucket) { bucket = []; m.set(k, bucket); }
        bucket.push(a);
    }
    return m;
};

// ---- Perf helper: bucket an array by a String()-coerced key field ONCE (O(n))
// so bulk-calc callers can do a Map lookup per id instead of a full-array
// .filter() per id (de-quadratifies the pipeline prefetch scans). Iterates in
// order + pushes, so `m.get(String(id)) || []` is element-for-element / order
// identical to the old `arr.filter(x => String(x[field]) === String(id))`.
// Uses String() keys to EXACTLY match the existing `String(...) === String(...)`
// comparisons in checkReferralBonus / getPipelineAmount (loose-on-coercion).
const _bucketByStringKey = (arr, field) => {
    const m = new Map();
    for (const x of (arr || [])) {
        const k = String(x[field]);       // String() — matches existing `String(x.k) === String(id)`
        let bucket = m.get(k);
        if (!bucket) { bucket = []; m.set(k, bucket); }
        bucket.push(x);
    }
    return m;
};

// ---- Scoring helper: decay factor for a given activity age in days ----
const _pipelineDecayFactor = (days, config) => {
    for (const tier of config.decay_tiers) {
        if (tier.max_days === null || tier.max_days === undefined) return tier.factor;
        if (days <= tier.max_days) return tier.factor;
    }
    return 0;
};

// ---- Activity text resolver: concatenate all searchable fields for an activity,
// including the linked event title via event_id lookup.
// The activities table uses columns like activity_title, summary, discussion_summary,
// note_key_points, note_outcome, note_next_steps, note_needs, note_pain_points —
// NOT event_title / notes. The canonical event name lives in events.title.
const _pipelineActivityText = (activity, eventsMap) => {
    const parts = [
        activity.activity_title || '',
        activity.summary || '',
        activity.discussion_summary || '',
        activity.note_key_points || '',
        activity.note_outcome || '',
        activity.note_next_steps || '',
        activity.note_needs || '',
        activity.note_pain_points || '',
        activity.venue || '',
        activity.solution_sold || '',
    ];
    if (activity.event_id && eventsMap) {
        const ev = eventsMap.get(activity.event_id) || eventsMap.get(String(activity.event_id));
        if (ev) parts.push(ev.title || ev.name || '');
    }
    return parts.filter(Boolean).join(' ');
};

// Module-level cache for events table (TTL 60s) — avoids re-fetching on every score
let _pipelineEventsCache = null;
let _pipelineEventsCacheTs = 0;
const _getPipelineEventsMap = async () => {
    if (_pipelineEventsCache && Date.now() - _pipelineEventsCacheTs < 60000) {
        return _pipelineEventsCache;
    }
    const map = new Map();
    try {
        const events = await AppDataStore.getAll('events');
        for (const e of (events || [])) {
            map.set(e.id, e);
            map.set(String(e.id), e);
        }
    } catch (_) {}
    _pipelineEventsCache = map;
    _pipelineEventsCacheTs = Date.now();
    return map;
};
const _invalidatePipelineEventsCache = () => { _pipelineEventsCache = null; };

// ---- Perf helper: compile a case-insensitive RegExp ONCE per pattern string.
// _pipelineActivityMultiplier runs per (category × activity); recompiling the
// same booster patterns inside that loop was wasteful. Caching by pattern string
// is behavior-identical — these patterns carry no `g`/`y` flag, so `.test()` is
// stateless and a cached instance returns the same result as a fresh `new RegExp`.
// A bad pattern caches `null` so we skip it exactly as the old try/catch did.
const _pipelineRegexCache = new Map();
const _pipelineCompileRegex = (pattern) => {
    if (_pipelineRegexCache.has(pattern)) return _pipelineRegexCache.get(pattern);
    let re;
    try { re = new RegExp(pattern, 'i'); } catch (_) { re = null; }
    _pipelineRegexCache.set(pattern, re);
    return re;
};

// ---- Scoring helper: how much does this activity multiply category X? ----
const _pipelineActivityMultiplier = (activity, categoryId, config, text) => {
    const type = activity.activity_type;
    const title = text || _pipelineActivityText(activity, null);
    if (type === 'EVENT') {
        // Match event boosters by regex in priority order
        for (const booster of (config.event_boosters || [])) {
            const _re = _pipelineCompileRegex(booster.pattern);
            if (_re && _re.test(title)) {
                return booster.multipliers[categoryId] || 1.0;
            }
        }
        return 1.0;
    }
    if (type === 'FTF') {
        const handsOn = config.activity_multipliers?.FTF_HANDS_ON;
        if (handsOn && handsOn._pattern) {
            const _re = _pipelineCompileRegex(handsOn._pattern);
            if (_re && _re.test(title)) {
                return handsOn[categoryId] || 1.0;
            }
        }
    }
    const row = config.activity_multipliers?.[type];
    if (row && row[categoryId] != null) return row[categoryId];
    return 1.0;
};

// ---- Referral bonus: +20% if prospect was referred by a customer with a purchase
// in the last N days (default 180) ----
// allReferrals / allPurchases are optional pre-fetched arrays (avoids N+1 in bulk calcs).
// referralsByProspect / purchasesByCustomer are optional pre-bucketed Maps (DE-QUAD:
// O(1) lookup per prospect instead of re-scanning the whole array each call). When a
// Map is present it wins; else fall back to the array .filter; else the network query.
const checkReferralBonus = async (prospect, config, allReferrals, allPurchases, referralsByProspect, purchasesByCustomer) => {
    const windowDays = config.constants?.referral_customer_purchase_window_days || 180;
    const bonusPct = config.constants?.referral_customer_bonus_pct || 20;
    const result = { applied: false, bonusPct, reason: '' };

    // Path A: structured referrals table
    let referrerCustomerId = null;
    try {
        let referrals;
        if (referralsByProspect) {
            referrals = referralsByProspect.get(String(prospect.id)) || [];
        } else if (allReferrals) {
            referrals = allReferrals.filter(r => String(r.referred_prospect_id) === String(prospect.id));
        } else {
            referrals = await AppDataStore.query('referrals', { referred_prospect_id: prospect.id });
        }
        const customerRef = (referrals || []).find(r => r.referrer_type === 'customer');
        if (customerRef) referrerCustomerId = customerRef.referrer_id;
    } catch (_) {}

    // Path B: fallback to prospect.referrer_name → lookup in customers table
    if (!referrerCustomerId && prospect.referrer_name) {
        try {
            const needle = String(prospect.referrer_name).trim().toLowerCase();
            if (needle) {
                // Scale-safe: trigram search for the referrer by name instead of
                // scanning the whole customers table; reapply the exact full_name
                // match. (customers have no `name` column — that legacy check was a
                // no-op.) Falls back to the whole-table scan on error.
                let candidates;
                try {
                    candidates = await AppDataStore.searchCustomers(prospect.referrer_name, { limit: 50 });
                } catch (e) {
                    candidates = await AppDataStore.getAll('customers');
                }
                const match = (candidates || []).find(c => String(c.full_name || '').trim().toLowerCase() === needle);
                if (match) referrerCustomerId = match.id;
            }
        } catch (_) {}
    }

    if (!referrerCustomerId) {
        result.reason = 'No customer referrer';
        return result;
    }
    result.referrerCustomerId = referrerCustomerId;

    // Verify at least one purchase within the purchase window
    let purchases = [];
    try {
        if (purchasesByCustomer) {
            purchases = purchasesByCustomer.get(String(referrerCustomerId)) || [];
        } else if (allPurchases) {
            purchases = allPurchases.filter(p => String(p.customer_id) === String(referrerCustomerId));
        } else {
            purchases = await AppDataStore.query('purchases', { customer_id: referrerCustomerId });
        }
    } catch (_) {}
    if (!purchases.length) {
        result.reason = 'Referrer has no purchases';
        return result;
    }
    const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const recent = purchases.find(p => {
        const dateStr = p.purchase_date || p.created_at || p.date || null;
        if (!dateStr) return false;
        return new Date(dateStr).getTime() >= cutoffMs;
    });
    if (!recent) {
        result.reason = `Last customer purchase older than ${windowDays} days`;
        return result;
    }
    result.applied = true;
    result.lastPurchaseDate = recent.purchase_date || recent.created_at || recent.date;
    return result;
};

// ---- MAIN: calculate pipeline entry for one prospect ----
// Returns an object with qualified flag, probability, category, breakdown, referral info
// prefetched: optional { allReferrals, allPurchases, allSolutions } to avoid N+1 in bulk calcs
const calcPipelineEntry = async (prospect, prospectActivities, prefetched) => {
    const config = await loadPipelineConfig();
    const eventsMap = await _getPipelineEventsMap();
    const now = new Date();

    // Latest activity metadata (for UI: "last activity" label + legacy fields)
    let lastActivityDate = null;
    let latestOppPotential = '';
    let latestNextAction = '';
    if (prospectActivities.length > 0) {
        // MUST copy before sort: prospectActivities is a SHARED bucket from _actsByProspect (perf de-quad). In-place sort would corrupt other prospects' lookups.
        const sorted = [...prospectActivities].sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));
        lastActivityDate = new Date(sorted[0].activity_date);
        latestOppPotential = sorted.find(a => a.opportunity_potential?.trim())?.opportunity_potential || '';
        latestNextAction = sorted.find(a => a.next_action?.trim())?.next_action || '';
    }
    const daysSinceLast = lastActivityDate
        ? Math.floor((now - lastActivityDate) / (1000 * 60 * 60 * 24))
        : 999;

    // CPS HARD GATE — no CPS anywhere in history means prospect is not scored
    const hasCPS = prospectActivities.some(a => a.activity_type === 'CPS');
    if (config.constants?.cps_required && !hasCPS) {
        return {
            qualified: false,
            probability: 0,
            category: null,
            categoryScores: {},
            breakdown: [],
            referralInfo: { applied: false, reason: 'CPS gate: no CPS on file' },
            daysSinceLast,
            lastActivityDate,
            latestOppPotential,
            latestNextAction,
            action: 'Book CPS discovery session — required to enter pipeline',
            reason: 'No CPS on file',
        };
    }

    // Pre-resolve activity text AND parse each activity's date ONCE so we don't
    // rebuild text / re-parse Dates per-category in the scoring loop below.
    // (now - new Date(d)) === (now.getTime() - new Date(d).getTime()), so caching
    // the parsed timestamp keeps the computed `age` byte-identical.
    const nowMs = now.getTime();
    const activityTexts = new Map();
    const activityTs = new Map();
    for (const act of prospectActivities) {
        activityTexts.set(act, _pipelineActivityText(act, eventsMap));
        activityTs.set(act, new Date(act.activity_date).getTime());
    }

    // Score every category using weights × decay × multiplier
    const categoryScores = {};
    const breakdownByCat = {};
    const categories = config.categories || [];
    for (const cat of categories) {
        let score = 0;
        const contribs = [];
        for (const act of prospectActivities) {
            const base = config.activity_weights?.[act.activity_type] || 0;
            if (base === 0) continue;
            const age = Math.floor((nowMs - activityTs.get(act)) / (1000 * 60 * 60 * 24));
            const decay = _pipelineDecayFactor(age, config);
            if (decay === 0) continue;
            const text = activityTexts.get(act) || '';
            const mult = _pipelineActivityMultiplier(act, cat.id, config, text);
            const contribution = base * decay * mult;
            if (contribution > 0) {
                score += contribution;
                contribs.push({
                    activity_type: act.activity_type,
                    event_title: text.slice(0, 40),
                    age_days: age,
                    base,
                    decay,
                    multiplier: mult,
                    contribution: Math.round(contribution * 100) / 100,
                });
            }
        }
        categoryScores[cat.id] = Math.round(score * 100) / 100;
        breakdownByCat[cat.id] = contribs;
    }

    // Pick best category
    let bestCatId = null;
    let bestScore = 0;
    for (const [id, s] of Object.entries(categoryScores)) {
        if (s > bestScore) {
            bestScore = s;
            bestCatId = id;
        }
    }

    if (bestScore === 0) {
        return {
            qualified: false,
            probability: 0,
            category: null,
            categoryScores,
            breakdown: [],
            referralInfo: { applied: false, reason: 'CPS present but no scoring activity within decay window' },
            daysSinceLast,
            lastActivityDate,
            latestOppPotential,
            latestNextAction,
            action: 'Reactivate with an event invitation or follow-up call',
            reason: 'No scoring activity',
        };
    }

    const bestCategory = categories.find(c => c.id === bestCatId) || null;
    const K = config.constants?.score_to_prob_k || 2.5;
    let probability = Math.min(100, Math.round(bestScore * K));

    // Apply customer referral bonus
    const referralInfo = await checkReferralBonus(prospect, config, prefetched?.allReferrals, prefetched?.allPurchases, prefetched?.referralsByProspect, prefetched?.purchasesByCustomer);
    if (referralInfo.applied) {
        probability = Math.min(100, probability + referralInfo.bonusPct);
    }

    const action = generatePipelineAction(bestCategory, daysSinceLast, true, referralInfo, breakdownByCat[bestCatId]);

    return {
        qualified: true,
        probability,
        category: bestCategory,
        categoryScores,
        breakdown: breakdownByCat[bestCatId] || [],
        referralInfo,
        rawScore: bestScore,
        daysSinceLast,
        lastActivityDate,
        latestOppPotential,
        latestNextAction,
        action,
        // Legacy fields (some UI code reads these)
        missingPrereqs: [],
        completedPrereqs: [],
    };
};

const generatePipelineAction = (category, daysSinceLast, isQualified, referralInfo, breakdown) => {
    if (!category) return 'Reactivate with a call or event invite';
    if (!isQualified) return 'Book next CPS / activity to enter pipeline';
    const catId = category.id;
    const name = escapeHtml(category.name || '');
    // Hands-on close for bujishu
    if (catId === 'bujishu') {
        const hasWangHouse = (breakdown || []).some(b => /wang.?house|mattress|bed.?set|curtain|sofa/i.test(b.event_title || ''));
        if (hasWangHouse) return `Close ${name} — prospect has touched product, follow up within 7 days`;
        return `Schedule Wang House / mattress / curtain / sofa trial — unlocks Bujishu close`;
    }
    if (catId === 'powerring') {
        if (daysSinceLast <= 30) return `Send Power Ring quotation + 九星 reading summary — follow up within 7 days`;
        if (daysSinceLast <= 60) return `Re-engagement: invite to next 个人改命分享会`;
        return `Win-back: reactivate via personal 9-stars session`;
    }
    if (catId === 'fengshui') {
        if (daysSinceLast <= 30) return `Send Fengshui audit proposal — follow up within 7 days`;
        if (daysSinceLast <= 60) return `Re-engagement: invite to next 汇集 or 环境风水基础课`;
        return `Win-back call: offer free Fengshui assessment`;
    }
    if (catId === 'calligraphy') {
        if (daysSinceLast <= 30) return `Send 画作 sample photos + price list — follow up within 7 days`;
        if (daysSinceLast <= 60) return `Re-engagement: invite to next 画作分享会`;
        return `Win-back: share latest 艺品 launch photos`;
    }
    if (catId === 'formula') {
        if (daysSinceLast <= 30) return `Send Formula starter pack offer — follow up within 7 days`;
        if (daysSinceLast <= 60) return `Re-engagement: invite to next Formula Member Day`;
        return `Win-back: special health package`;
    }
    if (catId === 'agent_package') {
        if (daysSinceLast <= 30) return `Send 代理配套 current-month pricing + DC onboarding plan`;
        if (daysSinceLast <= 60) return `Re-engagement: invite to next DC 招商会`;
        return `Win-back: 1-on-1 agent package discussion`;
    }
    // Plain text only (audit L576): entry.action is consumed both escaped (focus-row
    // custom path / React payload, where tags render as literal '<strong>') and raw —
    // so embedding HTML here double-encodes. Emphasis belongs to the render layer.
    if (daysSinceLast <= 30) return `Send proposal for ${name} – follow up within 7 days`;
    if (daysSinceLast <= 60) return 'Re-engagement call – offer free sharing class';
    return 'Win-back campaign – special discount to reactivate';
};

// One-time cleanup: rename legacy 汇聚 → 汇集 across activities AND events.
// Scans activity_title, summary, discussion_summary, note_key_points, events.title etc.
const _huijiMigrationRan = { flag: false };
const runHuiJiMigration = async () => {
    if (_huijiMigrationRan.flag) return;
    _huijiMigrationRan.flag = true;
    const textFields = ['activity_title', 'summary', 'discussion_summary', 'note_key_points', 'note_outcome', 'note_next_steps'];
    try {
        const acts = await AppDataStore.getAll('activities');
        for (const a of acts || []) {
            const updates = {};
            for (const f of textFields) {
                if (a[f] && /汇聚/.test(a[f])) updates[f] = a[f].replace(/汇聚/g, '汇集');
            }
            if (Object.keys(updates).length) {
                try { await AppDataStore.update('activities', a.id, updates); } catch (_) {}
            }
        }
        const events = await AppDataStore.getAll('events');
        for (const e of events || []) {
            const updates = {};
            if (e.title && /汇聚/.test(e.title)) updates.title = e.title.replace(/汇聚/g, '汇集');
            if (e.description && /汇聚/.test(e.description)) updates.description = e.description.replace(/汇聚/g, '汇集');
            if (Object.keys(updates).length) {
                try { await AppDataStore.update('events', e.id, updates); } catch (_) {}
            }
        }
    } catch (_) { /* offline fallback */ }
};

// Archive expired monthly-focus items SAFELY. Runs off the render path.
// Guarantees:
//  - no concurrent / redundant runs (module-level in-flight + per-session done-set)
//  - ordered per item: confirm/create archive row FIRST; only delete source if archived
//  - idempotent: skips items already present in monthly_focus_archive (or already done this session)
//  - never swallows silently: every failure is console.warn'd and counted
const _runPipelineArchive = async (expiredItems, userId, actsByProspect) => {
    if (!expiredItems || expiredItems.length === 0) return;
    if (_pipelineArchiveInFlight) return; // another run is already processing
    _pipelineArchiveInFlight = true;
    let archived = 0, failures = 0;
    try {
        for (const item of expiredItems) {
            const doneKey = `${userId}|${item.focus_month}|${item.prospect_id}`;
            if (_pipelineArchiveDone.has(doneKey)) continue; // already handled this session
            try {
                const ep = await AppDataStore.getById('prospects', item.prospect_id);
                if (!ep) {
                    // Source prospect is gone — nothing to archive; safe to drop the dangling focus row.
                    await AppDataStore.delete('my_potential_list', item.id);
                    _pipelineArchiveDone.add(doneKey);
                    continue;
                }
                // Idempotency: do not duplicate an existing archive row for this user+month+prospect.
                let existing = [];
                try {
                    existing = await AppDataStore.query('monthly_focus_archive', { user_id: userId, month: item.focus_month, prospect_id: item.prospect_id });
                } catch (e) {
                    // Could not confirm idempotency — abort this item rather than risk a duplicate or a
                    // delete-without-archive. Leave the source row intact for a later run.
                    console.warn('[pipeline-archive] idempotency check failed; skipping item', item.id, e);
                    failures++;
                    continue;
                }
                let archiveConfirmed = existing.length > 0;
                if (!archiveConfirmed) {
                    const eActs = (actsByProspect && actsByProspect.get(ep.id)) || [];
                    const eEntry = await calcPipelineEntry(ep, eActs);
                    const eAmt = await getPipelineAmount(ep, eEntry.category);
                    try {
                        await AppDataStore.create('monthly_focus_archive', {
                            user_id: userId, month: item.focus_month, prospect_id: item.prospect_id,
                            priority_order: item.priority_order,
                            target_product: item.target_product || eEntry.latestOppPotential || eEntry.category?.name || '',
                            amount: eAmt, probability: String(eEntry.probability || 0),
                            action_needed: eEntry.latestNextAction || ''
                        });
                        archiveConfirmed = true;
                    } catch (e) {
                        // Archive create failed — DO NOT delete the source row. Skip; retry next run.
                        console.warn('[pipeline-archive] archive create failed; keeping source row', item.id, e);
                        failures++;
                        continue;
                    }
                }
                // Only reach here when the archive row is confirmed to exist.
                if (archiveConfirmed) {
                    try {
                        await AppDataStore.delete('my_potential_list', item.id);
                        _pipelineArchiveDone.add(doneKey);
                        archived++;
                    } catch (e) {
                        // Archive exists but source delete failed — idempotency check above will
                        // prevent a duplicate archive on the next run, so just log and retry later.
                        console.warn('[pipeline-archive] source delete failed (archive already exists)', item.id, e);
                        failures++;
                    }
                }
            } catch (e) {
                console.warn('[pipeline-archive] unexpected error processing item', item && item.id, e);
                failures++;
            }
        }
        if (archived > 0) UI.toast.info(`${archived} expired focus item(s) archived from last month.`);
        if (failures > 0) console.warn(`[pipeline-archive] completed with ${failures} failure(s); ${archived} archived.`);
    } finally {
        _pipelineArchiveInFlight = false;
    }
};

const getNoteCount = async (prospectId) => {
    const notes = await AppDataStore.query('notes', { prospect_id: prospectId });
    const activities = await AppDataStore.query('activities', { prospect_id: prospectId });
    return notes.length + activities.length;
};

const getProspectOutcome = async (prospect) => {
    if (prospect.status === 'converted') return 'Won';
    if (prospect.status === 'lost') return 'Lost';
    const purchases = await AppDataStore.query('purchases', { prospect_id: prospect.id });
    if (purchases.length > 0) return 'Won';
    return 'Open';
};

// allSolutions: optional pre-fetched array to avoid N+1 in bulk calcs.
// solutionsByProspect: optional pre-bucketed Map (DE-QUAD: O(1) lookup per prospect
// instead of re-scanning the whole array each call). Map wins; else array .filter;
// else network query. Only [0].amount / .length are read — shared bucket is safe.
const getPipelineAmount = async (prospect, category, allSolutions, solutionsByProspect) => {
    let solutions;
    if (solutionsByProspect) {
        solutions = solutionsByProspect.get(String(prospect.id)) || [];
    } else if (allSolutions) {
        solutions = allSolutions.filter(s => String(s.prospect_id) === String(prospect.id));
    } else {
        solutions = await AppDataStore.query('proposed_solutions', { prospect_id: prospect.id });
    }
    if (solutions.length > 0 && solutions[0].amount) return solutions[0].amount;
    if (prospect.estimated_value_max) return prospect.estimated_value_max;
    if (prospect.estimated_value_min) return prospect.estimated_value_min;
    // v6: default_amount may be null (e.g. agent_package) → caller decides how to render
    if (category?.default_amount != null) return category.default_amount;
    if (category?.defaultAmount != null) return category.defaultAmount; // legacy fallback
    return null;
};

let _pipelineAgentFilter = 'all';
let _pipelineStatusFilter = 'all';
let _focusViewMonth = 'current'; // 'current' or 'YYYY-MM' for viewing archived month

// React-island flag (default-on, PROMOTED 2026-06-16 after opt-in verify:
// useEffect-ready await fixed the rAF race — header selects + action-plan + focus
// + body all fill, skeleton cleared, body shows genuine "0 qualified" empty-state).
// Kill-switch → legacy: window.__REACT_PIPELINE===false, ?react=0, crm_react_off='1'.
const _reactPipelineOn = () => {
    try {
        if (window.__REACT_PIPELINE === false) return false;
        if (/[?&]react=0/.test(location.search)) return false;
        if (localStorage.getItem('crm_react_off') === '1') return false;
        return !!(window.CRMReact && typeof window.CRMReact.mountPipeline === 'function');
    } catch (_) { return false; }
};

// NEW (default-OFF): full real-JSX render path for the pipeline view. Same
// detection idiom as _reactPipelineOn, just a different opt-in param. When ON
// the chunk passes a plain-serializable `data` payload to mountPipeline and the
// JSX view owns the DOM (no by-id fills). Opt in via ?react_pipeline_jsx=1 or
// localStorage crm_react_pipeline_jsx='1'. Defaults to FALSE → unchanged path.
const _reactPipelineJsxOn = () => {
    // PROMOTED (SW-107): full-JSX render is the DEFAULT.
    // Kill-switch: ?react_pipeline_jsx=0 or localStorage crm_react_pipeline_jsx='0'.
    try {
        if (/[?&]react_pipeline_jsx=0/.test(location.search)) return false;
        if (localStorage.getItem('crm_react_pipeline_jsx') === '0') return false;
        return true;
    } catch (_) { return true; }
};

// ── Plain-serializable row builders for the JSX render path ──────────────────
// These MIRROR renderFocusRow / renderSystemRow / renderArchiveFocusRow but emit
// plain objects (strings/numbers/arrays/booleans — NEVER HTML strings) so the
// JSX view can render them as real React with auto-escaping. The legacy render*
// functions above are left untouched and still drive the flag-off by-id fill.
const _plProbMeta = (prob) => ({
    prob,
    color: prob >= 80 ? '#DC2626' : prob >= 60 ? '#F59E0B' : '#6B7280',
    label: prob >= 80 ? '🔥 HOT' : prob >= 50 ? '⚡ WARM' : '❄️ COLD',
});

const _buildFocusRowData = async (rec, idx, actsByProspect, readOnly, prefetched) => {
    const prospect = await AppDataStore.getById('prospects', rec.prospect_id);
    if (!prospect) return null;
    const acts = actsByProspect.get(prospect.id) || [];
    const entry = await calcPipelineEntry(prospect, acts, prefetched);
    const systemAmount = await getPipelineAmount(prospect, entry.category, prefetched?.allSolutions, prefetched?.solutionsByProspect);
    const noteCount = await getNoteCount(prospect.id);

    const displayAmount = rec.custom_amount != null ? rec.custom_amount : systemAmount;
    const isCustomAmount = rec.custom_amount != null;
    const systemAction = entry.latestNextAction || entry.action || '';
    const displayAction = rec.custom_action != null ? rec.custom_action : systemAction;
    const isCustomAction = rec.custom_action != null;

    const _pCfg = await loadPipelineConfig();
    const _allCats = _pCfg.categories || [];
    const _oppPotentials = [...new Set(acts.filter(a => a.opportunity_potential?.trim()).map(a => a.opportunity_potential.trim()))];
    const _currentTarget = rec.target_product || entry.category?.name || '';
    const editable = !readOnly && _allCats.length > 1;
    let productOptions = [];
    if (editable) {
        const catNames = new Set(_allCats.map(c => c.name));
        productOptions = _allCats.map(c => c.name);
        for (const opp of _oppPotentials) if (!catNames.has(opp)) productOptions.push(opp);
    }
    const detailVal = rec.target_product_detail ?? entry.latestOppPotential ?? entry.category?.products ?? '';

    return {
        recId: rec.id,
        prospectId: prospect.id,
        idx,
        readOnly: !!readOnly,
        name: prospect.name || prospect.full_name || '',
        lastActivity: entry.lastActivityDate ? entry.lastActivityDate.toLocaleDateString('en-GB') : 'None',
        product: {
            editable,
            options: productOptions,
            current: _currentTarget,
            detail: detailVal,
            staticName: _currentTarget || entry.category?.name || 'Unknown',
            staticSub: entry.latestOppPotential || entry.category?.products || '',
        },
        amount: displayAmount == null ? null : Number(displayAmount),
        isCustomAmount,
        prob: _plProbMeta(entry.probability),
        action: displayAction,
        isCustomAction,
        noteCount,
    };
};

const _buildSystemRowData = async (prospect, prefetched) => {
    const entry = prospect._pipeline;
    const amount = await getPipelineAmount(prospect, entry.category, prefetched?.allSolutions, prefetched?.solutionsByProspect);
    const noteCount = await getNoteCount(prospect.id);

    let signals = [];
    if (entry.fromPotential) {
        signals = [{ kind: 'potential', label: (entry.potentialLevel || 'Potential') + ' Potential' }];
    } else if (Array.isArray(entry.breakdown) && entry.breakdown.length) {
        const top = [...entry.breakdown].sort((a, b) => b.contribution - a.contribution).slice(0, 3);
        signals = top.map(c => ({
            kind: 'signal',
            label: (c.activity_type === 'EVENT' && c.event_title ? c.event_title.slice(0, 18) : c.activity_type)
                + (c.multiplier > 1 ? ` ×${c.multiplier}` : ''),
        }));
    }
    return {
        prospectId: prospect.id,
        name: prospect.name || prospect.full_name || '',
        lastActivity: entry.lastActivityDate ? entry.lastActivityDate.toLocaleDateString('en-GB') : 'None',
        target: entry.fromPotential ? 'Prospect Potential' : (entry.category?.name || ''),
        referral: entry.referralInfo?.applied ? { bonusPct: entry.referralInfo.bonusPct } : null,
        signals,
        latestOppPotential: entry.latestOppPotential || '',
        amount: amount == null ? null : Number(amount),
        prob: _plProbMeta(entry.probability),
        action: entry.latestNextAction || entry.action || '',
    };
};

const _buildArchiveRowData = async (arc, idx) => {
    const prospect = await AppDataStore.getById('prospects', arc.prospect_id);
    const prob = parseInt(arc.probability || 0, 10);
    return {
        idx,
        prospectId: arc.prospect_id,
        hasProspect: !!prospect,
        name: prospect ? (prospect.name || prospect.full_name || '') : 'Unknown',
        target: arc.target_product || '',
        amount: arc.amount != null ? Number(arc.amount) : null,
        prob: { prob, color: prob >= 80 ? '#DC2626' : prob >= 60 ? '#F59E0B' : '#6B7280', label: prob >= 80 ? 'HOT' : prob >= 50 ? 'WARM' : 'COLD' },
        action: arc.action_needed || '',
    };
};

// Builds the FULL plain-serializable payload describing every section the
// pipeline view renders (header controls, action plan, month-focus / archive,
// team sections, auto-generated table). Mirrors STEP 2-7 of showPipelineView
// WITHOUT touching the DOM. Returns null on any failure so the caller can fall
// back to the legacy by-id fill path.
const buildPipelineIslandData = async () => {
    const userId = _state.cu?.id || 5;

    const [allActivities, allProspects, allUsers] = await Promise.all([
        withTimeout(getVisibleActivities(), 15000, [], 'pipelineJsx:getVisibleActivities'),
        withTimeout(getVisibleProspects(), 15000, [], 'pipelineJsx:getVisibleProspects'),
        withTimeout(AppDataStore.getAll('users'), 15000, [], 'pipelineJsx:getAll(users)'),
        withTimeout(loadPipelineConfig(), 15000, null, 'pipelineJsx:loadPipelineConfig'),
    ]);
    // Bucket activities by prospect_id ONCE — row builders + the system table all
    // look up `_actsByProspect.get(p.id)` instead of re-scanning allActivities.
    const _actsByProspect = _groupActivitiesByProspect(allActivities);

    const agents = (allUsers || []).filter(isAgentOrLeader);

    let prospects = allProspects ? [...allProspects] : [];
    if (_pipelineAgentFilter !== 'all') prospects = prospects.filter(p => p.responsible_agent_id == _pipelineAgentFilter);
    if (_pipelineStatusFilter !== 'all') prospects = prospects.filter(p => p.status === _pipelineStatusFilter);
    const activeProspects = prospects.filter(p => p.status !== 'converted' && p.status !== 'lost' && !p.unable_to_serve);

    const _focusCurrentMonth = new Date().toISOString().slice(0, 7);
    const _focusMonthLabel = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    const _apCurrentMonth = _focusCurrentMonth + '-01';

    const [_allMyFocusItemsRaw, _apPlanListRaw, _archiveItems] = await Promise.all([
        AppDataStore.query('my_potential_list', { user_id: userId }).catch(() => []),
        AppDataStore.query('action_plans', { user_id: userId, month_year: _apCurrentMonth }).catch(() => []),
        AppDataStore.query('monthly_focus_archive', { user_id: userId }).catch(() => []),
    ]);

    // Hide expired items from this render (read-only mirror of STEP 3 — the
    // legacy path owns the actual archive migration / tagging side effects).
    let _allMyFocusItems = _allMyFocusItemsRaw.filter(i => !(i.focus_month && i.focus_month < _focusCurrentMonth));

    const _archiveMonths = [...new Set(_archiveItems.map(a => a.month))].sort().reverse()
        .map(m => ({ value: m, label: new Date(m + '-01').toLocaleString('default', { month: 'long', year: 'numeric' }) }));
    const _isArchiveView = _focusViewMonth !== 'current';

    // Action plan
    const _activePlan = _apPlanListRaw[0] || null;
    let _apItems = [], _apChecks = [];
    if (_activePlan) {
        try {
            const _today = new Date();
            const _diff = (_today.getDay() === 0 ? 6 : _today.getDay() - 1);
            const _monday = new Date(_today);
            _monday.setDate(_today.getDate() - _diff);
            const _mondayStr = _monday.toISOString().slice(0, 10);
            [_apItems, _apChecks] = await Promise.all([
                AppDataStore.query('action_plan_items', { plan_id: _activePlan.id }),
                AppDataStore.query('action_plan_checks', { plan_id: _activePlan.id, check_date: _mondayStr }),
            ]);
            _apItems.sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
        } catch (e) { /* offline fallback */ }
    }
    const actionPlan = {
        monthLabel: _focusMonthLabel,
        hasPlan: !!_activePlan,
        planId: _activePlan?.id ?? null,
        status: _activePlan ? (_activePlan.status || 'active').toUpperCase() : null,
        mainTarget: _activePlan ? Number(_activePlan.main_target || 0) : 0,
        items: _apItems.map(item => ({
            id: item.id,
            eventName: item.event_name || '',
            objective: item.objective || '',
            target: item.target_to_achieve || '',
            when: item.when_to_achieve || '-',
            remarks: item.remarks || '',
            done: !!(_apChecks.find(c => c.item_id === item.id)?.is_done),
        })),
    };

    // Prefetch relational data (same as STEP 5 pre-fetch)
    const [_plAllReferrals, _plAllPurchases, _plAllSolutions] = await Promise.all([
        AppDataStore.getAll('referrals').catch(() => []),
        AppDataStore.getAll('purchases').catch(() => []),
        AppDataStore.getAll('proposed_solutions').catch(() => []),
    ]);
    // DE-QUAD: bucket each prefetched table ONCE so per-prospect lookups are O(1)
    // (matched on referred_prospect_id / customer_id / prospect_id with String()
    // keys — same strictness as the old per-call .filter scans).
    const _plPrefetched = {
        allReferrals: _plAllReferrals, allPurchases: _plAllPurchases, allSolutions: _plAllSolutions,
        referralsByProspect: _bucketByStringKey(_plAllReferrals, 'referred_prospect_id'),
        purchasesByCustomer: _bucketByStringKey(_plAllPurchases, 'customer_id'),
        solutionsByProspect: _bucketByStringKey(_plAllSolutions, 'prospect_id'),
    };

    // Focus list (current or archived month)
    let focusRows;
    let focusCount;
    if (_isArchiveView) {
        const focusList = _archiveItems
            .filter(a => a.month === _focusViewMonth)
            .sort((a, b) => (a.priority_order || 0) - (b.priority_order || 0));
        focusCount = focusList.length;
        focusRows = (await Promise.all(focusList.map((arc, idx) => _buildArchiveRowData(arc, idx))));
    } else {
        const focusList = _allMyFocusItems
            .filter(rec => activeProspects.some(p => p.id == rec.prospect_id))
            .sort((a, b) => a.priority_order - b.priority_order);
        focusCount = focusList.length;
        focusRows = (await Promise.all(focusList.map((rec, idx) => _buildFocusRowData(rec, idx, _actsByProspect, false, _plPrefetched)))).filter(Boolean);
    }

    // Auto-generated (system) table — enriched + sorted exactly as STEP 6
    const enrichedRaw = await Promise.all(activeProspects.map(async (p) => {
        const acts = _actsByProspect.get(p.id) || [];
        const pipeline = await calcPipelineEntry(p, acts, _plPrefetched);
        if (!pipeline.qualified && (p.close_probability > 0 || p.potential_level)) {
            const potentialProb = p.close_probability > 0
                ? p.close_probability
                : (String(p.potential_level) === 'High' ? 70 : String(p.potential_level) === 'Medium' ? 40 : 20);
            pipeline.qualified = true;
            pipeline.probability = potentialProb;
            pipeline.fromPotential = true;
            pipeline.potentialLevel = p.potential_level;
            if (!pipeline.action || pipeline.action.startsWith('Complete prerequisite') || pipeline.action.startsWith('Book CPS')) {
                pipeline.action = `Potential: ${p.potential_level || 'Set'} – follow up to advance to close`;
            }
        }
        return { ...p, _pipeline: pipeline };
    }));
    const enriched = enrichedRaw
        .filter(p => p._pipeline.qualified)
        .sort((a, b) => {
            if (b._pipeline.probability !== a._pipeline.probability) return b._pipeline.probability - a._pipeline.probability;
            const da = a._pipeline.lastActivityDate ? a._pipeline.lastActivityDate.getTime() : 0;
            const db = b._pipeline.lastActivityDate ? b._pipeline.lastActivityDate.getTime() : 0;
            if (db !== da) return db - da;
            return (a.name || a.full_name || '').localeCompare(b.name || b.full_name || '');
        });
    const systemRows = await Promise.all(enriched.map(p => _buildSystemRowData(p, _plPrefetched)));

    // Team sections (leader+, current month only)
    let teamSections = [];
    if (isTeamLeaderOrAbove(_state.cu) && !_isArchiveView) {
        const _visIds = await getVisibleUserIds(_state.cu);
        let _subUsers;
        if (_visIds === 'all') {
            _subUsers = allUsers.filter(u => u.id !== userId && (isAgent(u) || isTeamLeaderOrAbove(u)));
        } else {
            _subUsers = allUsers.filter(u => _visIds.includes(u.id) && u.id !== userId);
        }
        let agentCount = 0;
        for (const sub of _subUsers) {
            if (agentCount >= 30) break;
            const subFocus = (await AppDataStore.query('my_potential_list', { user_id: sub.id }))
                .filter(rec => activeProspects.some(p => p.id == rec.prospect_id))
                .sort((a, b) => a.priority_order - b.priority_order);
            if (subFocus.length === 0) continue;
            agentCount++;
            const subRows = (await Promise.all(subFocus.map((rec, idx) => _buildFocusRowData(rec, idx, _actsByProspect, true, _plPrefetched)))).filter(Boolean);
            teamSections.push({
                agentName: sub.full_name || sub.username || 'Agent',
                count: subFocus.length,
                rows: subRows,
            });
        }
    }

    return {
        agentFilter: String(_pipelineAgentFilter),
        statusFilter: _pipelineStatusFilter,
        agents: agents.map(a => ({ id: a.id, name: a.full_name || '' })),
        actionPlan,
        focus: {
            isArchiveView: _isArchiveView,
            viewMonth: _focusViewMonth,
            currentMonthLabel: _focusMonthLabel,
            archiveMonths: _archiveMonths,
            count: focusCount,
            rows: focusRows,
        },
        teamSections,
        system: {
            qualifiedCount: enriched.length,
            rows: systemRows,
        },
    };
};

// ── Render-builder helpers for showPipelineView ───────────────────────────
// These are pure HTML string assemblers extracted verbatim from the STEP 1-7
// blocks of showPipelineView. They take exactly the values the original block
// read and return exactly the HTML string the caller assigned. No DOM access,
// no control-flow changes — showPipelineView stays the orchestrator.

// STEP 1 skeleton shell. _skelHelpers carries the local skeleton closures
// (_skelRows, _skelCard) defined inside showPipelineView.
const buildPipelineSkeletonHtml = (_skelHelpers) => {
    const { _skelRows, _skelCard } = _skelHelpers;
    return `
<div class="pipeline-dual-view">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
    <div>
        <h1 style="font-size:24px;font-weight:700;margin:0;">Potential Pipeline Management</h1>
        <p style="color:#6B7280;margin-top:4px;">Track signing probability across 6 solution categories</p>
    </div>
    <div id="pl-header-controls" style="display:flex;gap:12px;align-items:center;">
        <div class="skeleton" style="width:160px;height:38px;border-radius:6px;"></div>
        <div class="skeleton" style="width:140px;height:38px;border-radius:6px;"></div>
        <button class="btn secondary" disabled><i class="fas fa-sync-alt"></i> Refresh</button>
        <button class="btn primary" disabled><i class="fas fa-info-circle"></i> Rules</button>
    </div>
</div>
<div id="pl-action-plan">
    <div style="background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);margin-bottom:32px;">
        ${_skelCard(28)}${_skelCard(60)}${_skelCard(120)}
    </div>
</div>
<div id="pl-focus-section">
    <div style="background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);margin-bottom:32px;">
        ${_skelCard(28)}<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:1080px;"><tbody>${_skelRows(4,7)}</tbody></table></div>
    </div>
</div>
<div style="background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:12px;">
            <h2 style="font-size:18px;font-weight:600;margin:0;">📊 Auto-Generated Pipeline</h2>
            <span id="pl-table2-count"><div class="skeleton" style="display:inline-block;width:90px;height:22px;border-radius:20px;vertical-align:middle;"></div></span>
        </div>
        <p style="font-size:11px;color:#9CA3AF;margin:0;">Sorted: highest probability → most recent activity → name</p>
    </div>
    <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:1080px;">
            <thead>
                <tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB;">
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Prospect Name</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Target to Sign (Product/Service)</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Amount (RM)</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Probability</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Action Needed to Close Deal</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Quick Action</th>
                </tr>
            </thead>
            <tbody id="pipeline-list-body">${_skelRows(6,6)}</tbody>
        </table>
    </div>
</div>
</div>`;
};

// STEP 2 header controls (agent + status filters, refresh, rules).
const buildPipelineHeaderControlsHtml = (agents, agentFilter, statusFilter) => {
    return `
        <select class="form-control" style="width:160px;height:38px;" onchange="app.setPipelineFilter('agent', this.value)">
            <option value="all">All Agents</option>
            ${agents.map(a => `<option value="${a.id}" ${agentFilter == a.id ? 'selected' : ''}>${escapeHtml(a.full_name)}</option>`).join('')}
        </select>
        <select class="form-control" style="width:140px;height:38px;" onchange="(async () => { await app.setPipelineFilter('status', this.value); })()">
            <option value="all">All Status</option>
            <option value="prospect" ${statusFilter === 'prospect' ? 'selected' : ''}>Prospect</option>
            <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Active</option>
            <option value="warm" ${statusFilter === 'warm' ? 'selected' : ''}>Warm</option>
            <option value="hot" ${statusFilter === 'hot' ? 'selected' : ''}>Hot</option>
        </select>
        <button class="btn secondary" onclick="app.refreshPipeline()"><i class="fas fa-sync-alt"></i> Refresh</button>
        <button class="btn primary" onclick="app.openPipelineConfigModal()"><i class="fas fa-info-circle"></i> Rules</button>`;
};

// STEP 4 action plan card (header + plan table or empty state).
const buildPipelineActionPlanHtml = (apMonthLabel, activePlan, apItems, apChecks) => {
    return `
<div id="pl-action-plan" class="action-plan-section" style="margin-bottom:32px;background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
    <div>
        <h2 style="font-size:18px;font-weight:600;margin:0;">📋 Action Plan — ${apMonthLabel}</h2>
        ${activePlan ? `<span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-top:4px;display:inline-block;">${(activePlan.status||'active').toUpperCase()}</span>` : ''}
    </div>
    <div style="display:flex;gap:8px;">
        <button class="btn secondary btn-sm" onclick="app.showActionPlanHistory()">View History</button>
        <button class="btn primary btn-sm" onclick="app.openActionPlanModal()">${activePlan ? 'Edit Plan' : 'Create Plan'}</button>
    </div>
</div>
${activePlan ? `
    <div style="background:#f0fdf4;padding:12px;border-radius:8px;margin-bottom:20px;">
        <strong>🎯 Main Target:</strong> RM ${(activePlan.main_target||0).toLocaleString()}
    </div>
    <div style="overflow-x:auto;">
        <table class="plan-items-table" style="width:100%;border-collapse:collapse;">
            <thead>
                <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Event Name</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Objective</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Target</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Due Date</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">This Week</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Remarks</th>
                </tr>
            </thead>
            <tbody>
                ${apItems.length ? apItems.map(item => {
                    const chk = apChecks.find(c => c.item_id === item.id);
                    const done = chk?.is_done || false;
                    return `<tr style="border-bottom:1px solid #e5e7eb;">
                        <td style="padding:10px 12px;">${escapeHtml(item.event_name)}</td>
                        <td style="padding:10px 12px;">${escapeHtml(item.objective||'')}</td>
                        <td style="padding:10px 12px;">${escapeHtml(item.target_to_achieve||'')}</td>
                        <td style="padding:10px 12px;">${item.when_to_achieve||'-'}</td>
                        <td style="padding:10px 12px;">
                            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                                <input type="checkbox" class="plan-checkbox" ${done?'checked':''} onchange="app.updatePlanCheck(${activePlan.id},${item.id},this.checked)">
                                ${done ? '<span style="color:#059669;font-weight:600;">✅ Done</span>' : '<span style="color:#9ca3af;">⏳ Pending</span>'}
                            </label>
                        </td>
                        <td style="padding:10px 12px;">${escapeHtml(item.remarks||'')}</td>
                    </tr>`;
                }).join('') : `<tr><td colspan="6" style="padding:24px;text-align:center;color:#9ca3af;">No items added yet. Click "Edit Plan" to add items.</td></tr>`}
            </tbody>
        </table>
    </div>
    <div class="weekly-reminder" style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
        <span><i class="fas fa-bell"></i> Weekly check every Monday — mark completed items above.</span>
        <button class="btn secondary btn-sm" onclick="app.sendPlanReminder()">Send Reminder</button>
    </div>
` : `
    <div style="text-align:center;padding:40px;color:#9ca3af;">
        <i class="fas fa-clipboard-list" style="font-size:40px;margin-bottom:16px;display:block;"></i>
        <p>No action plan for this month. Click <strong>"Create Plan"</strong> to get started.</p>
    </div>
`}
</div>`;
};

// STEP 5 month-focus / priority-list section (header + month switcher + table).
const buildPipelineFocusSectionHtml = (focusList, focusMonthLabel, archiveMonths, focusViewMonth, isArchiveView, focusRows) => {
    return `
<div id="pl-focus-section" style="margin-bottom:32px;background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <h2 style="font-size:18px;font-weight:600;margin:0;">🔥 MONTH FOCUS — My Priority List</h2>
        <span style="background:#F3F4F6;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">${focusList.length} prospects</span>
        <select onchange="app.switchFocusMonth(this.value)" style="border:1px solid #D1D5DB;border-radius:6px;padding:4px 10px;font-size:12px;color:#374151;cursor:pointer;">
            <option value="current" ${focusViewMonth === 'current' ? 'selected' : ''}>${focusMonthLabel} (Current)</option>
            ${archiveMonths.map(m => {
                const ml = new Date(m + '-01').toLocaleString('default', { month: 'long', year: 'numeric' });
                return '<option value="' + m + '" ' + (focusViewMonth === m ? 'selected' : '') + '>' + ml + '</option>';
            }).join('')}
        </select>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn secondary btn-sm" onclick="app.openExpiredSearchModal()" title="Browse expired & available prospects"><i class="fas fa-search"></i> Browse Past</button>
        ${!isArchiveView ? '<button class="btn-icon" onclick="app.saveManualOrder()" title="Save Order"><i class="fas fa-save"></i></button>' : ''}
    </div>
</div>
${isArchiveView
    ? '<div style="background:#FEF3C7;padding:8px 16px;border-radius:8px;margin-bottom:12px;font-size:12px;color:#92400E;"><i class="fas fa-archive" style="margin-right:4px;"></i> Viewing archived month (read-only). Use "Browse Past" to re-add prospects to current month.</div>'
    : '<p style="font-size:12px;color:#9CA3AF;margin-bottom:16px;"><i class="fas fa-arrows-alt" style="margin-right:4px;"></i> Drag ☰ to reorder priority • Add prospects from Table 2 below</p>'}
<div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;min-width:1080px;">
        <thead>
            <tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB;">
                <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;width:50px;">#</th>
                <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Prospect Name</th>
                <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Target to Sign (Product/Service)</th>
                <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Amount (RM)</th>
                <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Probability</th>
                <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Action Needed to Close Deal</th>
                <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Actions</th>
            </tr>
        </thead>
        <tbody id="focus-list-body">
            ${focusRows || '<tr><td colspan="7" style="padding:32px;text-align:center;color:#9CA3AF;">No prospects in your priority list. Add from Table 2 below.</td></tr>'}
        </tbody>
    </table>
</div>
<div id="pl-team-sections"></div>
</div>`;
};

// STEP 7 one collapsible team-agent focus section (built per sub-user).
const buildPipelineTeamSectionRowHtml = (sub, subFocus, subRows) => {
    return `
                <div style="margin-top:12px;">
                    <div onclick="app.toggleAgentFocusSection(this)" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:12px 16px;background:#F0F4FF;border-radius:8px;border:1px solid #DBEAFE;user-select:none;">
                        <span class="agent-collapse-icon" style="transition:transform 0.2s;font-size:14px;">▸</span>
                        <strong style="font-size:14px;">${escapeHtml(sub.full_name || sub.username || 'Agent')}</strong>
                        <span style="background:#E0E7FF;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#3730A3;">${subFocus.length} prospects</span>
                    </div>
                    <div class="agent-focus-body" style="display:none;padding:8px 0;overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;min-width:1080px;">
                            <thead>
                                <tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB;">
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;width:50px;">#</th>
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Prospect Name</th>
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Target to Sign</th>
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Amount (RM)</th>
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Probability</th>
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Action Needed</th>
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>${subRows}</tbody>
                        </table>
                    </div>
                </div>`;
};

const showPipelineView = async (container) => {
    const userId = _state.cu?.id || 5;
    runHuiJiMigration(); // fire-and-forget

    // ── STEP 1: Paint skeleton immediately so the page feels alive ────────
    // Same philosophy as Facebook/IG: show structure first, fill data after.
    const _skelR = (cols) => `<tr>${Array.from({length:cols},(_,i)=>`<td style="padding:10px 12px;"><div class="skeleton" style="height:14px;border-radius:4px;width:${[72,88,48,44,82,58,40][i%7]}%;"></div></td>`).join('')}</tr>`;
    const _skelRows = (n, cols) => Array(n).fill(0).map(()=>_skelR(cols)).join('');
    const _skelCard = (h=80) => `<div class="skeleton" style="border-radius:8px;height:${h}px;margin-bottom:12px;"></div>`;

    // React scaffold-shell — island renders the skeleton shell; the STEP-2 fills
    // below populate #pl-* by id exactly as legacy (rAF-wait ensures React committed).
    if (_reactPipelineOn()) {
        container.innerHTML = '<div id="pl-react-root"></div>';
        // Await the island's useEffect (post-commit) so the STEP-2 fills below
        // target the committed shell. A bare rAF fired before React committed →
        // getElementById returned null → fills skipped → skeleton stuck.
        let _plReady; const _plReadyP = new Promise(res => { _plReady = res; });
        const _plGuard = setTimeout(() => _plReady(), 4000); // safety: never hang

        // NEW full-JSX path (default OFF). When _reactPipelineJsxOn() the JSX view
        // owns the DOM: build the plain payload, pass data:<payload> and a no-op
        // onReady (the by-id STEP-2 fills below find no #pl-* containers in the
        // JSX render and are skipped). If the build throws, fall back to
        // data:undefined + the EXACT existing onReady by-id fill — unchanged.
        let _plData;
        if (_reactPipelineJsxOn()) {
            try {
                _plData = await buildPipelineIslandData();
            } catch (e) {
                console.warn('[pipeline] JSX payload build failed, falling back to scaffold fill:', e && e.message);
                _plData = undefined;
            }
        }
        // onReady releases the await gate (PipelineFullJsx fires it from its own
        // useEffect on the JSX path; the scaffold path fires it from its useEffect).
        const _plOnReady = () => { clearTimeout(_plGuard); _plReady(); };

        try {
            window.CRMReact.mountPipeline(document.getElementById('pl-react-root'), { data: _plData, onReady: _plOnReady });
        } catch (e) {
            console.warn('[pipeline] island mount failed, falling back to legacy:', e && e.message);
            clearTimeout(_plGuard); _plReady();
        }
        await _plReadyP;
        // JSX path: PipelineFullJsx already rendered EVERY section (header / action
        // plan / focus / system table / team sections) from buildPipelineIslandData()
        // using the same #pl-* ids. STEP-2+ below would re-query and innerHTML-clobber
        // those React-owned nodes (torn DOM). Skip the whole by-id fill on the JSX
        // path (also avoids the redundant second data load). The scaffold path
        // (_plData undefined) falls through and fills the skeleton exactly as today.
        if (_plData) return;
    } else {
    container.innerHTML = buildPipelineSkeletonHtml({ _skelRows, _skelCard });
    }

    // ── STEP 2: Fire ALL big queries in parallel ──────────────────────────
    // Each query gets a 15s timeout so a slow Supabase call no longer
    // leaves the page on a permanent skeleton. On timeout we render with
    // empty data and the user can hit Refresh to retry.
    const [allActivities, allProspects, allUsers] = await Promise.all([
        withTimeout(getVisibleActivities(), 15000, [], 'pipeline:getVisibleActivities'),
        withTimeout(getVisibleProspects(), 15000, [], 'pipeline:getVisibleProspects'),
        withTimeout(AppDataStore.getAll('users'), 15000, [], 'pipeline:getAll(users)'),
        withTimeout(loadPipelineConfig(), 15000, null, 'pipeline:loadPipelineConfig'), // warms cache
    ]);
    // Bucket activities by prospect_id ONCE — renderFocusRow + the system table
    // (STEP 6) + the archive migration all look up `_actsByProspect.get(p.id)`
    // instead of re-scanning allActivities per prospect.
    const _actsByProspect = _groupActivitiesByProspect(allActivities);

    const agents = (allUsers || []).filter(isAgentOrLeader);

    // Fill header controls as soon as agents are available
    const _plHdrCtrl = document.getElementById('pl-header-controls');
    if (_plHdrCtrl) {
        _plHdrCtrl.innerHTML = buildPipelineHeaderControlsHtml(agents, _pipelineAgentFilter, _pipelineStatusFilter);
    }

    // Filter prospects
    let prospects = allProspects ? [...allProspects] : [];
    // Warn if data failed to load (timeout / stale SWR cache) — guide user to Refresh
    if (prospects.length === 0 && (allActivities || []).length === 0) {
        console.warn('[Pipeline] Both prospects and activities returned empty — possible stale cache. Click Refresh.');
        UI.toast.error('Pipeline data could not load. Click <strong>Refresh</strong> to retry.', { duration: 6000 });
    }
    if (_pipelineAgentFilter !== 'all') prospects = prospects.filter(p => p.responsible_agent_id == _pipelineAgentFilter);
    if (_pipelineStatusFilter !== 'all') prospects = prospects.filter(p => p.status === _pipelineStatusFilter);
    const activeProspects = prospects.filter(p => p.status !== 'converted' && p.status !== 'lost' && !p.unable_to_serve);

    // ── STEP 3: Fast queries (action plan + archive + focus) in parallel ──
    const _focusCurrentMonth = new Date().toISOString().slice(0, 7);
    const _focusMonthLabel = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    const _apCurrentMonth = _focusCurrentMonth + '-01';
    const _apMonthLabel = _focusMonthLabel;

    const [_allMyFocusItemsRaw, _apPlanListRaw, _archiveItems] = await Promise.all([
        AppDataStore.query('my_potential_list', { user_id: userId }).catch(() => []),
        AppDataStore.query('action_plans', { user_id: userId, month_year: _apCurrentMonth }).catch(() => []),
        AppDataStore.query('monthly_focus_archive', { user_id: userId }).catch(() => []),
    ]);

    // Tag legacy items (no focus_month) — fire-and-forget, don't block paint
    let _allMyFocusItems = [..._allMyFocusItemsRaw];
    const _legacyItems = _allMyFocusItemsRaw.filter(i => !i.focus_month);
    if (_legacyItems.length > 0) {
        Promise.all(_legacyItems.map(item =>
            AppDataStore.update('my_potential_list', item.id, { focus_month: _focusCurrentMonth })
                .then(() => { item.focus_month = _focusCurrentMonth; }).catch(() => {})
        ));
    }
    // Expired items: hide them from THIS render immediately (UX), then archive them
    // OFF the render path via the guarded, awaited, idempotent _runPipelineArchive.
    const _expiredFocusItems = _allMyFocusItems.filter(i => i.focus_month && i.focus_month < _focusCurrentMonth);
    if (_expiredFocusItems.length > 0) {
        // Do not block render: fire the guarded routine and let it await internally.
        _runPipelineArchive([..._expiredFocusItems], userId, _actsByProspect)
            .catch(e => console.warn('[pipeline-archive] run failed', e));
        _allMyFocusItems = _allMyFocusItems.filter(i => !_expiredFocusItems.includes(i));
    }

    const _archiveMonths = [...new Set(_archiveItems.map(a => a.month))].sort().reverse();
    const _isArchiveView = _focusViewMonth !== 'current';

    // ── STEP 4: Fetch action plan items + render action plan card ─────────
    const _activePlan = _apPlanListRaw[0] || null;
    let _apItems = [], _apChecks = [];
    if (_activePlan) {
        try {
            const _today = new Date();
            const _diff = (_today.getDay() === 0 ? 6 : _today.getDay() - 1);
            const _monday = new Date(_today);
            _monday.setDate(_today.getDate() - _diff);
            const _mondayStr = _monday.toISOString().slice(0,10);
            [_apItems, _apChecks] = await Promise.all([
                AppDataStore.query('action_plan_items', { plan_id: _activePlan.id }),
                AppDataStore.query('action_plan_checks', { plan_id: _activePlan.id, check_date: _mondayStr }),
            ]);
            _apItems.sort((a,b) => (a.display_order||0) - (b.display_order||0));
        } catch(e) { /* offline fallback */ }
    }

    // Fill action plan section — users see this before the slow table loads
    const _plActionPlan = document.getElementById('pl-action-plan');
    if (_plActionPlan) {
        _plActionPlan.outerHTML = buildPipelineActionPlanHtml(_apMonthLabel, _activePlan, _apItems, _apChecks);
    }

    // ── STEP 5: Build focus list (medium speed) ───────────────────────────
    let focusList;
    if (_isArchiveView) {
        focusList = _archiveItems
            .filter(a => a.month === _focusViewMonth)
            .sort((a, b) => (a.priority_order || 0) - (b.priority_order || 0));
    } else {
        focusList = _allMyFocusItems
            .filter(rec => activeProspects.some(p => p.id == rec.prospect_id))
            .sort((a, b) => a.priority_order - b.priority_order);
    }

    const probBadge = (prob, prospectId) => {
        // Align the color band cutoff with the label band (audit L1430): WARM is
        // prob >= 50, so the amber color must use >= 50 too — otherwise 50-59% shows
        // a '⚡ WARM' label painted with the grey COLD color.
        const color = prob >= 80 ? '#DC2626' : prob >= 50 ? '#F59E0B' : '#6B7280';
        const label = prob >= 80 ? '🔥 HOT' : prob >= 50 ? '⚡ WARM' : '❄️ COLD';
        const clickable = prospectId != null ? `onclick="event.stopPropagation();app.showPipelineExplain(${prospectId})" style="cursor:pointer;" title="Click to see score breakdown"` : '';
        return `<span ${clickable}><span style="background:${color};color:white;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${label}</span><strong style="margin-left:6px;">${prob}%</strong></span>`;
    };

    // ── Pre-fetch relational data needed by renderFocusRow before we compute
    // focusRows below. Declared here (before use) to avoid TDZ ReferenceError.
    const [_plAllReferrals, _plAllPurchases, _plAllSolutions] = await Promise.all([
        AppDataStore.getAll('referrals').catch(() => []),
        AppDataStore.getAll('purchases').catch(() => []),
        AppDataStore.getAll('proposed_solutions').catch(() => []),
    ]);
    // DE-QUAD: bucket each prefetched table ONCE so per-prospect lookups are O(1)
    // (matched on referred_prospect_id / customer_id / prospect_id with String()
    // keys — same strictness as the old per-call .filter scans).
    const _plPrefetched = {
        allReferrals: _plAllReferrals, allPurchases: _plAllPurchases, allSolutions: _plAllSolutions,
        referralsByProspect: _bucketByStringKey(_plAllReferrals, 'referred_prospect_id'),
        purchasesByCustomer: _bucketByStringKey(_plAllPurchases, 'customer_id'),
        solutionsByProspect: _bucketByStringKey(_plAllSolutions, 'prospect_id'),
    };

    const focusRows = _isArchiveView
        ? (await Promise.all(focusList.map((arc, idx) => renderArchiveFocusRow(arc, idx)))).join('')
        : (await Promise.all(focusList.map((rec, idx) => renderFocusRow(rec, idx, _actsByProspect, probBadge, false, _plPrefetched)))).join('');

    // Fill focus section — visible before expensive table 2 loads
    const _plFocusSection = document.getElementById('pl-focus-section');
    if (_plFocusSection) {
        _plFocusSection.outerHTML = buildPipelineFocusSectionHtml(focusList, _focusMonthLabel, _archiveMonths, _focusViewMonth, _isArchiveView, focusRows);
    }

    // ── STEP 6: Expensive enrichment — Table 2 tbody has skeleton, fill after ──
    // (_plPrefetched already populated above before focusRows was computed)
    const enrichedRaw = await Promise.all(activeProspects.map(async (p) => {
        const acts = _actsByProspect.get(p.id) || [];
        const pipeline = await calcPipelineEntry(p, acts, _plPrefetched);
        // Also qualify prospects with explicit potential data set (manual override)
        if (!pipeline.qualified && (p.close_probability > 0 || p.potential_level)) {
            const potentialProb = p.close_probability > 0
                ? p.close_probability
                : (String(p.potential_level) === 'High' ? 70 : String(p.potential_level) === 'Medium' ? 40 : 20);
            pipeline.qualified = true;
            pipeline.probability = potentialProb;
            pipeline.fromPotential = true;
            pipeline.potentialLevel = p.potential_level;
            if (!pipeline.action || pipeline.action.startsWith('Complete prerequisite') || pipeline.action.startsWith('Book CPS')) {
                // Plain text (audit L576/L1479) — consumed by the plain-payload builders;
                // matches the parallel line in _buildFocusRowData's path (no <strong>).
                pipeline.action = `Potential: ${p.potential_level || 'Set'} – follow up to advance to close`;
            }
        }
        return { ...p, _pipeline: pipeline };
    }));

    const enriched = enrichedRaw
        .filter(p => p._pipeline.qualified)
        .sort((a, b) => {
            if (b._pipeline.probability !== a._pipeline.probability) return b._pipeline.probability - a._pipeline.probability;
            const da = a._pipeline.lastActivityDate ? a._pipeline.lastActivityDate.getTime() : 0;
            const db = b._pipeline.lastActivityDate ? b._pipeline.lastActivityDate.getTime() : 0;
            if (db !== da) return db - da;
            return (a.name || a.full_name || '').localeCompare(b.name || b.full_name || '');
        });

    const systemRows = (await Promise.all(enriched.map(p => renderSystemRow(p, probBadge, _plPrefetched)))).join('');

    // Fill table 2 — replaces skeleton rows
    const _tbody2 = document.getElementById('pipeline-list-body');
    if (_tbody2) {
        _tbody2.innerHTML = systemRows || '<tr><td colspan="6" style="padding:32px;text-align:center;color:#9CA3AF;">No qualified prospects found. Complete prerequisites for any category to appear here.</td></tr>';
    }
    const _countEl = document.getElementById('pl-table2-count');
    if (_countEl) {
        _countEl.innerHTML = `<span style="background:#F3F4F6;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">${enriched.length} qualified</span>`;
    }

    // ── STEP 7: Team sections (uses enriched + allUsers, fill last) ────────
    if (isTeamLeaderOrAbove(_state.cu) && !_isArchiveView) {
        const _visIds = await getVisibleUserIds(_state.cu);
        let _subUsers;
        if (_visIds === 'all') {
            _subUsers = allUsers.filter(u => u.id !== userId && (isAgent(u) || isTeamLeaderOrAbove(u)));
        } else {
            _subUsers = allUsers.filter(u => _visIds.includes(u.id) && u.id !== userId);
        }
        let _teamAgentSections = '';
        let agentCount = 0;
        for (const sub of _subUsers) {
            if (agentCount >= 30) break;
            const subFocus = (await AppDataStore.query('my_potential_list', { user_id: sub.id }))
                .filter(rec => activeProspects.some(p => p.id == rec.prospect_id))
                .sort((a, b) => a.priority_order - b.priority_order);
            if (subFocus.length === 0) continue;
            agentCount++;
            const subRows = (await Promise.all(subFocus.map((rec, idx) => renderFocusRow(rec, idx, _actsByProspect, probBadge, true, _plPrefetched)))).join('');
            _teamAgentSections += buildPipelineTeamSectionRowHtml(sub, subFocus, subRows);
        }
        const _plTeamSections = document.getElementById('pl-team-sections');
        if (_plTeamSections && _teamAgentSections) {
            _plTeamSections.innerHTML = `
                <div style="margin-top:16px;border-top:2px solid #E5E7EB;padding-top:16px;">
                    <h3 style="font-size:15px;font-weight:600;color:#374151;margin-bottom:8px;"><i class="fas fa-users" style="margin-right:6px;color:#6366F1;"></i> Team Agents Focus Lists</h3>
                    <p style="font-size:11px;color:#9CA3AF;margin-bottom:8px;">Click agent name to expand/collapse their focus list</p>
                    ${_teamAgentSections}
                </div>`;
        }
    }
};

const renderFocusRow = async (rec, idx, actsByProspect, probBadge, readOnly = false, prefetched) => {
    const prospect = await AppDataStore.getById('prospects', rec.prospect_id);
    if (!prospect) return '';

    const acts = actsByProspect.get(prospect.id) || [];
    const entry = await calcPipelineEntry(prospect, acts, prefetched);
    const systemAmount = await getPipelineAmount(prospect, entry.category, prefetched?.allSolutions, prefetched?.solutionsByProspect);
    const noteCount = await getNoteCount(prospect.id);

    // Use custom override if agent set one, otherwise system value
    const displayAmount = rec.custom_amount != null ? rec.custom_amount : systemAmount;
    const isCustomAmount = rec.custom_amount != null;
    const amountHtml = displayAmount == null
        ? `<span style="color:#92400E;font-weight:600;">Varies</span> <span style="font-size:10px;color:#9CA3AF;">check monthly</span>`
        : `RM ${Number(displayAmount).toLocaleString()}`;

    const systemAction = entry.latestNextAction ? escapeHtml(entry.latestNextAction) : entry.action;
    const displayAction = rec.custom_action != null ? escapeHtml(rec.custom_action) : systemAction;
    const isCustomAction = rec.custom_action != null;

    const editableStyle = 'cursor:pointer;border-bottom:1px dashed #D1D5DB;';
    const customBadge = `<span style="font-size:9px;color:#F59E0B;margin-left:4px;" title="Custom override (click to reset)">&#9998;</span>`;

    // Product dropdown: show all pipeline categories + custom opportunity_potentials
    const _pCfg = await loadPipelineConfig();
    const _allCats = _pCfg.categories || [];
    const _oppPotentials = [...new Set(acts.filter(a => a.opportunity_potential?.trim()).map(a => a.opportunity_potential.trim()))];
    const _currentTarget = rec.target_product || entry.category?.name || '';
    let productColumnHtml;
    if (!readOnly && _allCats.length > 1) {
        let opts = _allCats.map(c => `<option value="${escapeHtml(c.name)}" ${c.name === _currentTarget ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
        const catNames = new Set(_allCats.map(c => c.name));
        for (const opp of _oppPotentials) {
            if (!catNames.has(opp)) opts += `<option value="${escapeHtml(opp)}" ${opp === _currentTarget ? 'selected' : ''}>${escapeHtml(opp)}</option>`;
        }
        const _detailVal = rec.target_product_detail ?? entry.latestOppPotential ?? entry.category?.products ?? '';
        productColumnHtml = `<select onchange="event.stopPropagation();app.changeFocusTargetProduct(${rec.id}, this.value)"
            style="width:100%;border:1px solid #DBEAFE;border-radius:6px;padding:6px 8px;font-size:12px;color:#1E40AF;font-weight:500;background:white;cursor:pointer;">${opts}</select>
            <input type="text" value="${escapeHtml(_detailVal)}" placeholder="Remarks / details..."
                onclick="event.stopPropagation()" onblur="app.changeFocusTargetDetail(${rec.id}, this.value)"
                style="width:100%;border:1px solid #E5E7EB;border-radius:4px;padding:3px 6px;font-size:11px;color:#6B7280;margin-top:2px;background:#FAFAFA;">`;
    } else {
        productColumnHtml = `<div style="font-weight:500;color:#1E40AF;">${escapeHtml(_currentTarget || entry.category?.name || 'Unknown')}</div>
            <div style="font-size:11px;color:#9CA3AF;">${escapeHtml(entry.latestOppPotential || entry.category?.products || '')}</div>`;
    }

    const dragAttrs = readOnly ? '' : `draggable="true" ondragstart="app.handleDragStart(event, ${rec.id})" ondragover="app.handleDragOver(event)" ondrop="app.handleDrop(event, ${rec.id})"`;

    return `
        <tr data-list-id="${rec.id}" ${dragAttrs}
            style="border-bottom:1px solid #F3F4F6;"
            onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background=''">
            <td style="padding:14px 12px;">
                <div style="display:flex;align-items:center;gap:8px;${readOnly ? '' : 'cursor:grab;'}">
                    ${readOnly ? '' : '<span style="color:#9CA3AF;">☰</span>'}
                    <span style="font-weight:700;color:#6B7280;">${idx + 1}</span>
                </div>
            </td>
            <td style="padding:14px 12px;">
                <div style="font-weight:600;color:#2563EB;cursor:pointer;text-decoration:underline;" onclick="event.stopPropagation();app.showProspectMenu(${prospect.id})" title="Open prospect profile">${escapeHtml(prospect.name || prospect.full_name || '')}</div>
                <div style="font-size:11px;color:#9CA3AF;">Last activity: ${entry.lastActivityDate ? entry.lastActivityDate.toLocaleDateString('en-GB') : 'None'}</div>
            </td>
            <td style="padding:14px 12px;">${productColumnHtml}</td>
            <td style="padding:14px 12px;font-weight:600;color:#059669;">
                <span id="focus-amt-${rec.id}" onclick="event.stopPropagation();app.editFocusAmount(${rec.id}, ${displayAmount || 0})" style="${editableStyle}" title="Click to edit amount">${amountHtml}</span>
                ${isCustomAmount ? `<span onclick="event.stopPropagation();app.resetFocusField(${rec.id},'custom_amount')" style="cursor:pointer;">${customBadge}</span>` : ''}
            </td>
            <td style="padding:14px 12px;">${probBadge(entry.probability, prospect.id)}</td>
            <td style="padding:14px 12px;font-size:13px;line-height:1.5;max-width:260px;">
                <span id="focus-act-${rec.id}" onclick="event.stopPropagation();app.editFocusAction(${rec.id}, this)" style="${editableStyle}" title="Click to edit action">${displayAction}</span>
                ${isCustomAction ? `<span onclick="event.stopPropagation();app.resetFocusField(${rec.id},'custom_action')" style="cursor:pointer;">${customBadge}</span>` : ''}
            </td>
            <td style="padding:14px 12px;">
                <div style="display:flex;gap:6px;">
                    <button class="btn-icon" onclick="event.stopPropagation();app.showProspectMenu(${prospect.id})" title="View Profile"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon" onclick="event.stopPropagation();app.showComments(${prospect.id})" style="position:relative;" title="Comments">
                        <i class="fas fa-comment"></i>
                        ${noteCount > 0 ? `<span style="position:absolute;top:-4px;right:-4px;background:#EF4444;color:white;border-radius:50%;width:14px;height:14px;font-size:9px;display:flex;align-items:center;justify-content:center;">${noteCount}</span>` : ''}
                    </button>
                    ${readOnly ? '' : `<button class="btn-icon text-danger" onclick="event.stopPropagation();app.removeFromFocusList(${rec.id})" title="Remove from Priority"><i class="fas fa-trash-alt"></i></button>`}
                </div>
            </td>
        </tr>`;
};

const renderSystemRow = async (prospect, probBadge, prefetched) => {
    const entry = prospect._pipeline;
    const amount = await getPipelineAmount(prospect, entry.category, prefetched?.allSolutions, prefetched?.solutionsByProspect);
    const noteCount = await getNoteCount(prospect.id);

    // v6: show top-3 contributing activities instead of prereq pills
    let signalsHtml = '';
    if (entry.fromPotential) {
        signalsHtml = `<span style="background:#EDE9FE;color:#5B21B6;padding:2px 5px;border-radius:4px;font-size:10px;">⭐ ${escapeHtml(entry.potentialLevel || 'Potential')} Potential</span>`;
    } else if (Array.isArray(entry.breakdown) && entry.breakdown.length) {
        const top = [...entry.breakdown].sort((a, b) => b.contribution - a.contribution).slice(0, 3);
        signalsHtml = top.map(c => {
            const label = c.activity_type === 'EVENT' && c.event_title ? c.event_title.slice(0, 18) : c.activity_type;
            const boost = c.multiplier > 1 ? ` ×${c.multiplier}` : '';
            return `<span style="background:#D1FAE5;color:#065F46;padding:2px 5px;border-radius:4px;font-size:10px;">✓ ${escapeHtml(label)}${boost}</span>`;
        }).join(' ');
    }
    const referralBadge = entry.referralInfo?.applied
        ? `<span style="background:#FEF3C7;color:#92400E;padding:2px 5px;border-radius:4px;font-size:10px;margin-left:4px;" title="Referred by customer with recent purchase — +${entry.referralInfo.bonusPct}%">⭐ Customer referral +${entry.referralInfo.bonusPct}%</span>`
        : '';
    const amountHtml = amount == null
        ? `<span style="color:#92400E;font-weight:600;">Varies</span><br><button class="btn-icon" onclick="event.stopPropagation();app.setAgentPackageAmount()" style="font-size:10px;color:#2563EB;padding:0;background:none;border:none;cursor:pointer;">[edit]</button>`
        : `RM ${Number(amount).toLocaleString()}`;

    return `
        <tr style="border-bottom:1px solid #F3F4F6;" onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background=''">
            <td style="padding:14px 12px;">
                <div style="font-weight:600;color:#2563EB;cursor:pointer;text-decoration:underline;" onclick="event.stopPropagation();app.showProspectMenu(${prospect.id})" title="Open prospect profile">${escapeHtml(prospect.name || prospect.full_name || '')}</div>
                <div style="font-size:11px;color:#9CA3AF;">Last activity: ${entry.lastActivityDate ? entry.lastActivityDate.toLocaleDateString('en-GB') : 'None'}</div>
            </td>
            <td style="padding:14px 12px;">
                <div style="font-weight:500;color:#1E40AF;">${entry.fromPotential ? 'Prospect Potential' : escapeHtml(entry.category?.name || '')}${referralBadge}</div>
                <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:2px;">${signalsHtml}</div>
                ${entry.latestOppPotential ? `<div style="font-size:11px;color:#9CA3AF;margin-top:4px;">${escapeHtml(entry.latestOppPotential)}</div>` : ''}
            </td>
            <td style="padding:14px 12px;font-weight:600;color:#059669;">${amountHtml}</td>
            <td style="padding:14px 12px;">${probBadge(entry.probability, prospect.id)}</td>
            <td style="padding:14px 12px;font-size:13px;line-height:1.5;max-width:260px;">${entry.latestNextAction ? escapeHtml(entry.latestNextAction) : entry.action}</td>
            <td style="padding:14px 12px;">
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="btn secondary btn-sm" style="padding:4px 10px;font-size:11px;" onclick="app.addToFocusList(${prospect.id})"><i class="fas fa-plus"></i> Add to Focus</button>
                    <button class="btn-icon" onclick="event.stopPropagation();app.showProspectMenu(${prospect.id})" title="View"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon" onclick="event.stopPropagation();app.showComments(${prospect.id})" style="position:relative;" title="Comments">
                        <i class="fas fa-comment"></i>
                        ${noteCount > 0 ? `<span style="position:absolute;top:-4px;right:-4px;background:#3B82F6;color:white;border-radius:50%;width:14px;height:14px;font-size:9px;display:flex;align-items:center;justify-content:center;">${noteCount}</span>` : ''}
                    </button>
                </div>
            </td>
        </tr>`;
};

const refreshPipeline = async () => {
    // Bust in-memory + SWR caches for the three tables the pipeline depends on
    // so stale/empty data never causes a "0 qualified" phantom empty state.
    AppDataStore.invalidateCache('activities');
    AppDataStore.invalidateCache('prospects');
    AppDataStore.invalidateCache('users');
    const container = document.getElementById('content-viewport');
    if (container) await showPipelineView(container);
};

// ===== ACTION PLAN FUNCTIONS =====

const renderPlanItemRow = (item = null, index = 0) => {
    const id = item?.id || `new_${Date.now()}_${index}`;
    return `
        <div class="plan-item-row" data-item-id="${id}" style="border:1px solid #e5e7eb;padding:12px;margin-bottom:12px;border-radius:8px;background:#f9fafb;">
            <div style="display:flex;gap:12px;margin-bottom:8px;">
                <div style="flex:1;">
                    <label style="font-size:12px;font-weight:600;color:#374151;">Event Name *</label>
                    <input type="text" class="form-control item-event-name" value="${escapeHtml(item?.event_name || '')}" placeholder="e.g., CPS Workshop" style="background:white;">
                </div>
                <div style="flex:1;">
                    <label style="font-size:12px;font-weight:600;color:#374151;">Objective</label>
                    <input type="text" class="form-control item-objective" value="${escapeHtml(item?.objective || '')}" placeholder="What to achieve" style="background:white;">
                </div>
            </div>
            <div style="display:flex;gap:12px;margin-bottom:8px;">
                <div style="flex:1;">
                    <label style="font-size:12px;font-weight:600;color:#374151;">Target To Achieve</label>
                    <input type="text" class="form-control item-target" value="${escapeHtml(item?.target_to_achieve || '')}" placeholder="e.g., 5 new prospects" style="background:white;">
                </div>
                <div style="flex:1;">
                    <label style="font-size:12px;font-weight:600;color:#374151;">When to Achieve</label>
                    <input type="date" class="form-control item-when" value="${item?.when_to_achieve || ''}" style="background:white;">
                </div>
            </div>
            <div style="margin-bottom:8px;">
                <label style="font-size:12px;font-weight:600;color:#374151;">Remarks</label>
                <textarea class="form-control item-remarks" rows="2" style="background:white;">${escapeHtml(item?.remarks || '')}</textarea>
            </div>
            <button type="button" class="btn-icon" style="color:#DC2626;" onclick="this.closest('.plan-item-row').remove()"><i class="fas fa-trash"></i> Remove</button>
            <input type="hidden" class="item-id" value="${item?.id || ''}">
        </div>
    `;
};

const openActionPlanModal = async (planId = null) => {
    const currentUser = _state.cu;
    const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
    let plan = null;
    let items = [];
    if (planId) {
        plan = await AppDataStore.getById('action_plans', planId);
        if (plan) items = await AppDataStore.query('action_plan_items', { plan_id: plan.id });
    } else {
        const existing = await AppDataStore.query('action_plans', { user_id: currentUser.id, month_year: currentMonth });
        if (existing.length) plan = existing[0];
        if (plan) items = await AppDataStore.query('action_plan_items', { plan_id: plan.id });
    }

    const modalContent = `
        <div class="action-plan-modal">
            <div class="form-group">
                <label>Month / Year</label>
                <input type="month" id="plan-month" class="form-control" value="${plan?.month_year?.slice(0,7) || new Date().toISOString().slice(0,7)}" required>
            </div>
            <div class="form-group">
                <label>Main Target (RM)</label>
                <input type="number" id="main-target" class="form-control" value="${plan?.main_target || ''}" step="0.01" placeholder="e.g., 50000">
            </div>
            <hr>
            <h4 style="margin-bottom:12px;">Action Plan Items</h4>
            <div id="plan-items-container">
                ${items.map((item, idx) => renderPlanItemRow(item, idx)).join('')}
            </div>
            <button type="button" class="btn secondary btn-sm" onclick="app.addPlanItemRow()" style="margin-top:4px;"><i class="fas fa-plus"></i> Add Item</button>
        </div>
    `;

    UI.showModal(plan ? 'Edit Action Plan' : 'Create Action Plan', modalContent, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Plan', type: 'primary', action: `(async () => { await app.saveActionPlan(${plan?.id ?? 'null'}); })()` }
    ]);
};

const addPlanItemRow = () => {
    const container = document.getElementById('plan-items-container');
    if (container) {
        container.insertAdjacentHTML('beforeend', renderPlanItemRow(null, Date.now()));
    }
};

const saveActionPlan = async (planId) => {
    const currentUser = _state.cu;
    const mainTarget = parseFloat(document.getElementById('main-target')?.value) || 0;
    const monthYear = document.getElementById('plan-month')?.value;
    if (!monthYear) {
        UI.toast.error('Please select a month');
        return;
    }
    const monthDate = monthYear + '-01';

    let plan;
    if (planId) {
        plan = await AppDataStore.getById('action_plans', planId);
        await AppDataStore.update('action_plans', planId, { main_target: mainTarget, updated_at: new Date().toISOString() });
        plan.id = planId;
    } else {
        const existing = await AppDataStore.query('action_plans', { user_id: currentUser.id, month_year: monthDate });
        if (existing.length) {
            plan = existing[0];
            await AppDataStore.update('action_plans', plan.id, { main_target: mainTarget, updated_at: new Date().toISOString() });
        } else {
            plan = await AppDataStore.create('action_plans', {
                id: Date.now(),
                user_id: currentUser.id,
                month_year: monthDate,
                main_target: mainTarget,
                status: 'active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
        }
    }

    const rows = document.querySelectorAll('.plan-item-row');
    // Reconciliation (audit L1801): the Remove button only does a DOM-only delete, so
    // rows the user removed in the edit modal must be diff-deleted from the DB here —
    // otherwise the orphan action_plan_items rows survive and reappear on next open.
    // Collect the item ids still present in the form before the upsert loop.
    const presentIds = new Set(
        [...rows]
            .map(r => parseInt(r.querySelector('.item-id')?.value))
            .filter(n => !isNaN(n))
    );
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const eventName = row.querySelector('.item-event-name')?.value?.trim() || '';
        if (!eventName) continue;
        const itemId = row.querySelector('.item-id')?.value;
        const itemData = {
            plan_id: plan.id,
            event_name: eventName,
            objective: row.querySelector('.item-objective')?.value || '',
            target_to_achieve: row.querySelector('.item-target')?.value || '',
            when_to_achieve: row.querySelector('.item-when')?.value || null,
            remarks: row.querySelector('.item-remarks')?.value || '',
            display_order: i
        };
        if (itemId && !isNaN(parseInt(itemId))) {
            await AppDataStore.update('action_plan_items', parseInt(itemId), itemData);
        } else {
            itemData.id = Date.now() + i;
            itemData.created_at = new Date().toISOString();
            await AppDataStore.create('action_plan_items', itemData);
        }
    }

    // Delete any persisted item whose id is no longer present in the form (removed by
    // the user). Best-effort per row so one failure doesn't abort the whole save.
    try {
        for (const existing of await AppDataStore.query('action_plan_items', { plan_id: plan.id })) {
            if (!presentIds.has(existing.id)) {
                await AppDataStore.delete('action_plan_items', existing.id);
            }
        }
    } catch (e) { console.warn('saveActionPlan: orphan-item cleanup failed', e); }

    UI.hideModal();
    UI.toast.success('Action Plan saved');
    await refreshPipeline();
};

const updatePlanCheck = async (planId, itemId, isDone) => {
    const today = new Date();
    const day = today.getDay();
    const diffToMonday = (day === 0 ? 6 : day - 1);
    const lastMonday = new Date(today);
    lastMonday.setDate(today.getDate() - diffToMonday);
    const mondayStr = lastMonday.toISOString().slice(0,10);

    const existing = await AppDataStore.query('action_plan_checks', { plan_id: planId, check_date: mondayStr, item_id: itemId });
    if (existing.length) {
        await AppDataStore.update('action_plan_checks', existing[0].id, { is_done: isDone });
    } else {
        await AppDataStore.create('action_plan_checks', {
            id: Date.now(),
            plan_id: planId,
            check_date: mondayStr,
            item_id: itemId,
            is_done: isDone,
            created_at: new Date().toISOString()
        });
    }
    UI.toast.success(isDone ? '✅ Item marked as done for this week' : '⏳ Item marked as pending');
};

const sendPlanReminder = async () => {
    const currentUser = _state.cu;
    const currentMonth = new Date().toISOString().slice(0,7) + '-01';
    const planList = await AppDataStore.query('action_plans', { user_id: currentUser.id, month_year: currentMonth });
    const plan = planList[0];
    if (!plan) {
        UI.toast.info('No action plan for this month');
        return;
    }
    const items = await AppDataStore.query('action_plan_items', { plan_id: plan.id });
    const today = new Date();
    const day = today.getDay();
    const diffToMonday = (day === 0 ? 6 : day - 1);
    const lastMonday = new Date(today);
    lastMonday.setDate(today.getDate() - diffToMonday);
    const mondayStr = lastMonday.toISOString().slice(0,10);
    const checks = await AppDataStore.query('action_plan_checks', { plan_id: plan.id, check_date: mondayStr });
    const pendingItems = items.filter(item => !checks.some(c => c.item_id === item.id && c.is_done));
    if (pendingItems.length === 0) {
        UI.toast.success('🎉 All items completed this week! Great job!');
    } else {
        const pendingNames = pendingItems.map(i => i.event_name).join(', ');
        UI.toast.warning(`⚠️ Pending: ${pendingNames}. Please update your progress.`);
    }
};

const showActionPlanHistory = async () => {
    const currentUser = _state.cu;
    const plans = await AppDataStore.query('action_plans', { user_id: currentUser.id });
    plans.sort((a, b) => b.month_year > a.month_year ? 1 : -1);
    let html = `
        <div class="action-plan-history">
            <table class="data-table" style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                        <th scope="col" style="padding:10px 12px;text-align:left;">Month</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;">Main Target</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;">Status</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;">Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;
    if (!plans.length) {
        html += `<tr><td colspan="4" style="padding:32px;text-align:center;color:#9ca3af;">No action plans found.</td></tr>`;
    }
    for (const p of plans) {
        const monthLabel = new Date(p.month_year).toLocaleString('default', { month: 'long', year: 'numeric' });
        html += `
            <tr style="border-bottom:1px solid #e5e7eb;">
                <td style="padding:10px 12px;">${monthLabel}</td>
                <td style="padding:10px 12px;">RM ${p.main_target?.toLocaleString() || '0'}</td>
                <td style="padding:10px 12px;"><span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:12px;font-size:12px;">${(p.status || 'active').toUpperCase()}</span></td>
                <td style="padding:10px 12px;"><button class="btn secondary btn-sm" onclick="app.openActionPlanModal(${p.id})">View/Edit</button></td>
            </tr>
        `;
    }
    html += `</tbody></table></div>`;
    UI.showModal('Action Plan History', html, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
};

const initActionPlanReminder = () => {
    // Guard against duplicate intervals if init is called more than once.
    if (window._actionPlanReminderInterval) return;
    // Only check once per day (not every hour) to reduce unnecessary DB load
    let _lastReminderDate = null;
    let _reminderInFlight = false;
    window._actionPlanReminderInterval = setInterval(async () => {
        if (_reminderInFlight) return; // skip tick if previous run still pending
        _reminderInFlight = true;
        try {
        const now = new Date();
        const todayStr = now.toISOString().slice(0,10);
        // Skip if already ran today or not Monday
        if (now.getDay() !== 1 || _lastReminderDate === todayStr) return;
        // NOTE (audit L1928): do NOT mark _lastReminderDate yet — only stamp it AFTER
        // the work succeeds, so a transient Monday-morning outage retries on the next
        // tick instead of silently skipping the whole week's reminder.
        try {
            const allUsers = await AppDataStore.getAll('users');
            const agentRoles = ['consultant', 'agent', 'team_leader', 'Level 3', 'Level 4', 'Level 5', 'Level 6'];
            for (const user of allUsers) {
                if (!agentRoles.some(r => (user.role || '').includes(r))) continue;
                const planList = await AppDataStore.query('action_plans', { user_id: user.id, status: 'active' });
                const plan = planList[0];
                if (!plan) continue;
                const existing = await AppDataStore.query('action_plan_checks', { plan_id: plan.id, check_date: todayStr, reminder_sent: true });
                if (existing.length === 0) {
                    await AppDataStore.create('action_plan_checks', {
                        id: Date.now(),
                        plan_id: plan.id,
                        check_date: todayStr,
                        reminder_sent: true,
                        created_at: new Date().toISOString()
                    });
                }
            }
            // Success — now safe to mark "ran today" so we don't re-run until next Monday.
            _lastReminderDate = todayStr;
        } catch(e) {
            // Observable, but don't stamp _lastReminderDate so the next tick retries.
            console.warn('[actionPlanReminder] run failed — will retry next tick', e);
        }
        } finally {
            _reminderInFlight = false;
        }
    }, 4 * 60 * 60 * 1000); // check every 4 hours instead of every hour
};

// ===== END ACTION PLAN FUNCTIONS =====

// ===== FOCUS LIST INLINE EDIT (Amount & Action overrides) =====

const editFocusAmount = (recId, currentAmount) => {
    const span = document.getElementById(`focus-amt-${recId}`);
    if (!span || span.querySelector('input')) return;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = currentAmount || '';
    input.placeholder = 'Amount (RM)';
    input.style.cssText = 'width:110px;padding:4px 6px;border:1px solid #10B981;border-radius:4px;font-size:13px;font-weight:600;color:#059669;outline:none;';
    input.onclick = (e) => e.stopPropagation();
    const save = async () => {
        const val = input.value.trim();
        // Non-negative guard (audit L1971): isNaN('-50') is false, so a negative value
        // would otherwise be stored and flow into pipeline-value rollups. Reject < 0.
        const n = Number(val);
        if (val === '' || isNaN(n) || n < 0) {
            if (val !== '' && (isNaN(n) || n < 0)) UI.toast.error('Enter a valid non-negative amount');
            await refreshPipeline();
            return;
        }
        await AppDataStore.update('my_potential_list', recId, { custom_amount: n });
        UI.toast.success('Amount updated');
        await refreshPipeline();
    };
    input.onblur = save;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { refreshPipeline(); } };
    span.textContent = '';
    span.appendChild(input);
    input.focus();
    input.select();
};

const editFocusAction = (recId, spanEl) => {
    if (!spanEl || spanEl.querySelector('textarea')) return;
    const currentText = spanEl.textContent.trim();
    const textarea = document.createElement('textarea');
    textarea.value = currentText;
    textarea.placeholder = 'Action needed to close deal...';
    textarea.style.cssText = 'width:100%;min-height:50px;padding:4px 6px;border:1px solid #10B981;border-radius:4px;font-size:13px;line-height:1.4;resize:vertical;outline:none;font-family:inherit;';
    textarea.onclick = (e) => e.stopPropagation();
    const save = async () => {
        const val = textarea.value.trim();
        if (!val) { await refreshPipeline(); return; }
        await AppDataStore.update('my_potential_list', recId, { custom_action: val });
        UI.toast.success('Action updated');
        await refreshPipeline();
    };
    textarea.onblur = save;
    textarea.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textarea.blur(); } if (e.key === 'Escape') { refreshPipeline(); } };
    spanEl.textContent = '';
    spanEl.appendChild(textarea);
    textarea.focus();
};

const resetFocusField = async (recId, field) => {
    await AppDataStore.update('my_potential_list', recId, { [field]: null });
    UI.toast.info('Reset to system default');
    await refreshPipeline();
};

const addToFocusList = async (prospectId) => {
    const userId = _state.cu?.id || 5;
    const currentMonth = new Date().toISOString().slice(0, 7);
    // Scope the list to the CURRENT focus_month (audit L2012): querying by user_id alone
    // returns items from all months, so priority_order = (cross-month count)+1 would
    // collide with / skip the per-month ordering the focus list is rendered/sorted by.
    const currentList = (await AppDataStore.query('my_potential_list', { user_id: userId }))
        .filter(i => i.focus_month === currentMonth);
    if (currentList.some(item => item.prospect_id == prospectId)) {
        UI.toast.warning('Prospect is already in your priority list.');
        return;
    }
    await AppDataStore.create('my_potential_list', {
        user_id: userId,
        prospect_id: prospectId,
        priority_order: currentList.length + 1,
        focus_month: currentMonth
    });
    UI.toast.success('Added to Priority List');
    await refreshPipeline();
};

const removeFromFocusList = async (listItemId) => {
    const item = await AppDataStore.getById('my_potential_list', listItemId);
    if (!item) return;
    const userId = item.user_id;
    await AppDataStore.delete('my_potential_list', listItemId);
    // Re-number ONLY the deleted item's focus_month (audit L2035): re-sequencing across
    // every month would interleave + globally renumber other months, scrambling their
    // relative order. Scope to item.focus_month so only the affected month is touched.
    const remaining = (await AppDataStore.query('my_potential_list', { user_id: userId }))
        .filter(rec => rec.focus_month === item.focus_month)
        .sort((a, b) => a.priority_order - b.priority_order);
    for (const [idx, rec] of remaining.entries()) {
        await AppDataStore.update('my_potential_list', rec.id, { priority_order: idx + 1 });
    }
    UI.toast.info('Removed from Priority List');
    await refreshPipeline();
};

const setPipelineFilter = async (type, value) => {
    if (type === 'agent') _pipelineAgentFilter = value;
    if (type === 'status') _pipelineStatusFilter = value;
    await refreshPipeline();
};

// ====== PIPELINE RULES EDITOR (Super Admin only) ======
// Renders 6 collapsible sections: Categories / Activity Weights / Decay Tiers /
// Event Boosters / Activity × Category Matrix / Global Constants.
// Non-admins see a read-only view.
//
// The editor works on a local draft object (_pipelineEditDraft) so changes can be
// discarded by closing the modal without saving. "Save All Changes" writes the
// draft via savePipelineConfigJson and refreshes the pipeline.

let _pipelineEditDraft = null;

const _pipelineDraftClone = (cfg) => JSON.parse(JSON.stringify(cfg));

const openPipelineConfigModal = async () => {
    const config = await loadPipelineConfig();
    const isAdmin = isSystemAdmin(_state.cu);
    _pipelineEditDraft = _pipelineDraftClone(config);
    _renderPipelineConfigModal(isAdmin);
};

const _renderPipelineConfigModal = (isAdmin) => {
    const cfg = _pipelineEditDraft;
    const cats = cfg.categories || [];
    const weights = cfg.activity_weights || {};
    const decay = cfg.decay_tiers || [];
    const boosters = cfg.event_boosters || [];
    const actMults = cfg.activity_multipliers || {};
    const consts = cfg.constants || {};
    const disabled = isAdmin ? '' : 'disabled';
    const adminBadge = isAdmin
        ? `<span style="background:#DCFCE7;color:#166534;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;">Editing as Super Admin</span>`
        : `<span style="background:#F3F4F6;color:#6B7280;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;">Read-only view</span>`;

    // === Section 1: Categories ===
    const categoriesSection = `
        <details open style="margin-bottom:14px;">
            <summary style="cursor:pointer;font-size:14px;font-weight:600;padding:8px 0;">1. Product Categories <span style="color:#9CA3AF;font-weight:400;font-size:11px;">(${cats.length} rows)</span></summary>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead><tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB;">
                        <th scope="col" style="padding:6px 8px;text-align:left;">ID</th>
                        <th scope="col" style="padding:6px 8px;text-align:left;">Name</th>
                        <th scope="col" style="padding:6px 8px;text-align:left;">Products</th>
                        <th scope="col" style="padding:6px 8px;text-align:left;width:110px;">Default RM</th>
                        ${isAdmin ? '<th scope="col" style="padding:6px 8px;width:40px;"></th>' : ''}
                    </tr></thead>
                    <tbody>
                    ${cats.map((c, i) => `
                        <tr style="border-bottom:1px solid #F3F4F6;">
                            <td style="padding:4px 8px;"><input type="text" value="${escapeHtml(c.id || '')}" ${disabled} data-kind="category" data-index="${i}" data-field="id" style="width:100%;border:1px solid #E5E7EB;padding:4px;font-size:12px;"></td>
                            <td style="padding:4px 8px;"><input type="text" value="${escapeHtml(c.name || '')}" ${disabled} data-kind="category" data-index="${i}" data-field="name" style="width:100%;border:1px solid #E5E7EB;padding:4px;font-size:12px;"></td>
                            <td style="padding:4px 8px;"><input type="text" value="${escapeHtml(c.products || '')}" ${disabled} data-kind="category" data-index="${i}" data-field="products" style="width:100%;border:1px solid #E5E7EB;padding:4px;font-size:12px;"></td>
                            <td style="padding:4px 8px;"><input type="text" value="${c.default_amount == null ? 'Varies' : c.default_amount}" ${disabled} data-kind="category" data-index="${i}" data-field="default_amount" style="width:100%;border:1px solid #E5E7EB;padding:4px;font-size:12px;" placeholder="Varies or number"></td>
                            ${isAdmin ? `<td style="padding:4px 8px;"><button type="button" class="btn-icon" style="color:#DC2626;" onclick="app.deletePipelineCategory(${i})" title="Delete"><i class="fas fa-trash"></i></button></td>` : ''}
                        </tr>`).join('')}
                    </tbody>
                </table>
                ${isAdmin ? `<button type="button" class="btn secondary btn-sm" style="margin-top:8px;" onclick="app.addPipelineCategory()"><i class="fas fa-plus"></i> Add Category</button>` : ''}
            </div>
        </details>`;

    // === Section 2: Activity Base Weights ===
    const weightKeys = Object.keys(weights);
    const weightsSection = `
        <details open style="margin-bottom:14px;">
            <summary style="cursor:pointer;font-size:14px;font-weight:600;padding:8px 0;">2. Activity Base Weights <span style="color:#9CA3AF;font-weight:400;font-size:11px;">(${weightKeys.length} rows)</span></summary>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;max-width:400px;">
                    <thead><tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB;">
                        <th scope="col" style="padding:6px 8px;text-align:left;">Activity Type</th>
                        <th scope="col" style="padding:6px 8px;text-align:left;">Base Weight</th>
                        ${isAdmin ? '<th scope="col" style="padding:6px 8px;width:40px;"></th>' : ''}
                    </tr></thead>
                    <tbody>
                    ${weightKeys.map(k => `
                        <tr style="border-bottom:1px solid #F3F4F6;">
                            <td style="padding:4px 8px;font-family:monospace;">${escapeHtml(k)}</td>
                            <td style="padding:4px 8px;"><input type="number" step="0.5" value="${weights[k]}" ${disabled} data-kind="weight" data-key="${escapeHtml(k)}" style="width:90px;border:1px solid #E5E7EB;padding:4px;"></td>
                            ${isAdmin ? `<td style="padding:4px 8px;"><button type="button" class="btn-icon" style="color:#DC2626;" onclick="app.deletePipelineWeight('${UI.escJsAttr(String(k))}')" title="Delete"><i class="fas fa-trash"></i></button></td>` : ''}
                        </tr>`).join('')}
                    </tbody>
                </table>
                ${isAdmin ? `<button type="button" class="btn secondary btn-sm" style="margin-top:8px;" onclick="app.addPipelineWeight()"><i class="fas fa-plus"></i> Add Activity Type</button>` : ''}
            </div>
        </details>`;

    // === Section 3: Decay Tiers ===
    const decaySection = `
        <details open style="margin-bottom:14px;">
            <summary style="cursor:pointer;font-size:14px;font-weight:600;padding:8px 0;">3. Time Decay Tiers <span style="color:#9CA3AF;font-weight:400;font-size:11px;">(activity age → multiplier)</span></summary>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;max-width:600px;">
                    <thead><tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB;">
                        <th scope="col" style="padding:6px 8px;text-align:left;">Up to N days</th>
                        <th scope="col" style="padding:6px 8px;text-align:left;">Factor</th>
                        <th scope="col" style="padding:6px 8px;text-align:left;">Label</th>
                        ${isAdmin ? '<th scope="col" style="padding:6px 8px;width:40px;"></th>' : ''}
                    </tr></thead>
                    <tbody>
                    ${decay.map((t, i) => `
                        <tr style="border-bottom:1px solid #F3F4F6;">
                            <td style="padding:4px 8px;"><input type="text" value="${t.max_days == null ? 'beyond' : t.max_days}" ${disabled} data-kind="decay" data-index="${i}" data-field="max_days" style="width:90px;border:1px solid #E5E7EB;padding:4px;" placeholder="30 or 'beyond'"></td>
                            <td style="padding:4px 8px;"><input type="number" step="0.05" value="${t.factor}" ${disabled} data-kind="decay" data-index="${i}" data-field="factor" style="width:90px;border:1px solid #E5E7EB;padding:4px;"></td>
                            <td style="padding:4px 8px;"><input type="text" value="${escapeHtml(t.label || '')}" ${disabled} data-kind="decay" data-index="${i}" data-field="label" style="width:100%;border:1px solid #E5E7EB;padding:4px;"></td>
                            ${isAdmin ? `<td style="padding:4px 8px;"><button type="button" class="btn-icon" style="color:#DC2626;" onclick="app.deletePipelineDecay(${i})" title="Delete"><i class="fas fa-trash"></i></button></td>` : ''}
                        </tr>`).join('')}
                    </tbody>
                </table>
                ${isAdmin ? `<button type="button" class="btn secondary btn-sm" style="margin-top:8px;" onclick="app.addPipelineDecay()"><i class="fas fa-plus"></i> Add Tier</button>` : ''}
            </div>
        </details>`;

    // === Section 4: Event Boosters (2D matrix) ===
    const boosterHeader = cats.map(c => `<th scope="col" style="padding:6px 6px;font-size:10px;text-align:center;min-width:70px;">${escapeHtml(c.id)}</th>`).join('');
    const boostersSection = `
        <details open style="margin-bottom:14px;">
            <summary style="cursor:pointer;font-size:14px;font-weight:600;padding:8px 0;">4. Event Boosters <span style="color:#9CA3AF;font-weight:400;font-size:11px;">(EVENT title regex → per-category multiplier)</span></summary>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:900px;">
                    <thead><tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB;">
                        <th scope="col" style="padding:6px;text-align:left;min-width:140px;">Event Name</th>
                        <th scope="col" style="padding:6px;text-align:left;min-width:200px;">Match Pattern (regex)</th>
                        ${boosterHeader}
                        ${isAdmin ? '<th scope="col" style="padding:6px;width:30px;"></th>' : ''}
                    </tr></thead>
                    <tbody>
                    ${boosters.map((b, i) => `
                        <tr style="border-bottom:1px solid #F3F4F6;">
                            <td style="padding:2px 4px;"><input type="text" value="${escapeHtml(b.name || '')}" ${disabled} data-kind="booster" data-index="${i}" data-field="name" style="width:100%;border:1px solid #E5E7EB;padding:4px;font-size:11px;"></td>
                            <td style="padding:2px 4px;"><input type="text" value="${escapeHtml(b.pattern || '')}" ${disabled} data-kind="booster" data-index="${i}" data-field="pattern" style="width:100%;border:1px solid #E5E7EB;padding:4px;font-size:11px;font-family:monospace;"></td>
                            ${cats.map(c => {
                                const v = b.multipliers?.[c.id] ?? '';
                                return `<td style="padding:2px 4px;text-align:center;"><input type="number" step="0.1" value="${v}" ${disabled} data-kind="booster-mult" data-index="${i}" data-cat="${escapeHtml(c.id)}" style="width:55px;border:1px solid #E5E7EB;padding:3px;text-align:center;" placeholder="1"></td>`;
                            }).join('')}
                            ${isAdmin ? `<td style="padding:2px 4px;"><button type="button" class="btn-icon" style="color:#DC2626;" onclick="app.deletePipelineBooster(${i})" title="Delete"><i class="fas fa-trash"></i></button></td>` : ''}
                        </tr>`).join('')}
                    </tbody>
                </table>
                ${isAdmin ? `<button type="button" class="btn secondary btn-sm" style="margin-top:8px;" onclick="app.addPipelineBooster()"><i class="fas fa-plus"></i> Add Event Booster</button>` : ''}
            </div>
        </details>`;

    // === Section 5: Activity × Category Matrix ===
    const actMultRows = Object.keys(actMults);
    const matrixSection = `
        <details style="margin-bottom:14px;">
            <summary style="cursor:pointer;font-size:14px;font-weight:600;padding:8px 0;">5. Activity × Category Multipliers <span style="color:#9CA3AF;font-weight:400;font-size:11px;">(non-EVENT activity routing)</span></summary>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:11px;">
                    <thead><tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB;">
                        <th scope="col" style="padding:6px;text-align:left;min-width:120px;">Activity / Key</th>
                        ${cats.map(c => `<th scope="col" style="padding:6px;font-size:10px;text-align:center;min-width:70px;">${escapeHtml(c.id)}</th>`).join('')}
                        <th scope="col" style="padding:6px;text-align:left;min-width:160px;">Sub-pattern (optional)</th>
                    </tr></thead>
                    <tbody>
                    ${actMultRows.map(key => {
                        const row = actMults[key] || {};
                        return `
                        <tr style="border-bottom:1px solid #F3F4F6;">
                            <td style="padding:4px 8px;font-family:monospace;">${escapeHtml(key)}</td>
                            ${cats.map(c => {
                                const v = row[c.id] ?? '';
                                return `<td style="padding:2px 4px;text-align:center;"><input type="number" step="0.1" value="${v}" ${disabled} data-kind="actmult" data-row="${escapeHtml(key)}" data-cat="${escapeHtml(c.id)}" style="width:55px;border:1px solid #E5E7EB;padding:3px;text-align:center;" placeholder="1"></td>`;
                            }).join('')}
                            <td style="padding:2px 4px;"><input type="text" value="${escapeHtml(row._pattern || '')}" ${disabled} data-kind="actmult-pattern" data-row="${escapeHtml(key)}" style="width:100%;border:1px solid #E5E7EB;padding:4px;font-size:10px;font-family:monospace;"></td>
                        </tr>`;
                    }).join('')}
                    </tbody>
                </table>
            </div>
        </details>`;

    // === Section 6: Global Constants ===
    const constsSection = `
        <details open style="margin-bottom:14px;">
            <summary style="cursor:pointer;font-size:14px;font-weight:600;padding:8px 0;">6. Global Constants</summary>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;max-width:600px;">
                <div>
                    <label style="font-size:11px;color:#6B7280;display:block;margin-bottom:2px;">K constant (score → probability)</label>
                    <input type="number" step="0.1" value="${consts.score_to_prob_k || 2.5}" ${disabled} data-kind="const" data-field="score_to_prob_k" style="width:100%;border:1px solid #E5E7EB;padding:6px;">
                </div>
                <div>
                    <label style="font-size:11px;color:#6B7280;display:block;margin-bottom:2px;">Customer referral bonus (%)</label>
                    <input type="number" step="1" value="${consts.referral_customer_bonus_pct || 20}" ${disabled} data-kind="const" data-field="referral_customer_bonus_pct" style="width:100%;border:1px solid #E5E7EB;padding:6px;">
                </div>
                <div>
                    <label style="font-size:11px;color:#6B7280;display:block;margin-bottom:2px;">Purchase window (days)</label>
                    <input type="number" step="1" value="${consts.referral_customer_purchase_window_days || 180}" ${disabled} data-kind="const" data-field="referral_customer_purchase_window_days" style="width:100%;border:1px solid #E5E7EB;padding:6px;">
                </div>
                <div>
                    <label style="font-size:11px;color:#6B7280;display:block;margin-bottom:2px;">History retention (versions)</label>
                    <input type="number" step="1" value="${consts.history_retention || 25}" ${disabled} data-kind="const" data-field="history_retention" style="width:100%;border:1px solid #E5E7EB;padding:6px;">
                </div>
                <div style="grid-column:1 / -1;">
                    <label style="display:flex;align-items:center;gap:8px;font-size:12px;">
                        <input type="checkbox" ${consts.cps_required ? 'checked' : ''} ${disabled} data-kind="const" data-field="cps_required">
                        CPS required — hard gate (no score without CPS anywhere in history)
                    </label>
                </div>
            </div>
        </details>`;

    const historyBtn = isAdmin
        ? `<button class="btn secondary btn-sm" onclick="app.showPipelineConfigHistory()"><i class="fas fa-history"></i> History</button>`
        : '';

    const content = `
        <div style="padding:4px;max-width:100%;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:10px 12px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;">
                <div>
                    <div style="font-size:13px;font-weight:600;color:#92400E;">Pipeline Scoring Rules v6</div>
                    <div style="font-size:11px;color:#78350F;">Config version ${cfg.version || 1} · ${adminBadge}</div>
                </div>
                ${historyBtn}
            </div>
            ${categoriesSection}
            ${weightsSection}
            ${decaySection}
            ${boostersSection}
            ${matrixSection}
            ${constsSection}
        </div>`;

    const saveBtn = isAdmin
        ? { label: 'Save All Changes', type: 'primary', action: `(async () => { await app.savePipelineRules(); })()` }
        : null;
    const buttons = [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
        ...(saveBtn ? [saveBtn] : []),
    ];
    UI.showModal('Pipeline Scoring Rules', content, buttons);
};

const _readPipelineDraftFromDom = () => {
    const cfg = _pipelineEditDraft;
    if (!cfg) return null;
    // Categories
    document.querySelectorAll('[data-kind="category"]').forEach(el => {
        const i = parseInt(el.dataset.index, 10);
        const field = el.dataset.field;
        if (!cfg.categories[i]) return;
        if (field === 'default_amount') {
            const raw = (el.value || '').trim();
            if (!raw || /^(varies|null|-)$/i.test(raw)) {
                cfg.categories[i].default_amount = null;
            } else {
                const n = parseFloat(raw);
                cfg.categories[i].default_amount = isNaN(n) ? null : n;
            }
        } else {
            cfg.categories[i][field] = el.value;
        }
    });
    // Activity weights
    document.querySelectorAll('[data-kind="weight"]').forEach(el => {
        const key = el.dataset.key;
        cfg.activity_weights[key] = parseFloat(el.value) || 0;
    });
    // Decay tiers
    document.querySelectorAll('[data-kind="decay"]').forEach(el => {
        const i = parseInt(el.dataset.index, 10);
        const field = el.dataset.field;
        if (!cfg.decay_tiers[i]) return;
        if (field === 'max_days') {
            const raw = (el.value || '').trim();
            cfg.decay_tiers[i].max_days = /^(beyond|null|-|infinity)$/i.test(raw) ? null : (parseInt(raw, 10) || null);
        } else if (field === 'factor') {
            cfg.decay_tiers[i].factor = parseFloat(el.value) || 0;
        } else {
            cfg.decay_tiers[i][field] = el.value;
        }
    });
    // Event boosters — name/pattern
    document.querySelectorAll('[data-kind="booster"]').forEach(el => {
        const i = parseInt(el.dataset.index, 10);
        const field = el.dataset.field;
        if (!cfg.event_boosters[i]) return;
        cfg.event_boosters[i][field] = el.value;
    });
    // Event booster multipliers
    document.querySelectorAll('[data-kind="booster-mult"]').forEach(el => {
        const i = parseInt(el.dataset.index, 10);
        const catId = el.dataset.cat;
        if (!cfg.event_boosters[i]) return;
        if (!cfg.event_boosters[i].multipliers) cfg.event_boosters[i].multipliers = {};
        const v = parseFloat(el.value);
        // Audit L2336: only collapse the genuine no-op default (1) / non-numbers. Keep
        // an explicit 0 so an admin who deliberately zeroes a category/event combo gets
        // a 0 multiplier — NOT the absent-key fallback of 1.0 (the opposite effect).
        if (isNaN(v) || v === 1) {
            delete cfg.event_boosters[i].multipliers[catId];
        } else {
            cfg.event_boosters[i].multipliers[catId] = v;
        }
    });
    // Activity × category matrix
    document.querySelectorAll('[data-kind="actmult"]').forEach(el => {
        const row = el.dataset.row;
        const catId = el.dataset.cat;
        if (!cfg.activity_multipliers[row]) cfg.activity_multipliers[row] = {};
        const v = parseFloat(el.value);
        // Audit L2348: same as the booster branch — preserve an explicit 0 so a
        // zero activity×category multiplier persists instead of falling back to 1.0.
        if (isNaN(v) || v === 1) {
            delete cfg.activity_multipliers[row][catId];
        } else {
            cfg.activity_multipliers[row][catId] = v;
        }
    });
    document.querySelectorAll('[data-kind="actmult-pattern"]').forEach(el => {
        const row = el.dataset.row;
        if (!cfg.activity_multipliers[row]) cfg.activity_multipliers[row] = {};
        if ((el.value || '').trim()) {
            cfg.activity_multipliers[row]._pattern = el.value;
        } else {
            delete cfg.activity_multipliers[row]._pattern;
        }
    });
    // Constants
    document.querySelectorAll('[data-kind="const"]').forEach(el => {
        const field = el.dataset.field;
        if (el.type === 'checkbox') cfg.constants[field] = el.checked;
        else cfg.constants[field] = parseFloat(el.value) || 0;
    });
    return cfg;
};

const savePipelineRules = async () => {
    if (!isSystemAdmin(_state.cu)) {
        UI.toast.error('Super Admin only');
        return;
    }
    const draft = _readPipelineDraftFromDom();
    if (!draft) return;
    await savePipelineConfigJson(draft, 'Super Admin edit');
    UI.toast.success('Pipeline rules saved');
    UI.hideModal();
    const container = document.getElementById('content-viewport');
    if (container) await showPipelineView(container);
};

// CRUD actions that mutate the draft and re-render the modal
const addPipelineCategory = () => {
    _readPipelineDraftFromDom();
    const n = _pipelineEditDraft.categories.length + 1;
    _pipelineEditDraft.categories.push({ id: `cat_${n}`, name: 'New Category', products: '', default_amount: 0 });
    _renderPipelineConfigModal(true);
};
const deletePipelineCategory = (i) => {
    _readPipelineDraftFromDom();
    const cat = _pipelineEditDraft.categories[i];
    if (!cat) return;
    if (!confirm(`Delete category "${cat.name}"? Any prospects targeting it will auto-reroute to the next-best category.`)) return;
    _pipelineEditDraft.categories.splice(i, 1);
    _renderPipelineConfigModal(true);
};
const addPipelineWeight = () => {
    _readPipelineDraftFromDom();
    const key = prompt('New activity type code (e.g. VIDEO_CALL)');
    if (!key) return;
    _pipelineEditDraft.activity_weights[key.trim().toUpperCase()] = 3;
    _renderPipelineConfigModal(true);
};
const deletePipelineWeight = (key) => {
    _readPipelineDraftFromDom();
    delete _pipelineEditDraft.activity_weights[key];
    _renderPipelineConfigModal(true);
};
const addPipelineDecay = () => {
    _readPipelineDraftFromDom();
    _pipelineEditDraft.decay_tiers.push({ max_days: 30, factor: 0.5, label: 'New tier' });
    _renderPipelineConfigModal(true);
};
const deletePipelineDecay = (i) => {
    _readPipelineDraftFromDom();
    _pipelineEditDraft.decay_tiers.splice(i, 1);
    _renderPipelineConfigModal(true);
};
const addPipelineBooster = () => {
    _readPipelineDraftFromDom();
    _pipelineEditDraft.event_boosters.push({ name: 'New Event', pattern: '', multipliers: {} });
    _renderPipelineConfigModal(true);
};
const deletePipelineBooster = (i) => {
    _readPipelineDraftFromDom();
    _pipelineEditDraft.event_boosters.splice(i, 1);
    _renderPipelineConfigModal(true);
};

// Quick-edit the 代理配套 monthly amount
const setAgentPackageAmount = async () => {
    const cfg = await loadPipelineConfig();
    const cat = (cfg.categories || []).find(c => c.id === 'agent_package');
    if (!cat) {
        UI.toast.error('代理配套 category not found');
        return;
    }
    const current = cat.default_amount == null ? '' : cat.default_amount;
    const raw = prompt(`Set this month's 代理配套 amount (RM). Leave blank for "Varies".`, current);
    if (raw === null) return;
    const trimmed = raw.trim();
    if (!trimmed || /^(varies|null|-)$/i.test(trimmed)) {
        cat.default_amount = null;
    } else {
        const n = parseFloat(trimmed);
        if (isNaN(n)) { UI.toast.error('Invalid number'); return; }
        cat.default_amount = n;
    }
    await savePipelineConfigJson(cfg, `Set agent_package amount to ${cat.default_amount}`);
    UI.toast.success('Updated');
    const container = document.getElementById('content-viewport');
    if (container) await showPipelineView(container);
};

const showPipelineConfigHistory = async () => {
    try {
        const history = await AppDataStore.query('pipeline_config_history', {});
        const sorted = [...history].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        const rows = sorted.map(h => `
            <tr style="border-bottom:1px solid #F3F4F6;">
                <td style="padding:6px 8px;font-size:12px;">${new Date(h.updated_at).toLocaleString()}</td>
                <td style="padding:6px 8px;font-size:12px;">${escapeHtml(h.note || '')}</td>
                <td style="padding:6px 8px;"><button class="btn-icon" onclick="app.rollbackPipelineConfig(${h.id})" title="Rollback"><i class="fas fa-undo"></i></button></td>
            </tr>`).join('');
        const content = `
            <div style="max-height:400px;overflow-y:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead><tr style="background:#F9FAFB;">
                        <th scope="col" style="padding:8px;text-align:left;">Saved At</th>
                        <th scope="col" style="padding:8px;text-align:left;">Note</th>
                        <th scope="col" style="padding:8px;width:50px;"></th>
                    </tr></thead>
                    <tbody>${rows || '<tr><td colspan="3" style="padding:24px;text-align:center;color:#9CA3AF;">No history yet</td></tr>'}</tbody>
                </table>
            </div>`;
        UI.showModal(`Pipeline Config History (last ${sorted.length})`, content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
        ]);
    } catch (e) {
        UI.toast.error('Could not load history');
    }
};

const rollbackPipelineConfig = async (historyId) => {
    if (!isSystemAdmin(_state.cu)) { UI.toast.error('Super Admin only'); return; }
    if (!confirm('Roll back to this version? The current rules will be replaced.')) return;
    try {
        const rec = await AppDataStore.getById('pipeline_config_history', historyId);
        if (!rec) { UI.toast.error('Version not found'); return; }
        const parsed = typeof rec.config_json === 'string' ? JSON.parse(rec.config_json) : rec.config_json;
        await savePipelineConfigJson(parsed, `Rollback to ${new Date(rec.updated_at).toLocaleString()}`);
        UI.toast.success('Rolled back');
        UI.hideModal();
        const container = document.getElementById('content-viewport');
        if (container) await showPipelineView(container);
    } catch (e) {
        UI.toast.error('Rollback failed');
    }
};

// ====== Explainability modal ======
// Shows how the probability for a prospect was computed — score breakdown,
// multipliers applied, referral bonus, and the final formula.
const showPipelineExplain = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) { UI.toast.error('Prospect not found'); return; }
    const allActivities = await AppDataStore.query('activities', { prospect_id: prospectId });
    const entry = await calcPipelineEntry(prospect, allActivities);
    const cfg = await loadPipelineConfig();
    const K = cfg.constants?.score_to_prob_k || 2.5;

    if (!entry.qualified) {
        const content = `
            <div style="padding:8px;">
                <p style="font-size:13px;color:#6B7280;">This prospect is not in the pipeline.</p>
                <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:12px;margin-top:8px;">
                    <strong style="color:#92400E;">Reason:</strong> ${escapeHtml(entry.reason || 'Not qualified')}
                </div>
                ${entry.action ? `<p style="margin-top:10px;font-size:12px;"><strong>Next step:</strong> ${entry.action}</p>` : ''}
            </div>`;
        UI.showModal(`Score Breakdown — ${escapeHtml(prospect.name || prospect.full_name || '')}`, content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
        ]);
        return;
    }

    const breakdownRows = (entry.breakdown || []).sort((a, b) => b.contribution - a.contribution).map(c => `
        <tr style="border-bottom:1px solid #F3F4F6;">
            <td style="padding:6px 8px;font-size:11px;">${escapeHtml(c.activity_type)}</td>
            <td style="padding:6px 8px;font-size:11px;color:#6B7280;">${escapeHtml((c.event_title || '').slice(0, 30))}</td>
            <td style="padding:6px 8px;font-size:11px;text-align:right;">${c.age_days}d</td>
            <td style="padding:6px 8px;font-size:11px;text-align:right;">${c.base}</td>
            <td style="padding:6px 8px;font-size:11px;text-align:right;">×${c.decay}</td>
            <td style="padding:6px 8px;font-size:11px;text-align:right;">×${c.multiplier}</td>
            <td style="padding:6px 8px;font-size:11px;text-align:right;font-weight:600;color:#059669;">+${c.contribution}</td>
        </tr>`).join('');

    const allCatScores = Object.entries(entry.categoryScores || {})
        .sort((a, b) => b[1] - a[1])
        .map(([id, s]) => {
            const cat = cfg.categories.find(c => c.id === id);
            const isBest = id === entry.category?.id;
            return `<tr style="${isBest ? 'background:#FEF3C7;font-weight:600;' : ''}">
                <td style="padding:6px 8px;font-size:11px;">${escapeHtml(cat?.name || id)}${isBest ? ' ⭐' : ''}</td>
                <td style="padding:6px 8px;font-size:11px;text-align:right;">${s}</td>
                <td style="padding:6px 8px;font-size:11px;text-align:right;">${Math.min(100, Math.round(s * K))}%</td>
            </tr>`;
        }).join('');

    const referralRow = entry.referralInfo?.applied
        ? `<tr><td colspan="2" style="padding:6px 8px;font-size:12px;color:#92400E;">+ Customer referral bonus <span style="font-size:10px;color:#9CA3AF;">(purchase ${entry.referralInfo.lastPurchaseDate ? new Date(entry.referralInfo.lastPurchaseDate).toLocaleDateString('en-GB') : '—'})</span></td><td style="padding:6px 8px;font-size:12px;text-align:right;font-weight:600;color:#D97706;">+${entry.referralInfo.bonusPct}%</td></tr>`
        : `<tr><td colspan="3" style="padding:6px 8px;font-size:11px;color:#9CA3AF;">Referral bonus: ${escapeHtml(entry.referralInfo?.reason || 'not applied')}</td></tr>`;

    const content = `
        <div style="padding:4px;max-height:70vh;overflow-y:auto;">
            <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:12px;margin-bottom:14px;">
                <div style="font-size:18px;font-weight:700;color:#1E40AF;">${entry.probability}%</div>
                <div style="font-size:12px;color:#1E40AF;">Target: <strong>${escapeHtml(entry.category?.name || '')}</strong></div>
                <div style="font-size:11px;color:#6B7280;margin-top:2px;">Raw score ${entry.rawScore} × K(${K}) = ${Math.min(100, Math.round(entry.rawScore * K))}% ${entry.referralInfo?.applied ? `+ ${entry.referralInfo.bonusPct}% referral bonus` : ''}</div>
            </div>

            <h4 style="font-size:13px;margin:12px 0 6px;">Activity contributions (sorted)</h4>
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
                <thead><tr style="background:#F9FAFB;">
                    <th scope="col" style="padding:6px 8px;text-align:left;">Type</th>
                    <th scope="col" style="padding:6px 8px;text-align:left;">Title</th>
                    <th scope="col" style="padding:6px 8px;text-align:right;">Age</th>
                    <th scope="col" style="padding:6px 8px;text-align:right;">Base</th>
                    <th scope="col" style="padding:6px 8px;text-align:right;">Decay</th>
                    <th scope="col" style="padding:6px 8px;text-align:right;">Mult</th>
                    <th scope="col" style="padding:6px 8px;text-align:right;">Total</th>
                </tr></thead>
                <tbody>${breakdownRows || '<tr><td colspan="7" style="padding:12px;text-align:center;color:#9CA3AF;">No contributing activities</td></tr>'}</tbody>
            </table>

            <h4 style="font-size:13px;margin:14px 0 6px;">All category scores</h4>
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
                <thead><tr style="background:#F9FAFB;">
                    <th scope="col" style="padding:6px 8px;text-align:left;">Category</th>
                    <th scope="col" style="padding:6px 8px;text-align:right;">Score</th>
                    <th scope="col" style="padding:6px 8px;text-align:right;">→ %</th>
                </tr></thead>
                <tbody>${allCatScores}</tbody>
            </table>

            <h4 style="font-size:13px;margin:14px 0 6px;">Bonuses / Penalties</h4>
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
                <tbody>${referralRow}</tbody>
            </table>

            ${entry.action ? `<div style="margin-top:14px;padding:10px;background:#F0FDF4;border-left:3px solid #10B981;font-size:12px;"><strong>Next Best Action:</strong> ${entry.action}</div>` : ''}
        </div>`;

    UI.showModal(`Score Breakdown — ${escapeHtml(prospect.name || prospect.full_name || '')}`, content, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
    ]);
};

const savePipelineConfig = async () => {
    // Legacy alias — now routes to the v6 draft save
    await savePipelineRules();
};

const showProspectMenu = async (prospectId) => {
    if (typeof app.showProspectDetail === 'function') {
        await app.showProspectDetail(prospectId);
    } else {
        UI.toast.info(`Viewing profile for prospect ID: ${prospectId}`);
    }
};

const showComments = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    const notes = (await AppDataStore.query('notes', { prospect_id: prospectId }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const activities = (await AppDataStore.query('activities', { prospect_id: prospectId }))
        .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));

    const content = `
        <div style="max-height:420px;overflow-y:auto;">
            <div style="background:#F9FAFB;padding:12px;border-radius:8px;margin-bottom:14px;">
                <textarea id="new-note-content" class="form-control" placeholder="Add a new comment/note..." style="min-height:72px;"></textarea>
                <div style="display:flex;justify-content:flex-end;margin-top:8px;">
                    <button class="btn primary btn-sm" onclick="app.addPipelineNote(${prospectId})">Add Note</button>
                </div>
            </div>
            <div>
                ${notes.map(n => `
                    <div style="border-left:2px solid #3B82F6;padding-left:12px;margin-bottom:14px;position:relative;">
                        <div style="position:absolute;left:-5px;top:0;width:8px;height:8px;border-radius:50%;background:#3B82F6;"></div>
                        <div style="font-size:11px;color:#6B7280;">${new Date(n.created_at).toLocaleString()}</div>
                        <div style="margin-top:2px;">${escapeHtml(n.content || '')}</div>
                    </div>`).join('')}
                ${activities.map(a => `
                    <div style="border-left:2px solid #10B981;padding-left:12px;margin-bottom:14px;position:relative;">
                        <div style="position:absolute;left:-5px;top:0;width:8px;height:8px;border-radius:50%;background:#10B981;"></div>
                        <div style="font-size:11px;color:#6B7280;">${new Date(a.activity_date).toLocaleString()}</div>
                        <div style="font-weight:600;">Activity: ${escapeHtml(a.activity_type || '')}</div>
                        <div style="margin-top:2px;font-size:12px;">${escapeHtml(a.notes || 'No notes provided.')}</div>
                    </div>`).join('')}
                ${notes.length === 0 && activities.length === 0 ? '<p style="text-align:center;color:#9CA3AF;padding:20px;">No comments or activities found.</p>' : ''}
            </div>
        </div>`;

    UI.showModal(`Comments: ${escapeHtml(prospect?.full_name || prospect?.name || 'Prospect')}`, content, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
    ]);
};

const addPipelineNote = async (prospectId) => {
    const content = document.getElementById('new-note-content')?.value;
    if (!content?.trim()) {
        UI.toast.warning('Please enter some content for the note.');
        return;
    }
    await AppDataStore.create('notes', {
        prospect_id: prospectId,
        content: content.trim(),
        created_at: new Date().toISOString(),
        created_by: _state.cu?.id || 5
    });
    UI.toast.success('Note added.');
    await showComments(prospectId);
    await refreshPipeline();
};

const calculateDealValue = (prospect) => {
    if (!prospect) return 5000;

    // Base value from score
    let value = 5000;
    if (prospect.score) value += prospect.score * 10;

    // Add demographic factors
    if (prospect.income_range?.includes('15,000') || prospect.income_range?.includes('20,000')) {
        value += 2000;
    }
    if (prospect.occupation?.toLowerCase().includes('business') ||
        prospect.occupation?.toLowerCase().includes('owner') ||
        prospect.occupation?.toLowerCase().includes('director')) {
        value += 1500;
    }
    if (prospect.company_name) value += 1000;

    return Math.round(value / 100) * 100; // Round to nearest 100
};

const handleProspectDrag = (e, prospectId) => {
    e.dataTransfer.setData('text/plain', prospectId);
    e.dataTransfer.effectAllowed = 'move';
    e.target.classList.add('dragging');
};

const handleStageDrop = async (e, stageId) => {
    e.preventDefault();
    const prospectId = e.dataTransfer.getData('text/plain');
    const prospect = await AppDataStore.getById('prospects', parseInt(prospectId));

    if (!prospect) return;

    // Remove dragging class
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));

    // If moved to Closed Won, convert to customer
    if (stageId === 'closed-won') {
        UI.showModal('Close Deal',
            `<p>Convert <strong>${esc(prospect.full_name || prospect.name)}</strong> to customer?</p>
             <div class="form-group">
                 <label>Deal Amount (RM)</label>
                 <input type="number" id="deal-amount" class="form-control" value="${prospect.deal_value || 5000}">
             </div>
             <div class="form-group">
                 <label>Close Date</label>
                 <input type="date" id="close-date" class="form-control" value="${new Date().toISOString().split('T')[0]}">
             </div>`,
            [
                { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                { label: 'Close Won', type: 'primary', action: `(async () => { await app.closeDealWon(${prospect.id}); })()` }
            ]
        );
    }
    // If moved to Closed Lost, ask for reason
    else if (stageId === 'closed-lost') {
        UI.showModal('Close Lost',
            `<p>Mark <strong>${esc(prospect.full_name || prospect.name)}</strong> as lost?</p>
             <div class="form-group">
                 <label>Reason</label>
                 <select id="lost-reason" class="form-control">
                     <option value="Price too high">Price too high</option>
                     <option value="Chose competitor">Chose competitor</option>
                     <option value="No decision">No decision</option>
                     <option value="Budget constraints">Budget constraints</option>
                     <option value="Not interested">Not interested</option>
                     <option value="Other">Other</option>
                 </select>
             </div>
             <div class="form-group">
                 <label>Notes</label>
                 <textarea id="lost-notes" class="form-control" rows="2"></textarea>
             </div>`,
            [
                { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                { label: 'Close Lost', type: 'primary', action: `(async () => { await app.closeDealLost(${prospect.id}); })()` }
            ]
        );
    }
    // Normal stage move
    else {
        prospect.pipeline_stage = stageId;
        await AppDataStore.update('prospects', prospect.id, prospect);

        // Log to audit
        if (typeof AuditLogger !== 'undefined') {
            AuditLogger.info('pipeline', 'stage_changed', {
                prospect_id: prospect.id,
                prospect_name: prospect.full_name,
                new_stage: stageId
            });
        }

        await showPipelineView(document.getElementById('content-viewport'));
        UI.toast.success(`${prospect.full_name || prospect.name} moved to ${stageId}`);
    }
};

const closeDealWon = async (prospectId) => {
    // Layer 1: synchronous in-flight guard (set BEFORE the first await) so a
    // double-fire of the modal action / two rapid drops on the same prospect can't
    // both create a customer row (audit L2770).
    const _key = String(prospectId);
    if (_closeWonInFlight.has(_key)) return;
    _closeWonInFlight.add(_key);
    try {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    // Null guard (audit L2772/L2840): getById can return null on RLS deny, offline
    // 'Failed to fetch', or if the prospect was deleted/converted by another agent
    // between the modal opening and the button click. Guard before any deref.
    if (!prospect) { UI.toast.error('Prospect not found'); return; }
    // Layer 2: persisted already-converted guard — dropping the same prospect on
    // Closed-Won twice must NOT create a second customer / double-count the deal
    // (audit L2770(c), mirrors approveProspectConversion).
    if (prospect.status === 'converted') {
        UI.toast.info(`${prospect.full_name || 'This prospect'} is already a customer.`);
        UI.hideModal();
        return;
    }
    const amount = parseFloat(document.getElementById('deal-amount')?.value || prospect.deal_value || 5000) || 0;
    const closeDate = document.getElementById('close-date')?.value || new Date().toISOString().split('T')[0];

    // Create customer record. Do NOT assign id:Date.now() — let Supabase generate the
    // PK (a client Date.now() can collide with an imported customer id or another
    // same-millisecond close). lifetime_value is seeded 0 here and bumped atomically
    // via the shared adjuster below (with a matching purchases row), mirroring the
    // canonical approveQueueEntry/savePurchase path so the leaderboard / LTV-vs-
    // purchases reconciliation stays intact (audit #9 / L2770(b)).
    const customer = {
        full_name: prospect.full_name,
        phone: prospect.phone,
        email: prospect.email,
        ic_number: prospect.ic_number,
        date_of_birth: prospect.date_of_birth,
        ming_gua: prospect.ming_gua,
        element: prospect.element,
        gender: prospect.gender,
        occupation: prospect.occupation,
        company_name: prospect.company_name,
        address: prospect.address,
        lifetime_value: 0,
        total_purchases: 0,
        status: 'active',
        customer_since: closeDate,
        responsible_agent_id: prospect.responsible_agent_id,
        country: UI.countryByCode(prospect.country).code,
        converted_from_prospect_id: prospect.id,
        conversion_amount: amount,
        conversion_date: closeDate
    };

    // Guard create + purchases + LTV in try/catch — a failed write must surface to the
    // user, not silently leave a half-converted prospect.
    let created;
    try {
        created = await AppDataStore.create('customers', customer);
        const customerId = created?.id ?? created?.[0]?.id;
        if (customerId != null && amount > 0) {
            // Canonical purchase row (column is `date`, keyed by customer_id) +
            // atomic lifetime_value/total_purchases bump via the shared adjuster.
            await AppDataStore.create('purchases', {
                customer_id: customerId,
                date: closeDate,
                item: 'Deal closed (pipeline)',
                amount: amount,
                currency: UI.currencyForCountry(prospect.country),
                status: 'COMPLETED',
                payment_method: 'Cash'
            });
            await _utils.adjustCustomerLtv(customerId, amount, 1);
        }
        customer.id = customerId;
    } catch (e) {
        console.error('closeDealWon: customer/purchase write failed', e);
        UI.toast.error('Could not save the closed deal. Please retry.');
        return;
    }

    // Update prospect
    prospect.status = 'converted';
    prospect.pipeline_stage = 'closed-won';
    prospect.deal_value = amount;
    prospect.closed_at = new Date().toISOString();
    prospect.closed_date = closeDate;
    await AppDataStore.update('prospects', prospect.id, prospect);

    // Log to audit
    if (typeof AuditLogger !== 'undefined') {
        AuditLogger.critical('pipeline', 'deal_closed_won', {
            prospect_id: prospect.id,
            prospect_name: prospect.full_name,
            amount: amount,
            customer_id: customer.id
        });
    }

    // Fire configured Slack/Discord webhook for a closed deal — guarded +
    // non-blocking: dispatchWebhookEvent lives in the gcal chunk (may not be
    // loaded), and a webhook failure must never break the close.
    try {
        if (typeof window.app.dispatchWebhookEvent === 'function') {
            window.app.dispatchWebhookEvent('deal_closed', `Deal closed: ${prospect.full_name || 'Customer'} — RM ${amount.toLocaleString()}`, {
                prospect_id: prospect.id,
                customer_id: customer.id,
                name: prospect.full_name || '',
                amount: amount,
                close_date: closeDate,
                agent_id: prospect.responsible_agent_id || null,
            });
        }
    } catch (e) { console.warn('deal_closed webhook dispatch failed:', e); }

    UI.hideModal();
    UI.toast.success(`Deal closed at RM ${amount.toLocaleString()} !Customer created.`);
    await showPipelineView(document.getElementById('content-viewport'));
    } finally {
        _closeWonInFlight.delete(_key);
    }
};

const closeDealLost = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    // Null guard (audit L2840/L2844): getById may return null on RLS deny, offline
    // 'Failed to fetch', or a prospect deleted between modal-open and confirm — guard
    // before mutating any field, mirroring showPipelineExplain.
    if (!prospect) { UI.toast.error('Prospect not found'); return; }
    const reason = document.getElementById('lost-reason')?.value || 'Not specified';
    const notes = document.getElementById('lost-notes')?.value || '';

    prospect.pipeline_stage = 'closed-lost';
    prospect.lost_reason = reason;
    prospect.lost_notes = notes;
    prospect.lost_at = new Date().toISOString();
    prospect.status = 'lost';
    await AppDataStore.update('prospects', prospect.id, prospect);

    // Log to audit
    if (typeof AuditLogger !== 'undefined') {
        AuditLogger.info('pipeline', 'deal_closed_lost', {
            prospect_id: prospect.id,
            prospect_name: prospect.full_name,
            reason: reason
        });
    }

    UI.hideModal();
    UI.toast.info(`Deal marked as lost: ${reason} `);
    await showPipelineView(document.getElementById('content-viewport'));
};

const renderSystemRanking = async () => {
    const list = document.getElementById('system-ranking-list');
    if (!list) return;

    // Get top 5 prospects by score
    const prospects = (await getVisibleProspects())
        .filter(p => p.status !== 'converted' && p.status !== 'lost')
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5);

    list.innerHTML = prospects.map((p, idx) => `
        <div class="pipeline-card border-system">
            <div class="card-header">
                <div class="card-title">
                    ${idx + 1}. ${esc(p.full_name || p.name)}
                </div>
            </div>
            <div class="card-subtitle">
                Score: ${p.score || 0} · Potential: ${calculatePotentialValue(p)}
            </div>
        </div>
    `).join('');
};

const renderManualPriority = async () => {
    // Audit L2889/L2902: the previous body queried my_potential_list + all visible
    // prospects, built a Map, then filtered/sorted a `filtered` list that was NEVER
    // written to the DOM or passed anywhere — pure dead work. The manual-priority UI
    // is rendered by refreshPipeline()/showPipelineView (the source of truth), so the
    // post-boost refresh that submitBoost expects happens here via refreshPipeline().
    await refreshPipeline();
};

const handleDragStart = (e, id) => {
    _draggedId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.target.classList.add('dragging');
};

const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
};

const handleDrop = async (e, targetId) => {
    e.preventDefault();
    e.stopPropagation();

    if (_draggedId === targetId) return;

    const userId = _state.cu?.id || 5;
    const list = (await AppDataStore.query('my_potential_list', { user_id: userId }))
        .sort((a, b) => a.priority_order - b.priority_order);

    const draggedIndex = list.findIndex(i => i.id === _draggedId);
    const targetIndex = list.findIndex(i => i.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Reorder
    const [removed] = list.splice(draggedIndex, 1);
    list.splice(targetIndex, 0, removed);

    // Update priority_order and PERSIST. Wrap the sequential writes (audit L2943): if
    // any update rejects mid-loop (RLS deny, offline, sync 409), the remaining rows
    // keep stale orders → duplicate/gapped ranks. Catch, warn the user, and re-render
    // to resync the UI with whatever actually persisted; only write rows whose order
    // actually changed to minimize round-trips.
    try {
        for (const [idx, item] of list.entries()) {
            if (item.priority_order !== idx + 1) {
                await AppDataStore.update('my_potential_list', item.id, { priority_order: idx + 1 });
            }
        }
        UI.toast.info('Order rearranged.');
    } catch (e) {
        console.error('handleDrop: reorder persist failed', e);
        UI.toast.error('Could not save the new order. Refreshing…');
    }
    await refreshPipeline();
};

const saveManualOrder = async () => {
    // Since we persist in handleDrop, this just ensures everything is synced
    UI.toast.success('Manual priority order synced.');
    await refreshPipeline();
};

// ===== MONTH FOCUS: Archive / History / Search / Team View =====

const renderArchiveFocusRow = async (arc, idx) => {
    const prospect = await AppDataStore.getById('prospects', arc.prospect_id);
    const name = prospect ? escapeHtml(prospect.name || prospect.full_name || '') : 'Unknown';
    const amountHtml = arc.amount != null ? `RM ${Number(arc.amount).toLocaleString()}` : 'N/A';
    const prob = parseInt(arc.probability || 0);
    const color = prob >= 80 ? '#DC2626' : prob >= 60 ? '#F59E0B' : '#6B7280';
    const label = prob >= 80 ? 'HOT' : prob >= 50 ? 'WARM' : 'COLD';
    return `<tr style="border-bottom:1px solid #F3F4F6;background:#FAFAFA;">
        <td style="padding:14px 12px;"><span style="font-weight:700;color:#6B7280;">${idx + 1}</span></td>
        <td style="padding:14px 12px;"><div style="font-weight:600;color:#111827;">${name}</div></td>
        <td style="padding:14px 12px;"><div style="font-weight:500;color:#1E40AF;">${escapeHtml(arc.target_product || '')}</div></td>
        <td style="padding:14px 12px;font-weight:600;color:#059669;">${amountHtml}</td>
        <td style="padding:14px 12px;"><span style="background:${color};color:white;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${label}</span><strong style="margin-left:6px;">${prob}%</strong></td>
        <td style="padding:14px 12px;font-size:13px;">${escapeHtml(arc.action_needed || '')}</td>
        <td style="padding:14px 12px;">
            <div style="display:flex;gap:6px;">
                ${prospect ? `<button class="btn-icon" onclick="event.stopPropagation();app.showProspectMenu(${arc.prospect_id})" title="View Profile"><i class="fas fa-eye"></i></button>` : ''}
                <button class="btn secondary btn-sm" style="padding:2px 8px;font-size:10px;" onclick="event.stopPropagation();app.reAddFromArchive(${arc.prospect_id})" title="Add back to current focus"><i class="fas fa-redo"></i> Re-Add</button>
            </div>
        </td>
    </tr>`;
};

const switchFocusMonth = async (month) => {
    _focusViewMonth = month;
    await refreshPipeline();
};

const openExpiredSearchModal = async () => {
    const userId = _state.cu?.id || 5;
    let archiveItems = [];
    try { archiveItems = await AppDataStore.query('monthly_focus_archive', { user_id: userId }); } catch(e) {}

    const allProspects = await getVisibleProspects();
    const allActs = await getVisibleActivities();
    const currentFocus = await AppDataStore.query('my_potential_list', { user_id: userId });
    const currentFocusIds = new Set(currentFocus.map(f => f.prospect_id));
    // Bucket activities by prospect_id ONCE — both the "has activity" membership
    // check and the per-prospect activity lookup below read this Map instead of
    // re-scanning allActs per prospect. `.has(p.id)` is true iff a bucket exists,
    // which is exactly when the old `allActs.some(a => a.prospect_id === p.id)` was.
    const _actsByProspect = _groupActivitiesByProspect(allActs);

    // Prospects with activity history not in current focus
    const availableProspects = allProspects.filter(p => {
        if (currentFocusIds.has(p.id)) return false;
        return _actsByProspect.has(p.id);
    });

    // Build archive rows grouped by month — reuse the already-fetched allProspects
    // as a Map to avoid N+1 sequential getById on each archive row.
    const prospectsById = new Map((allProspects || []).map(p => [String(p.id), p]));

    const archiveByMonth = {};
    for (const arc of archiveItems) {
        if (!archiveByMonth[arc.month]) archiveByMonth[arc.month] = [];
        archiveByMonth[arc.month].push(arc);
    }
    const archiveMonthKeys = Object.keys(archiveByMonth).sort().reverse();

    let archiveHtml = '';
    for (const month of archiveMonthKeys) {
        const items = archiveByMonth[month];
        const monthLabel = new Date(month + '-01').toLocaleString('default', { month: 'long', year: 'numeric' });
        let rows = '';
        for (const arc of items) {
            const p = prospectsById.get(String(arc.prospect_id));
            const pName = p ? escapeHtml(p.name || p.full_name || '') : 'Unknown';
            const inCurrent = currentFocusIds.has(arc.prospect_id);
            rows += `<tr style="border-bottom:1px solid #F3F4F6;">
                <td style="padding:8px 10px;">${pName}</td>
                <td style="padding:8px 10px;">${escapeHtml(arc.target_product || '')}</td>
                <td style="padding:8px 10px;">${arc.amount != null ? 'RM ' + Number(arc.amount).toLocaleString() : '-'}</td>
                <td style="padding:8px 10px;">${arc.probability || 0}%</td>
                <td style="padding:8px 10px;">${escapeHtml(arc.action_needed || '-')}</td>
                <td style="padding:8px 10px;">
                    ${inCurrent
                        ? '<span style="color:#059669;font-size:11px;font-weight:600;">Already in list</span>'
                        : `<button class="btn primary btn-sm" style="padding:2px 10px;font-size:11px;" onclick="event.stopPropagation();app.reAddFromArchive(${arc.prospect_id});"><i class="fas fa-plus"></i> Add Back</button>`}
                </td>
            </tr>`;
        }
        archiveHtml += `
            <div style="margin-bottom:16px;">
                <h4 style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-calendar-alt" style="color:#6B7280;"></i> ${monthLabel}
                    <span style="background:#F3F4F6;padding:2px 8px;border-radius:12px;font-size:11px;color:#6B7280;">${items.length}</span>
                </h4>
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead><tr style="background:#F9FAFB;border-bottom:1px solid #E5E7EB;">
                        <th scope="col" style="padding:8px 10px;text-align:left;">Name</th>
                        <th scope="col" style="padding:8px 10px;text-align:left;">Product</th>
                        <th scope="col" style="padding:8px 10px;text-align:left;">Amount</th>
                        <th scope="col" style="padding:8px 10px;text-align:left;">Prob</th>
                        <th scope="col" style="padding:8px 10px;text-align:left;">Action</th>
                        <th scope="col" style="padding:8px 10px;text-align:left;"></th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }
    if (!archiveHtml) archiveHtml = '<p style="color:#9CA3AF;text-align:center;padding:24px;"><i class="fas fa-archive" style="font-size:24px;display:block;margin-bottom:8px;"></i>No archived focus items yet.</p>';

    // Build available prospects (expired pipeline) rows
    let availRows = '';
    for (const p of availableProspects.slice(0, 50)) {
        const pActs = _actsByProspect.get(p.id) || [];
        const pEntry = await calcPipelineEntry(p, pActs);
        const lastDate = pEntry.lastActivityDate ? pEntry.lastActivityDate.toLocaleDateString('en-GB') : 'None';
        availRows += `<tr style="border-bottom:1px solid #F3F4F6;">
            <td style="padding:8px 10px;">${escapeHtml(p.name || p.full_name || '')}</td>
            <td style="padding:8px 10px;">${escapeHtml(pEntry.category?.name || '-')}</td>
            <td style="padding:8px 10px;">${pEntry.probability || 0}%</td>
            <td style="padding:8px 10px;font-size:11px;">${lastDate}</td>
            <td style="padding:8px 10px;">
                <button class="btn primary btn-sm" style="padding:2px 10px;font-size:11px;" onclick="event.stopPropagation();app.reAddFromArchive(${p.id});"><i class="fas fa-plus"></i> Add</button>
            </td>
        </tr>`;
    }

    const modalContent = `
        <div style="max-height:70vh;overflow-y:auto;">
            <div style="margin-bottom:16px;">
                <input type="text" id="expired-search-input" class="form-control" placeholder="Search by name..."
                    oninput="app.filterExpiredSearch(this.value)" style="width:100%;">
            </div>
            <div style="display:flex;gap:8px;margin-bottom:16px;">
                <button class="btn secondary btn-sm expired-search-tab" style="font-weight:600;border-bottom:2px solid #2563EB;" onclick="app.switchExpiredTab('archive', this)"><i class="fas fa-archive"></i> Past Focus Lists</button>
                <button class="btn secondary btn-sm expired-search-tab" onclick="app.switchExpiredTab('pipeline', this)"><i class="fas fa-chart-line"></i> Available Prospects (${availableProspects.length})</button>
            </div>
            <div id="expired-archive-tab">${archiveHtml}</div>
            <div id="expired-pipeline-tab" style="display:none;">
                ${availRows ? `
                    <table style="width:100%;border-collapse:collapse;font-size:12px;">
                        <thead><tr style="background:#F9FAFB;border-bottom:1px solid #E5E7EB;">
                            <th scope="col" style="padding:8px 10px;text-align:left;">Name</th>
                            <th scope="col" style="padding:8px 10px;text-align:left;">Category</th>
                            <th scope="col" style="padding:8px 10px;text-align:left;">Prob</th>
                            <th scope="col" style="padding:8px 10px;text-align:left;">Last Activity</th>
                            <th scope="col" style="padding:8px 10px;text-align:left;"></th>
                        </tr></thead>
                        <tbody id="expired-pipeline-body">${availRows}</tbody>
                    </table>
                ` : '<p style="color:#9CA3AF;text-align:center;padding:24px;">No additional prospects found.</p>'}
            </div>
        </div>`;

    UI.showModal('Browse Expired & Available Prospects', modalContent, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
    ]);
};

const switchExpiredTab = (tab, btn) => {
    document.getElementById('expired-archive-tab').style.display = tab === 'archive' ? '' : 'none';
    document.getElementById('expired-pipeline-tab').style.display = tab === 'pipeline' ? '' : 'none';
    document.querySelectorAll('.expired-search-tab').forEach(b => {
        b.style.fontWeight = '';
        b.style.borderBottom = '';
    });
    if (btn) { btn.style.fontWeight = '600'; btn.style.borderBottom = '2px solid #2563EB'; }
};

const filterExpiredSearch = (query) => {
    const q = query.toLowerCase();
    document.querySelectorAll('#expired-archive-tab tr:not(:first-child), #expired-pipeline-body tr').forEach(row => {
        if (row.closest('thead')) return;
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(q) ? '' : 'none';
    });
};

const reAddFromArchive = async (prospectId) => {
    await addToFocusList(prospectId);
    UI.hideModal();
};

const changeFocusTargetProduct = async (listItemId, product) => {
    await AppDataStore.update('my_potential_list', listItemId, { target_product: product });
    UI.toast.success('Target product updated');
};

const changeFocusTargetDetail = async (listItemId, detail) => {
    await AppDataStore.update('my_potential_list', listItemId, { target_product_detail: detail });
};

const toggleAgentFocusSection = (header) => {
    const body = header.nextElementSibling;
    const icon = header.querySelector('.agent-collapse-icon');
    if (body.style.display === 'none') {
        body.style.display = '';
        if (icon) icon.textContent = '▾';
    } else {
        body.style.display = 'none';
        if (icon) icon.textContent = '▸';
    }
};

// ===== END MONTH FOCUS EXTENSIONS =====

const renderRecentOverrides = async () => {
    const container = document.getElementById('recent-overrides-table');
    if (!container) return;

    const overrides = (await AppDataStore.query('manual_overrides', { user_id: _state.cu?.id || 5 }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 3);

    if (overrides.length === 0) {
        container.innerHTML = '<p class="text-muted">No recent overrides.</p>';
        return;
    }


// Fetch all prospects in parallel
const prospectsData = await Promise.all(
overrides.map(async (o) => {
    const prospect = await AppDataStore.getById('prospects', o.prospect_id);
    const date = new Date(o.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return {
        prospectName: prospect?.full_name || prospect?.name || 'Unknown',
        date,
        overrideType: o.override_type,
        systemRank: o.system_rank,
        newPriority: o.new_priority,
        status: o.status
    };
})
);


// Now build the HTML synchronously
container.innerHTML = `
<table class="history-table">
    <thead>
        <tr>
            <th scope="col">Prospect</th>
            <th scope="col">Date</th>
            <th scope="col">Type</th>
            <th scope="col">Changes</th>
            <th scope="col">Status</th>
        </tr>
    </thead>
    <tbody>
        ${prospectsData.map(p => `
            <tr>
                <td>${esc(p.prospectName)}</td>
                <td>${p.date}</td>
                <td><span class="type-badge type-${p.overrideType}">${p.overrideType.toUpperCase()}</span></td>
                <td>#${p.systemRank} → #${p.newPriority}</td>
                <td><span class="status-badge status-${p.status}">${p.status.toUpperCase()}</span></td>
            </tr>
        `).join('')}
           </tbody>
        </table>
    `;
};


// Boost Logic
const openBoostModal = async () => {
    const prospects = await getVisibleProspects();
    const manualList = await AppDataStore.query('my_potential_list', { user_id: _state.cu?.id || 5 });

    const options = manualList.map(item => {
        const p = prospects.find(pro => pro.id === item.prospect_id);
        if (!p) return '';
        return `<option value="${p.id}">${esc(p.full_name || p.name)} (Current Rank #${item.priority_order}, ${calculatePotentialValue(p)})</option>`;
    }).join('');

    const content = `
        <div class="form-group">
            <label>Select Prospect</label>
            <select id="boost-prospect-id" class="form-control">${options}</select>
        </div>
        <div class="form-group">
            <label>Justification Required <span style="color:red">*</span></label>
            <textarea id="boost-justification" class="form-control boost-justification" placeholder="Why should this prospect be prioritized? Provide details about conversation, urgency, or potential."></textarea>
        </div>
        <div class="form-group">
            <label>Reason Category</label>
            <div class="reason-group">
                <label><input type="radio" name="boost-reason" value="conversation" checked> Direct conversation</label>
                <label><input type="radio" name="boost-reason" value="interest"> High interest</label>
                <label><input type="radio" name="boost-reason" value="urgency"> Urgency</label>
            </div>
        </div>
        <div class="expiry-checkbox">
            <label><input type="checkbox" id="boost-expires" checked> This override expires in 7 days</label>
        </div>
`;

    UI.showModal('Boost Opportunity', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Confirm Boost', type: 'primary', action: '(async () => { await app.submitBoost(); })()' }
    ]);
};

const submitBoost = async () => {
    const prospectId = parseInt(document.getElementById('boost-prospect-id')?.value ?? '0');
    const justification = document.getElementById('boost-justification')?.value ?? '';
    const reason = document.querySelector('input[name="boost-reason"]:checked')?.value ?? 'conversation';
    const expires = document.getElementById('boost-expires').checked;

    if (!justification) {
        UI.toast.error('Justification is required.');
        return;
    }

    const manualList = (await AppDataStore.query('my_potential_list', { user_id: _state.cu?.id || 5 }))
        .sort((a, b) => a.priority_order - b.priority_order);

    // Match with == / String() coercion to tolerate prospect_id type drift (some rows
    // store it as a string while parseInt above yields a number).
    const currentItem = manualList.find(i => String(i.prospect_id) === String(prospectId));
    // Null guard (audit L3271): find() returns undefined if the list changed between
    // modal-open and submit (item removed, month rolled over, RLS empty-read) — reading
    // currentItem.priority_order would throw and abort the boost with no feedback.
    if (!currentItem) { UI.toast.error('Prospect not in your priority list'); return; }
    const oldRank = currentItem.priority_order;

    // Move to Rank 1 (priority_order = 1), shift others down. Guard the sequential
    // per-row writes (audit L2943 — same non-atomic pattern as handleDrop): a mid-loop
    // reject would otherwise leave duplicate/gapped ranks with no feedback.
    try {
        for (const item of manualList) {
            if (item.priority_order < oldRank) {
                item.priority_order += 1;
                await AppDataStore.update('my_potential_list', item.id, { priority_order: item.priority_order });
            }
        }
        await AppDataStore.update('my_potential_list', currentItem.id, { priority_order: 1 });
    } catch (e) {
        console.error('submitBoost: priority reorder failed', e);
        UI.toast.error('Could not apply the boost. Refreshing…');
        await renderManualPriority();
        return;
    }

    // Log override
    const override = {
        user_id: _state.cu?.id || 5,
        prospect_id: prospectId,
        override_type: 'boost',
        system_rank: oldRank, // For demo, we use current rank as system rank surrogate if not stored
        new_priority: 1,
        reason_category: reason,
        justification: justification,
        status: 'active',
        expires_at: expires ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null
    };
    await AppDataStore.create('manual_overrides', override);

    UI.hideModal();
    await renderManualPriority();
    await renderRecentOverrides();
    UI.toast.success('Opportunity boosted to priority #1.');
};

// History Logic
const openHistoryModal = async () => {
    const content = `
        <div class="filter-bar" style="margin-bottom: 20px;">
            <div class="filter-group">
                <label>From - To</label>
                <div style="display:flex; gap:8px;">
                    <input type="date" class="form-control" id="hist-from">
                    <input type="date" class="form-control" id="hist-to">
                </div>
            </div>
            <div class="filter-group">
                <label>Type</label>
                <select class="form-control" id="hist-type">
                    <option value="all">All</option>
                    <option value="boost">Boost</option>
                    <option value="demote">Demote</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Status</label>
                <select class="form-control" id="hist-status">
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="expired">Expired</option>
                </select>
            </div>
        </div>
        <div id="history-modal-table">
            <!-- Data loaded here -->
        </div>
`;

    UI.showModal('Manual Override History', content, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
    ]);

    await loadOverrideHistory();

    // Add event listeners for async filters
    setTimeout(() => {
        ['hist-type', 'hist-status'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', async () => await loadOverrideHistory());
        });
    }, 100);
};

const loadOverrideHistory = async () => {
    const t = document.getElementById('hist-type');
    const s = document.getElementById('hist-status');
    if (!t || !s) return;
    const type = t.value;
    const status = s.value;

    let overrides = await AppDataStore.query('manual_overrides', { user_id: _state.cu?.id || 5 });

    if (type !== 'all') overrides = overrides.filter(o => o.override_type === type);
    if (status !== 'all') overrides = overrides.filter(o => o.status === status);

    const container = document.getElementById('history-modal-table');
    if (!container) return;

// Fetch all prospect data in parallel
const overridesWithDetails = await Promise.all(
overrides.map(async (o) => {
    const prospect = await AppDataStore.getById('prospects', o.prospect_id);
    const date = new Date(o.created_at).toLocaleDateString();
    return {
        id: o.id,
        prospectName: prospect?.full_name || prospect?.name || 'Unknown',
        date,
        overrideType: o.override_type,
        systemRank: o.system_rank,
        newPriority: o.new_priority,
        status: o.status
    };
})
);

// Now build the HTML synchronously
container.innerHTML = `
<table class="history-table">
    <thead>
        <tr>
            <th scope="col">Prospect Name</th>
            <th scope="col">Date</th>
            <th scope="col">Type</th>
            <th scope="col">From Rank → To Rank</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
        </tr>
    </thead>
    <tbody>
        ${overridesWithDetails.map(d => `
            <tr>
                <td>${esc(d.prospectName)}</td>
                <td>${d.date}</td>
                <td><span class="type-badge type-${d.overrideType}">${d.overrideType.toUpperCase()}</span></td>
                <td>#${d.systemRank} → #${d.newPriority}</td>
                <td><span class="status-badge status-${d.status}">${d.status.toUpperCase()}</span></td>
                <td><button class="btn btn-sm secondary" onclick="app.viewJustification(${d.id})">View</button></td>
            </tr>
        `).join('')}
    </tbody>
</table>
`;
};

const viewJustification = async (overrideId) => {
    const override = await AppDataStore.getById('manual_overrides', overrideId);
    if (!override) return;

    const prospect = await AppDataStore.getById('prospects', override.prospect_id);

    const content = `
        <div style="padding: 10px;">
            <p><strong>Prospect:</strong> ${esc(prospect?.full_name)}</p>
            <p><strong>Type:</strong> ${override.override_type === 'boost' ? '🚀 Boost' : '⬇️ Demote'}</p>
            <p><strong>Reason Category:</strong> ${esc(override.reason_category)}</p>
            <hr>
            <p><strong>Justification:</strong></p>
            <p style="background: #f9fafb; padding: 15px; border-radius: 8px; font-style: italic;">"${esc(override.justification)}"</p>
            <p><strong>Date:</strong> ${new Date(override.created_at).toLocaleString()}</p>
            ${override.expires_at ? `<p><strong>Expires:</strong> ${new Date(override.expires_at).toLocaleString()}</p>` : ''}
        </div>
`;

    UI.showModal('Override Justification', content, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
    ]);
};

// [CHUNK: reporting] 8 functions extracted to chunks/script-reporting.js — loaded role-gated by navigateTo().


// [CHUNK: marketing] 88 functions extracted to chunks/script-marketing.js — loaded role-gated by navigateTo().



    app.register('pipeline', {
        loadPipelineConfig,
        savePipelineConfigJson,
        _pipelineDecayFactor,
        _pipelineActivityText,
        _getPipelineEventsMap,
        _invalidatePipelineEventsCache,
        _pipelineActivityMultiplier,
        checkReferralBonus,
        calcPipelineEntry,
        generatePipelineAction,
        runHuiJiMigration,
        getNoteCount,
        getProspectOutcome,
        getPipelineAmount,
        showPipelineView,
        renderFocusRow,
        renderSystemRow,
        refreshPipeline,
        renderPlanItemRow,
        openActionPlanModal,
        addPlanItemRow,
        saveActionPlan,
        updatePlanCheck,
        sendPlanReminder,
        showActionPlanHistory,
        initActionPlanReminder,
        editFocusAmount,
        editFocusAction,
        resetFocusField,
        addToFocusList,
        removeFromFocusList,
        setPipelineFilter,
        _pipelineDraftClone,
        openPipelineConfigModal,
        _renderPipelineConfigModal,
        _readPipelineDraftFromDom,
        savePipelineRules,
        addPipelineCategory,
        deletePipelineCategory,
        addPipelineWeight,
        deletePipelineWeight,
        addPipelineDecay,
        deletePipelineDecay,
        addPipelineBooster,
        deletePipelineBooster,
        setAgentPackageAmount,
        showPipelineConfigHistory,
        rollbackPipelineConfig,
        showPipelineExplain,
        savePipelineConfig,
        showProspectMenu,
        showComments,
        addPipelineNote,
        calculateDealValue,
        handleProspectDrag,
        handleStageDrop,
        closeDealWon,
        closeDealLost,
        renderSystemRanking,
        renderManualPriority,
        handleDragStart,
        handleDragOver,
        handleDrop,
        saveManualOrder,
        renderArchiveFocusRow,
        switchFocusMonth,
        openExpiredSearchModal,
        switchExpiredTab,
        filterExpiredSearch,
        reAddFromArchive,
        changeFocusTargetProduct,
        changeFocusTargetDetail,
        toggleAgentFocusSection,
        renderRecentOverrides,
        openBoostModal,
        submitBoost,
        openHistoryModal,
        loadOverrideHistory,
        viewJustification,
    });
})();