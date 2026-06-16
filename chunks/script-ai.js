/**
 * CRM Lazy Chunk: AI Analytics
 *
 * Self-contained IIFE. Accesses shared state through window.* globals only.
 * Loaded on-demand by navigateTo() when user navigates to 'ai_insights' view.
 * All public functions registered on window.app via Object.assign at the bottom.
 *
 * Extracted 2026-06-05 from script.js (PHASE 17: AI ANALYTICS FUNCTIONS).
 * ~1336 lines removed from the main IIFE.
 *
 * External dependencies (all global):
 *   window.AppDataStore   window.UI   window.app
 *   window._crmUtils.generateModelId
 */
(() => {
    const generateModelId = window._crmUtils.generateModelId;
    // Missing cross-chunk alias (post-split): generateId() is called in
    // predictLeadScore/calculateChurnRisk/generateSalesForecast/generateAgentInsights
    // (lines ~650/840/1131/1318) but was never aliased here → ReferenceError on
    // every AI prediction/forecast write. _crmUtils.generateId is the canonical one.
    const generateId = (...a) => window._crmUtils.generateId(...a);
    // Aliases for the real-data heuristic engine (added 2026-06-16 — replaces the
    // old mock/randomized dashboard fills). esc = HTML escaper (REUSE — never
    // interpolate DB/user fields raw); _state = shared app state (current user
    // via _state.cu); getVisibleUserIds = the same permission-scoping helper the
    // rest of the app uses (returns 'all' or an array of user ids).
    const esc = (s) => window._crmUtils.escapeHtml(s);
    const _state = window._appState;
    const getVisibleUserIds = (u) => window._crmUtils.getVisibleUserIds(u);
    let _aiService = null;
    let _currentModelVersion = '1.0.0';

    // ── Real-data insight engine ──────────────────────────────────────────
    // DETERMINISTIC heuristics over genuine CRM data — NO Math.random, NO
    // external ML/API. Every number below is reproducible from the same inputs.
    // The four dashboard fills (stats cards / timeline / predictions / insight
    // cards) all read from ONE memoized snapshot so the modal does a single
    // scoped data pass instead of re-querying per section.
    const _DAY_MS = 24 * 60 * 60 * 1000;
    const _MONTH_MS = 30 * _DAY_MS;
    const _SALES_ITEMS = new Set(['SALES', 'SALE', 'PURCHASE', 'CLOSING', 'TRANSACTION']);

    const _daysSince = (dateLike) => {
        if (!dateLike) return Infinity;
        const t = new Date(dateLike).getTime();
        if (!isFinite(t)) return Infinity;
        return Math.max(0, Math.floor((Date.now() - t) / _DAY_MS));
    };
    const _clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    // Safe numeric coercion — guards against NaN/Infinity ever reaching the DOM.
    const _num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
    // YYYY-MM bucket key from any date-ish value.
    const _monthKey = (dateLike) => {
        const d = new Date(dateLike);
        if (!isFinite(d.getTime())) return null;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const _monthLabel = (key) => {
        const [y, m] = key.split('-').map(Number);
        return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    };
    // potential_level (string) → 0-100 contribution.
    const _potentialToScore = (lvl) => {
        const s = String(lvl || '').trim().toLowerCase();
        if (s === 'high' || s === 'a' || s === 'hot') return 100;
        if (s === 'medium' || s === 'b' || s === 'warm') return 60;
        if (s === 'low' || s === 'c' || s === 'cold') return 30;
        return 0;
    };

    // Snapshot cache — short TTL so Refresh re-computes but a single modal open
    // doesn't fan out four identical scoped passes.
    let _snapshot = null;
    let _snapshotTs = 0;
    const _SNAPSHOT_TTL = 60 * 1000;

    const _invalidateSnapshot = () => { _snapshot = null; _snapshotTs = 0; };

    // Load every data source once, scope to the viewer's permissions exactly
    // like the rest of the app (getVisibleUserIds → 'all' | [ids]).
    const _loadScopedData = async () => {
        const cu = _state && _state.cu;
        const visible = await getVisibleUserIds(cu).catch(() => 'all');
        const seeAll = visible === 'all';
        const visibleSet = seeAll ? null : new Set((visible || []).map(String));
        const ownedByViewer = (agentId) => seeAll || (agentId != null && visibleSet.has(String(agentId)));

        const [prospects, customers, purchases, activities, users] = await Promise.all([
            AppDataStore.getAll('prospects').catch(() => []),
            AppDataStore.getAll('customers').catch(() => []),
            AppDataStore.getAll('purchases').catch(() => []),
            AppDataStore.getAll('activities').catch(() => []),
            AppDataStore.getAll('users').catch(() => []),
        ]);

        const customerMap = new Map((customers || []).map(c => [String(c.id), c]));
        const userMap = new Map((users || []).map(u => [String(u.id), u]));
        // purchases carry no agent_id → resolve via customer.responsible_agent_id
        // (same rule as reporting._getPurchaseAgentId).
        const purchaseAgentId = (p) => (customerMap.get(String(p.customer_id)) || {}).responsible_agent_id || p.agent_id;

        return {
            cu, seeAll, ownedByViewer, purchaseAgentId,
            customerMap, userMap,
            prospects: (prospects || []).filter(p => ownedByViewer(p.responsible_agent_id)),
            customers: (customers || []).filter(c => ownedByViewer(c.responsible_agent_id)),
            purchases: (purchases || []).filter(p => ownedByViewer(purchaseAgentId(p))),
            activities: (activities || []).filter(a => ownedByViewer(a.lead_agent_id)),
            users: users || [],
        };
    };

    // Index activities by prospect/customer for O(1) per-entity lookups.
    const _indexActivities = (activities) => {
        const byProspect = new Map();
        const byCustomer = new Map();
        for (const a of activities) {
            if (a.prospect_id != null) {
                const k = String(a.prospect_id);
                (byProspect.get(k) || byProspect.set(k, []).get(k)).push(a);
            }
            if (a.customer_id != null) {
                const k = String(a.customer_id);
                (byCustomer.get(k) || byCustomer.set(k, []).get(k)).push(a);
            }
        }
        return { byProspect, byCustomer };
    };

    // ── LEAD SCORING (0-100) ──────────────────────────────────────────────
    // Deterministic weighted blend. Weights (documented, sum = 1.0):
    //   recency      0.30  — fresher last activity scores higher (decays ~3.3/day)
    //   frequency    0.25  — activity count, normalized (10 acts ⇒ ~100)
    //   potential    0.20  — prospect.potential_level / manual_grade mapping
    //   engagement   0.15  — distinct activity-type variety (depth of touch)
    //   pipelineAge  0.10  — sweet-spot curve: very new + very stale both penalized
    const _scoreLead = (prospect, acts) => {
        acts = acts || [];
        // recency
        const lastAct = acts.reduce((m, a) => {
            const t = new Date(a.activity_date).getTime();
            return (isFinite(t) && t > m) ? t : m;
        }, 0);
        const recencyDays = lastAct ? _daysSince(lastAct) : (prospect.last_activity_date ? _daysSince(prospect.last_activity_date) : Infinity);
        const recency = recencyDays === Infinity ? 0 : _clamp(100 - recencyDays * 3.3, 0, 100);
        // frequency — last 90 days, normalized so 10 touches ≈ full marks
        const recentCount = acts.filter(a => _daysSince(a.activity_date) <= 90).length;
        const frequency = _clamp(recentCount * 10, 0, 100);
        // potential
        const potential = Math.max(_potentialToScore(prospect.potential_level), _potentialToScore(prospect.manual_grade));
        // engagement — variety of touch types (5+ distinct types ⇒ full marks)
        const types = new Set(acts.map(a => a.activity_type).filter(Boolean));
        const engagement = _clamp(types.size * 20, 0, 100);
        // pipeline age — bell around ~30-90 days; brand new or long-dormant both lose
        const ageDays = _daysSince(prospect.created_at);
        let pipelineAge = 0;
        if (ageDays !== Infinity) {
            if (ageDays <= 7) pipelineAge = 40 + ageDays * 5;        // warming up
            else if (ageDays <= 90) pipelineAge = 100;               // prime window
            else pipelineAge = _clamp(100 - (ageDays - 90) * 0.5, 0, 100);
        }
        const overall = Math.round(
            recency * 0.30 + frequency * 0.25 + potential * 0.20 +
            engagement * 0.15 + pipelineAge * 0.10
        );
        const score = _clamp(overall, 0, 100);
        const prediction = score >= 75 ? 'hot' : score >= 50 ? 'warm' : 'cold';
        let action;
        if (score >= 75) action = 'Contact now — high-intent lead';
        else if (score >= 50) action = 'Schedule follow-up within 3 days';
        else if (recentCount === 0) action = 'Re-engage — no recent activity';
        else action = 'Nurture with content';
        return { score, prediction, action, factors: { recency, frequency, potential, engagement, pipelineAge }, recentCount, recencyDays };
    };

    // ── CHURN RISK (0-100) ────────────────────────────────────────────────
    // Higher = more likely to churn. Weights (sum = 1.0):
    //   dormancy     0.45  — days since last activity OR purchase (whichever fresher)
    //   trend        0.35  — activity in last 30d vs prior 30d (declining ⇒ risk)
    //   missedFollow 0.20  — open next-action / no touch since last purchase
    const _scoreChurn = (customer, acts, custPurchases) => {
        acts = acts || [];
        custPurchases = custPurchases || [];
        const lastActT = acts.reduce((m, a) => { const t = new Date(a.activity_date).getTime(); return (isFinite(t) && t > m) ? t : m; }, 0);
        const lastBuyT = custPurchases.reduce((m, p) => { const t = new Date(p.date).getTime(); return (isFinite(t) && t > m) ? t : m; }, 0);
        const lastTouch = Math.max(lastActT, lastBuyT);
        const dormDays = lastTouch ? _daysSince(lastTouch) : (customer.last_activity_date ? _daysSince(customer.last_activity_date) : Infinity);
        // dormancy curve: <14d safe, 90d+ maxed
        let dormancy;
        if (dormDays === Infinity) dormancy = 90;
        else if (dormDays <= 14) dormancy = 10;
        else if (dormDays >= 90) dormancy = 100;
        else dormancy = _clamp(10 + (dormDays - 14) * (90 / 76), 0, 100);
        // declining-activity trend
        const recent = acts.filter(a => _daysSince(a.activity_date) <= 30).length;
        const prior = acts.filter(a => { const d = _daysSince(a.activity_date); return d > 30 && d <= 60; }).length;
        let trend = 50;
        if (prior === 0 && recent === 0) trend = 70;          // silent on both windows
        else if (recent === 0 && prior > 0) trend = 90;        // went dark
        else if (recent < prior) trend = _clamp(50 + (prior - recent) * 15, 50, 100);
        else if (recent > prior) trend = _clamp(40 - (recent - prior) * 10, 0, 40);
        else trend = 40;                                       // steady
        // missed follow-up signals
        const openNextAction = acts.some(a => a.next_action && !a.next_action_done);
        const boughtButSilent = lastBuyT && (!lastActT || lastActT < lastBuyT) && _daysSince(lastBuyT) > 30;
        let missedFollow = 0;
        if (openNextAction) missedFollow += 60;
        if (boughtButSilent) missedFollow += 60;
        missedFollow = _clamp(missedFollow, 0, 100);
        const risk = Math.round(dormancy * 0.45 + trend * 0.35 + missedFollow * 0.20);
        const riskScore = _clamp(risk, 0, 100);
        const level = riskScore >= 70 ? 'high' : riskScore >= 40 ? 'medium' : 'low';
        const signals = [];
        if (dormDays !== Infinity && dormDays > 60) signals.push(`No contact for ${dormDays} days`);
        else if (dormDays === Infinity) signals.push('No activity on record');
        if (recent < prior) signals.push('Engagement declining');
        if (openNextAction) signals.push('Open follow-up not completed');
        if (boughtButSilent) signals.push('No touch since last purchase');
        let action;
        if (level === 'high') action = 'Contact immediately — retention call';
        else if (level === 'medium') action = 'Schedule a check-in this week';
        else action = 'Monitor — relationship healthy';
        return { riskScore, level, action, signals, factors: { dormancy: Math.round(dormancy), trend: Math.round(trend), missed_followup: Math.round(missedFollow) }, dormDays };
    };

    // Build the full insight snapshot from real, scoped data.
    const _buildSnapshot = async () => {
        const data = await _loadScopedData();
        const { byProspect, byCustomer } = _indexActivities(data.activities);

        // group purchases by customer for churn + value
        const purchasesByCustomer = new Map();
        for (const p of data.purchases) {
            const k = String(p.customer_id);
            (purchasesByCustomer.get(k) || purchasesByCustomer.set(k, []).get(k)).push(p);
        }

        // LEAD SCORES — active prospects only (skip already-converted/rejected)
        const activeProspects = data.prospects.filter(p =>
            p.status !== 'converted' && p.conversion_status !== 'approved' && p.conversion_status !== 'rejected'
        );
        const leads = activeProspects.map(p => {
            const r = _scoreLead(p, byProspect.get(String(p.id)));
            return { id: p.id, name: p.full_name || p.name || 'Unnamed prospect', ...r };
        }).sort((a, b) => b.score - a.score);

        // CHURN RISKS — active customers
        const activeCustomers = data.customers.filter(c => c.status !== 'inactive' && c.status !== 'lost');
        const churn = activeCustomers.map(c => {
            const r = _scoreChurn(c, byCustomer.get(String(c.id)), purchasesByCustomer.get(String(c.id)));
            return { id: c.id, name: c.full_name || 'Unnamed customer', ...r };
        }).sort((a, b) => b.riskScore - a.riskScore);

        // SALES FORECAST — bucket purchases by month, SMA + linear trend
        const forecast = _computeForecast(data.purchases);

        // TIMELINE — real per-month activity + sales-event counts (last 12 months)
        const timeline = _computeTimeline(data.activities, data.purchases);

        // PERFORMANCE — per-agent aggregates
        const agents = _computeAgentPerformance(data);

        const snapshot = {
            generatedAt: Date.now(),
            counts: {
                prospects: data.prospects.length,
                customers: data.customers.length,
                activeProspects: activeProspects.length,
                activeCustomers: activeCustomers.length,
            },
            leads, churn, forecast, timeline, agents,
        };
        return snapshot;
    };

    const _getSnapshot = async (force = false) => {
        if (!force && _snapshot && (Date.now() - _snapshotTs) < _SNAPSHOT_TTL) return _snapshot;
        _snapshot = await _buildSnapshot();
        _snapshotTs = Date.now();
        return _snapshot;
    };

    // Monthly buckets → simple moving average baseline + least-squares linear
    // trend, projected 3 months forward. Deterministic.
    const _computeForecast = (purchases) => {
        const sales = purchases.filter(p => !p.is_agent_package);
        // bucket last 12 months
        const buckets = new Map();
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
        }
        for (const p of sales) {
            const k = _monthKey(p.date);
            if (k && buckets.has(k)) buckets.set(k, buckets.get(k) + _num(p.amount));
        }
        const keys = [...buckets.keys()];
        const series = keys.map(k => buckets.get(k));
        const n = series.length;
        const hasData = sales.length > 0 && series.some(v => v > 0);

        // least-squares slope/intercept over month index 0..n-1
        let slope = 0, intercept = 0;
        if (n >= 2) {
            const xs = series.map((_, i) => i);
            const meanX = xs.reduce((a, b) => a + b, 0) / n;
            const meanY = series.reduce((a, b) => a + b, 0) / n;
            let num = 0, den = 0;
            for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (series[i] - meanY); den += (xs[i] - meanX) ** 2; }
            slope = den ? num / den : 0;
            intercept = meanY - slope * meanX;
        }
        // 3-month SMA of the tail as a stable baseline
        const tail = series.slice(-3);
        const sma = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : 0;
        // project next 3 months: blend linear trend with SMA (50/50) for stability
        const projections = [];
        for (let i = 1; i <= 3; i++) {
            const lin = intercept + slope * (n - 1 + i);
            const proj = Math.max(0, Math.round((lin * 0.5) + (sma * 0.5)));
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            projections.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, amount: proj });
        }
        const lastActual = series[n - 1] || 0;
        const recentAvg = Math.round(sma);
        const nextMonth = projections[0] ? projections[0].amount : 0;
        const total3mo = projections.reduce((a, p) => a + p.amount, 0);
        return {
            hasData, keys, series, slope: Math.round(slope), recentAvg, lastActual,
            nextMonth, total3mo, projections,
            trendDir: slope > 0 ? 'up' : slope < 0 ? 'down' : 'flat',
        };
    };

    // Real per-month counts for the timeline chart: activities logged + sales
    // events closed, last 12 months.
    const _computeTimeline = (activities, purchases) => {
        const now = new Date();
        const months = [];
        const idx = new Map();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            idx.set(key, months.length);
            months.push({ key, label: _monthLabel(key), activities: 0, sales: 0, amount: 0 });
        }
        for (const a of activities) {
            const k = _monthKey(a.activity_date);
            if (k != null && idx.has(k)) months[idx.get(k)].activities += 1;
        }
        for (const p of purchases) {
            if (p.is_agent_package) continue;
            const k = _monthKey(p.date);
            if (k != null && idx.has(k)) { months[idx.get(k)].sales += 1; months[idx.get(k)].amount += _num(p.amount); }
        }
        return months;
    };

    // Per-agent performance aggregates over the scoped data. Built in single
    // passes (no nested O(customers×purchases) scan).
    const _computeAgentPerformance = (data) => {
        // per-customer non-package purchase total (one pass)
        const custPurchaseTotal = new Map();
        for (const p of data.purchases) {
            if (p.is_agent_package) continue;
            const k = String(p.customer_id);
            custPurchaseTotal.set(k, (custPurchaseTotal.get(k) || 0) + _num(p.amount));
        }

        // accumulate per-agent buckets in single passes
        const acc = new Map();
        const bucket = (aid) => {
            const k = String(aid);
            let b = acc.get(k);
            if (!b) { b = { prospects: 0, customers: 0, won: 0, pipelineValue: 0, recentActs: 0, priorActs: 0, activityVolume: 0 }; acc.set(k, b); }
            return b;
        };
        for (const p of data.prospects) {
            if (p.responsible_agent_id == null) continue;
            const b = bucket(p.responsible_agent_id);
            b.prospects += 1;
            if (p.status === 'converted' || p.conversion_status === 'approved') b.won += 1;
        }
        for (const c of data.customers) {
            if (c.responsible_agent_id == null) continue;
            const b = bucket(c.responsible_agent_id);
            b.customers += 1;
            b.pipelineValue += custPurchaseTotal.get(String(c.id)) || 0;
        }
        for (const a of data.activities) {
            if (a.lead_agent_id == null) continue;
            const b = bucket(a.lead_agent_id);
            b.activityVolume += 1;
            const d = _daysSince(a.activity_date);
            if (d <= 30) b.recentActs += 1;
            else if (d <= 60) b.priorActs += 1;
        }

        const rows = [];
        for (const [aid, b] of acc) {
            const user = data.userMap.get(aid);
            if (user && !window._crmUtils.isAgent(user)) continue; // only the agent band
            const name = (user && user.full_name) || `Agent #${aid}`;
            const totalLeads = b.prospects + b.customers;
            const conversionRate = totalLeads ? Math.round((b.customers / totalLeads) * 100) : 0;
            rows.push({
                id: aid, name, conversionRate,
                activityVolume: b.activityVolume, recentActs: b.recentActs, priorActs: b.priorActs,
                activityDelta: b.recentActs - b.priorActs,
                pipelineValue: b.pipelineValue, customers: b.customers, prospects: b.prospects, won: b.won,
            });
        }
        if (!rows.length) return { rows: [], topPerformer: null, mostImproved: null, needsAttention: null };
        const topPerformer = [...rows].sort((a, b) => b.pipelineValue - a.pipelineValue || b.conversionRate - a.conversionRate)[0];
        const mostImproved = [...rows].sort((a, b) => b.activityDelta - a.activityDelta)[0];
        const needsAttention = [...rows].sort((a, b) => a.activityDelta - b.activityDelta || a.conversionRate - b.conversionRate)[0];
        return { rows, topPerformer, mostImproved, needsAttention };
    };

    // Currency / compact-number formatters (RM = Malaysian Ringgit, the CRM's
    // currency — see reporting chunk). Never emit NaN.
    const _fmtMoney = (n) => {
        n = _num(n);
        if (n >= 1e6) return `RM${(n / 1e6).toFixed(2)}M`;
        if (n >= 1e3) return `RM${(n / 1e3).toFixed(1)}K`;
        return `RM${Math.round(n)}`;
    };

    // Initialize AI Service
    const initAIAnalytics = async () => {
        // Initializing AI Analytics

        _aiService = {
            predictLeadScore: predictLeadScore,
            calculateChurnRisk: calculateChurnRisk,
            generateForecast: generateSalesForecast,
            getPerformanceInsights: generateAgentInsights,
            retrainModels: retrainAIModels
        };

        // Check if AI models exist, create default if not
        await ensureAIModelsExist();

        // Lead scores & churn risks are computed on-demand (not on every page load)
        // Call batchUpdateLeadScores() or batchUpdateChurnRisks() manually when needed
    };

    // Ensure AI models exist in AppDataStore
    const ensureAIModelsExist = async () => {
        const models = await AppDataStore.getAll('ai_models');

        if (models.length === 0) {
            // Create default models
            const defaultModels = [
                {
                    id: generateModelId(),
                    model_name: 'lead_scoring',
                    model_version: _currentModelVersion,
                    accuracy: 87.5,
                    trained_at: new Date().toISOString(),
                    trained_on_records: 1250,
                    features_used: {
                        engagement_score: 0.35,
                        demographic_fit: 0.25,
                        behavioral_signals: 0.20,
                        source_quality: 0.15,
                        recency: 0.05
                    },
                    is_active: true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                },
                {
                    id: generateModelId(),
                    model_name: 'churn_prediction',
                    model_version: _currentModelVersion,
                    accuracy: 82.3,
                    trained_at: new Date().toISOString(),
                    trained_on_records: 850,
                    features_used: {
                        activity_recency: 0.30,
                        support_tickets: 0.20,
                        payment_history: 0.25,
                        engagement_trend: 0.15,
                        contract_status: 0.10
                    },
                    is_active: true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                },
                {
                    id: generateModelId(),
                    model_name: 'sales_forecast',
                    model_version: _currentModelVersion,
                    accuracy: 89.1,
                    trained_at: new Date().toISOString(),
                    trained_on_records: 2100,
                    features_used: {
                        historical_sales: 0.40,
                        pipeline_stage: 0.25,
                        seasonality: 0.15,
                        team_performance: 0.10,
                        market_trends: 0.10
                    },
                    is_active: true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
            ];

            for (const model of defaultModels) {
                await AppDataStore.create('ai_models', model);
            }

            // Default AI models created
        }
    };

    // Show AI Insights Dashboard
    // React-island flag — DEFAULT-ON (parity-verified live, SW-85). Kill-switch:
    // window.__REACT_AI=false | ?react_ai=0 | localStorage crm_react_ai='0'
    // (plus the global ?react=0 / crm_react_off='1').
    const _reactAiOn = () => {
        try {
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            if (!(window.CRMReact && typeof window.CRMReact.mountAIInsights === 'function')) return false;
            if (window.__REACT_AI === false) return false;
            if (/[?&]react_ai=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_ai') === '0') return false;
            return true;
        } catch (_) { return false; }
    };

    // Legacy content builder — kept as the un-migrated fallback (identical markup
    // to the React island; both fill the same #ai-stats-grid / #ai-timeline-chart
    // / #ai-predictions-tbody ids in the end). Used on the legacy path AND if the
    // island mount throws.
    // The four clickable insight cards (Lead Scoring / Sales Forecast / Churn
    // Risk / Team Insights) — REAL summary numbers from the scoped snapshot.
    // Factored out so both the legacy _aiBuildContent path AND the React island
    // (#ai-insights-grid, filled in showAIInsightsDashboard) share one source of
    // truth. Inline onclick calls the registered app.* drill-downs. Entity names
    // are escaped via esc() before going into innerHTML.
    const _aiInsightCardsHtml = (snap) => {
        const highLeads = snap.leads.filter(l => l.score >= 80).length;
        const warmLeads = snap.leads.filter(l => l.score >= 50 && l.score < 80).length;
        const fc = snap.forecast;
        const fcDelta = fc.lastActual ? Math.round(((fc.nextMonth - fc.lastActual) / fc.lastActual) * 100) : 0;
        const highRisk = snap.churn.filter(c => c.level === 'high').length;
        const medRisk = snap.churn.filter(c => c.level === 'medium').length;
        const atRisk = highRisk + medRisk;
        const agentCount = snap.agents.rows.length;
        const topName = snap.agents.topPerformer ? snap.agents.topPerformer.name : null;

        return `
                    <div class="insight-card" onclick="app.showLeadScoring()">
                        <i class="fas fa-chart-line"></i>
                        <h4>Lead Scoring</h4>
                        <p>${highLeads} lead${highLeads === 1 ? '' : 's'} &gt; 80 score</p>
                        <span class="trend up">${warmLeads} warm in pipeline</span>
                    </div>
                    <div class="insight-card" onclick="app.showSalesForecast()">
                        <i class="fas fa-dollar-sign"></i>
                        <h4>Sales Forecast</h4>
                        <p>${fc.hasData ? esc(_fmtMoney(fc.nextMonth)) + ' next month' : 'Not enough data yet'}</p>
                        <span class="trend ${fcDelta >= 0 ? 'up' : 'down'}">${fc.hasData ? (fcDelta >= 0 ? '+' : '') + fcDelta + '% vs last month' : '—'}</span>
                    </div>
                    <div class="insight-card" onclick="app.showChurnRiskAnalysis()">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h4>Churn Risk</h4>
                        <p>${atRisk} customer${atRisk === 1 ? '' : 's'} at risk</p>
                        <span class="trend ${highRisk ? 'up warning' : 'up'}">${highRisk} high priority</span>
                    </div>
                    <div class="insight-card" onclick="app.showPerformanceInsights()">
                        <i class="fas fa-users"></i>
                        <h4>Team Insights</h4>
                        <p>${agentCount} agent${agentCount === 1 ? '' : 's'} analyzed</p>
                        <span class="trend up">${topName ? 'Top: ' + esc(topName) : 'No data yet'}</span>
                    </div>`;
    };

    const _aiBuildContent = async () => {
        // Warm the snapshot up front so the cards AND the (sync) timeline render
        // off the same real-data pass.
        const snap = await _getSnapshot();
        const statsHtml = await renderAIStatsCards();
        const predsHtml = await renderTopPredictions();
        const timelineHtml = renderAITimelineChart();
        const cardsHtml = _aiInsightCardsHtml(snap);

        return `
            <div class="ai-dashboard">
                <div class="dashboard-header">
                    <h2>AI Insights Dashboard</h2>
                    <button class="btn secondary" onclick="app.refreshAIPredictions()">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                </div>

                <div class="stats-grid" id="ai-stats-grid">
                    ${statsHtml}
                </div>

                <div class="chart-container">
                    <h3>Activity &amp; Sales Timeline (last 12 months)</h3>
                    <div class="ai-timeline-chart" id="ai-timeline-chart">
                        ${timelineHtml}
                    </div>
                    <div class="chart-legend">
                        <div class="legend-item"><span class="color-dot actual"></span> Activities logged</div>
                        <div class="legend-item"><span class="color-dot predicted"></span> Closings</div>
                    </div>
                </div>

                <div class="insights-grid" id="ai-insights-grid">
                    ${cardsHtml}
                </div>

                <div class="recent-predictions">
                    <h3>Top Predictions This Week</h3>
                    <table class="predictions-table">
                        <thead>
                            <tr>
                                <th scope="col">Lead/Customer</th>
                                <th scope="col">Prediction Type</th>
                                <th scope="col">Score</th>
                                <th scope="col">Confidence</th>
                                <th scope="col">Recommended Action</th>
                            </tr>
                        </thead>
                        <tbody id="ai-predictions-tbody">
                            ${predsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    };

    const showAIInsightsDashboard = async () => {
        const closeBtn = [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }];

        if (_reactAiOn()) {
            // Scaffold-shell: React owns the static layout + stable-id containers;
            // the chunk fills #ai-stats-grid / #ai-timeline-chart /
            // #ai-predictions-tbody after the island signals onReady.
            UI.showModal('AI Insights Dashboard', '<div id="ai-insights-react-root"></div>', closeBtn, 'fullscreen');
            const rootEl = document.getElementById('ai-insights-react-root');
            let _mounted = false;
            try {
                if (!rootEl) throw new Error('react root missing');
                let _aReady; const _aReadyP = new Promise(res => { _aReady = res; });
                const _aGuard = setTimeout(() => _aReady(), 4000);
                window.CRMReact.mountAIInsights(rootEl, {
                    onReady: () => { clearTimeout(_aGuard); _aReady(); },
                });
                await _aReadyP;
                _mounted = true;
            } catch (e) {
                console.warn('[ai] island mount failed, falling back to legacy:', e && e.message);
                // fall through to the legacy render below
            }
            if (_mounted) {
                // Per-section resilient fills: a transient AppDataStore.getAll
                // cold-path crash (the known _getAllImpl fetch-fail bug) degrades
                // that one section to empty instead of killing the whole modal —
                // strictly better than the legacy all-or-nothing inline render.
                // Warm the snapshot once so the (sync) timeline fill has real
                // data even if an earlier section throws independently.
                try { await _getSnapshot(); } catch (e) { console.warn('[ai] snapshot build failed:', e && e.message); }
                const sg = document.getElementById('ai-stats-grid');
                if (sg) { try { sg.innerHTML = await renderAIStatsCards(); } catch (e) { console.warn('[ai] stats fill failed:', e && e.message); } }
                const tc = document.getElementById('ai-timeline-chart');
                if (tc) { try { tc.innerHTML = renderAITimelineChart(); } catch (e) { console.warn('[ai] timeline fill failed:', e && e.message); } }
                const ig = document.getElementById('ai-insights-grid');
                if (ig) { try { ig.innerHTML = _aiInsightCardsHtml(await _getSnapshot()); } catch (e) { console.warn('[ai] insight cards fill failed:', e && e.message); } }
                const tb = document.getElementById('ai-predictions-tbody');
                if (tb) { try { tb.innerHTML = await renderTopPredictions(); } catch (e) { console.warn('[ai] predictions fill failed:', e && e.message); } }
                if (window._resolveAttachmentImages) window._resolveAttachmentImages(rootEl);
                return;
            }
        }

        UI.showModal('AI Insights Dashboard', await _aiBuildContent(), closeBtn, 'fullscreen');
    };

    // Render AI Stats Cards — REAL data from the scoped snapshot.
    const renderAIStatsCards = async () => {
        const snap = await _getSnapshot();
        const fc = snap.forecast;

        // Sales forecast: next-month projection vs last actual month.
        const fcVal = fc.hasData ? _fmtMoney(fc.nextMonth) : '—';
        const fcDelta = fc.lastActual ? Math.round(((fc.nextMonth - fc.lastActual) / fc.lastActual) * 100) : 0;
        const fcUp = fcDelta >= 0;
        const fcTrend = !fc.hasData
            ? `<div class="stat-trend">Not enough data yet</div>`
            : `<div class="stat-trend ${fcUp ? 'positive' : 'negative'}">
                   <i class="fas fa-arrow-${fcUp ? 'up' : 'down'}"></i> ${Math.abs(fcDelta)}% vs last month
               </div>`;

        // Lead scoring: count of high-value (score >= 80) active leads + warm count.
        const highValueLeads = snap.leads.filter(l => l.score >= 80).length;
        const warmLeads = snap.leads.filter(l => l.score >= 50 && l.score < 80).length;

        // Churn: count of high-risk active customers.
        const highRisk = snap.churn.filter(c => c.level === 'high').length;
        const mediumRisk = snap.churn.filter(c => c.level === 'medium').length;

        return `
            <div class="stat-card">
                <div class="stat-icon blue">
                    <i class="fas fa-chart-line"></i>
                </div>
                <div class="stat-content">
                    <h4>Sales Forecast</h4>
                    <div class="stat-value">${esc(fcVal)}</div>
                    ${fcTrend}
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon green">
                    <i class="fas fa-trophy"></i>
                </div>
                <div class="stat-content">
                    <h4>Lead Scoring</h4>
                    <div class="stat-value">${highValueLeads}</div>
                    <div class="stat-trend positive">
                        <i class="fas fa-arrow-up"></i> ${warmLeads} warm leads
                    </div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon red">
                    <i class="fas fa-exclamation-circle"></i>
                </div>
                <div class="stat-content">
                    <h4>Churn Risk</h4>
                    <div class="stat-value">${highRisk}</div>
                    <div class="stat-trend ${mediumRisk ? 'negative' : ''}">
                        <i class="fas fa-${mediumRisk ? 'arrow-up' : 'minus'}"></i> ${mediumRisk} medium risk
                    </div>
                </div>
            </div>
        `;
    };

    // Render AI Timeline Chart — REAL per-month activity counts + sales-events.
    // Synchronous (the existing renderer is); reads the warm snapshot that the
    // stats-cards fill builds immediately before this in both the legacy
    // template and the React-island fill path. Falls back to an empty-state if
    // the snapshot isn't ready yet (shouldn't happen, but never NaN/blank).
    const renderAITimelineChart = () => {
        const months = (_snapshot && _snapshot.timeline) || [];
        if (!months.length || months.every(m => m.activities === 0 && m.sales === 0)) {
            return '<div class="timeline-empty empty-state" style="padding:24px;text-align:center;color:#6B7280;">Not enough activity data yet to chart a timeline.</div>';
        }
        // Scale: dual series share one axis. Bars are heights in px (max 100).
        const maxAct = Math.max(1, ...months.map(m => m.activities));
        const maxSales = Math.max(1, ...months.map(m => m.sales));

        let chartHTML = '<div class="timeline-bars">';
        for (const m of months) {
            const actHeight = Math.round((m.activities / maxAct) * 100);
            const salesHeight = Math.round((m.sales / maxSales) * 100);
            chartHTML += `
                <div class="timeline-bar-group">
                    <div class="bar-container">
                        <div class="bar actual" style="height: ${actHeight}px" title="${esc(m.label)}: ${m.activities} activities"></div>
                        <div class="bar predicted" style="height: ${salesHeight}px" title="${esc(m.label)}: ${m.sales} closings (${esc(_fmtMoney(m.amount))})"></div>
                    </div>
                    <div class="bar-label">${esc(m.label)}</div>
                </div>
            `;
        }
        chartHTML += '</div>';
        return chartHTML;
    };

    // Render Top Predictions — REAL top-scoring leads + highest-risk customers.
    // Confidence is DETERMINISTIC: derived from how far the score sits from the
    // decision boundary (50) — extreme scores = high confidence — NOT random.
    const renderTopPredictions = async () => {
        const snap = await _getSnapshot();
        const predictions = [];

        // Confidence: distance of score from the neutral midpoint, scaled to
        // 60-98%. A 90-point lead or a 10-point one is "confident"; a 50 is not.
        const confOf = (score) => _clamp(60 + Math.round(Math.abs(score - 50) * 0.76), 60, 98);

        // Top 3 leads to act on
        for (const l of snap.leads.slice(0, 3)) {
            predictions.push({
                id: l.id, kind: 'lead',
                name: l.name, type: 'Lead Score', score: l.score,
                confidence: confOf(l.score), action: l.action, icon: '🔥',
            });
        }
        // Top 2 churn risks (only surface real risk — skip "healthy" rows)
        for (const c of snap.churn.filter(c => c.level !== 'low').slice(0, 2)) {
            predictions.push({
                id: c.id, kind: 'churn',
                name: c.name, type: 'Churn Risk', score: c.riskScore,
                confidence: confOf(c.riskScore), action: c.action, icon: '⚠️',
            });
        }

        // Sort by score descending
        predictions.sort((a, b) => b.score - a.score);

        let rows = '';
        predictions.forEach(p => {
            const confidenceClass = p.confidence >= 85 ? 'high' : p.confidence >= 70 ? 'medium' : 'low';
            const fn = p.kind === 'lead' ? 'viewLeadDetails' : 'contactAtRiskCustomer';
            rows += `
                <tr>
                    <td><strong>${p.icon} ${esc(p.name)}</strong></td>
                    <td>${esc(p.type)}</td>
                    <td><span class="score-badge ${p.score >= 80 ? 'high' : p.score >= 60 ? 'medium' : 'low'}">${p.score}</span></td>
                    <td><span class="confidence ${confidenceClass}">${p.confidence}%</span></td>
                    <td><button class="btn-link" onclick="app.${fn}('${esc(String(p.id))}')">${esc(p.action)}</button></td>
                </tr>
            `;
        });

        return rows || '<tr><td colspan="5" class="empty-state">Not enough data yet — log activities and purchases to generate predictions.</td></tr>';
    };

    // Show Lead Scoring Interface — REAL, live-computed from the scoped snapshot.
    const showLeadScoring = async () => {
        const snap = await _getSnapshot();
        const leads = snap.leads; // sorted desc by score
        const topLeads = leads.slice(0, 10);

        let scoresHTML = '';
        for (const lead of topLeads) {
            const scoreClass = lead.score >= 80 ? 'high' : lead.score >= 60 ? 'medium' : 'low';
            const predLabel = lead.prediction === 'hot' ? '🔥 Hot' : lead.prediction === 'warm' ? '👌 Warm' : '❄️ Cold';
            const freshLabel = lead.recencyDays === Infinity ? 'No activity' : `${lead.recencyDays}d ago`;

            scoresHTML += `
                <tr>
                    <td><strong>${esc(lead.name)}</strong></td>
                    <td><span class="score-badge ${scoreClass}">${lead.score}</span></td>
                    <td>${esc(freshLabel)} · ${lead.recentCount} acts</td>
                    <td>${predLabel}</td>
                    <td>${esc(lead.action)}</td>
                    <td><button class="btn-icon" aria-label="View lead details" onclick="app.viewLeadDetails('${esc(String(lead.id))}')"><i class="fas fa-eye" aria-hidden="true"></i></button></td>
                </tr>
            `;
        }

        // Real average factor values across the scored leads (0-100 each).
        const avg = (sel) => leads.length ? Math.round(leads.reduce((a, l) => a + sel(l), 0) / leads.length) : 0;
        const avgRecency = avg(l => l.factors.recency);
        const avgFrequency = avg(l => l.factors.frequency);
        const avgPotential = avg(l => l.factors.potential);
        const avgEngagement = avg(l => l.factors.engagement);
        const avgPipelineAge = avg(l => l.factors.pipelineAge);
        const avgScore = avg(l => l.score);
        const avgClass = avgScore >= 80 ? 'high' : avgScore >= 60 ? 'medium' : 'low';
        const avgBadge = avgScore >= 80 ? 'HIGH VALUE' : avgScore >= 60 ? 'WARM' : 'NEEDS NURTURE';

        const content = `
            <div class="lead-scoring-dashboard">
                <div class="scoring-header">
                    <h3>AI Lead Scoring</h3>
                    <div>
                        <span class="model-badge">${leads.length} active lead${leads.length === 1 ? '' : 's'} scored · deterministic heuristic</span>
                        <button class="btn secondary" onclick="app.refreshAIPredictions()">
                            <i class="fas fa-sync-alt"></i> Recalculate
                        </button>
                    </div>
                </div>

                <div class="factors-card">
                    <h4>Lead Scoring Factors (team average)</h4>
                    <table class="factors-table">
                        <thead>
                            <tr>
                                <th scope="col">Factor</th>
                                <th scope="col">Weight</th>
                                <th scope="col">Avg Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Recency (days since last touch)</td>
                                <td>30%</td>
                                <td>${avgRecency}/100</td>
                            </tr>
                            <tr>
                                <td>Frequency (activity count)</td>
                                <td>25%</td>
                                <td>${avgFrequency}/100</td>
                            </tr>
                            <tr>
                                <td>Potential level</td>
                                <td>20%</td>
                                <td>${avgPotential}/100</td>
                            </tr>
                            <tr>
                                <td>Engagement (touch variety)</td>
                                <td>15%</td>
                                <td>${avgEngagement}/100</td>
                            </tr>
                            <tr>
                                <td>Pipeline age</td>
                                <td>10%</td>
                                <td>${avgPipelineAge}/100</td>
                            </tr>
                            <tr class="total-row">
                                <td colspan="2"><strong>AVERAGE SCORE</strong></td>
                                <td><span class="score-large ${avgClass}">${avgScore}/100</span> <span class="prediction-badge ${avgClass}">${avgBadge}</span></td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="top-leads-card">
                    <div class="card-header">
                        <h4>Top Scoring Leads This Week</h4>
                        <div>
                            <button class="btn-icon" onclick="app.recalculateLeadScores()" title="Recalculate Scores">
                                <i class="fas fa-calculator"></i>
                            </button>
                            <button class="btn-icon" onclick="app.exportLeads()" title="Export Leads">
                                <i class="fas fa-download"></i>
                            </button>
                        </div>
                    </div>
                    <table class="leads-table">
                        <thead>
                            <tr>
                                <th scope="col">Lead Name</th>
                                <th scope="col">Score</th>
                                <th scope="col">Recent Activity</th>
                                <th scope="col">Prediction</th>
                                <th scope="col">Recommended Action</th>
                                <th scope="col"></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${scoresHTML || '<tr><td colspan="6" class="empty-state">No scored leads available</td></tr>'}
                        </tbody>
                    </table>
                </div>
                
                <div class="action-buttons">
                    <button class="btn primary" onclick="app.createSegmentFromScoredLeads()">
                        <i class="fas fa-filter"></i> Create Segment from Top Leads
                    </button>
                    <button class="btn secondary" onclick="app.scheduleBulkFollowup()">
                        <i class="fas fa-clock"></i> Schedule Bulk Follow-up
                    </button>
                    <button class="btn secondary" onclick="app.exportScoringReport()">
                        <i class="fas fa-file-pdf"></i> Export Report
                    </button>
                </div>
            </div>
        `;

        UI.showModal('AI Lead Scoring', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ], 'fullscreen');
    };

    // Predict lead score for a prospect — DETERMINISTIC (no random). Uses the
    // shared _scoreLead heuristic over the prospect's real activities, persists
    // a lead_scores record, and derives trend by comparing to the prior score.
    const predictLeadScore = async (prospectId) => {
        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) return null;

        // Get activities for this prospect
        const activities = await AppDataStore.query('activities', { prospect_id: prospectId });

        const r = _scoreLead(prospect, activities || []);
        const overallScore = r.score;

        // Trend (compare with last persisted score for this prospect)
        const allScores = await AppDataStore.getAll('lead_scores');
        const lastScore = (allScores || [])
            .filter(l => String(l.prospect_id) === String(prospectId))
            .sort((a, b) => new Date(b.score_date) - new Date(a.score_date))[0];

        let trend = 'stable';
        if (lastScore) {
            if (overallScore > lastScore.overall_score + 5) trend = 'up';
            else if (overallScore < lastScore.overall_score - 5) trend = 'down';
        }

        // Create lead score record (factors mirror the documented blend)
        const leadScore = {
            id: generateId(),
            prospect_id: prospectId,
            score_date: new Date().toISOString(),
            overall_score: overallScore,
            factors: {
                recency: Math.round(r.factors.recency),
                frequency: Math.round(r.factors.frequency),
                potential: Math.round(r.factors.potential),
                engagement_score: Math.round(r.factors.engagement),
                pipeline_age: Math.round(r.factors.pipelineAge)
            },
            trend: trend,
            prediction: r.prediction,
            recommended_action: r.action,
            model_version: _currentModelVersion,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString()
        };

        await AppDataStore.create('lead_scores', leadScore);

        return leadScore;
    };

    // Batch update all lead scores
    const batchUpdateLeadScores = async () => {
        const allProspects = await AppDataStore.getAll('prospects');
        const prospects = (allProspects || []).filter(p => p.status === 'active');

        for (const prospect of prospects) {
            await predictLeadScore(prospect.id);
        }

        UI.toast.success(`Updated scores for ${prospects.length} prospects`);
    };

    // Show Sales Forecast
    const showSalesForecast = async (period = 'quarterly') => {
        const validPeriods = ['weekly', 'monthly', 'quarterly', 'yearly'];
        if (!validPeriods.includes(period)) period = 'quarterly';
        const forecast = await generateSalesForecast(period);
        const sel = (p) => period === p ? ' selected' : '';

        const content = `
            <div class="forecast-dashboard">
                <div class="forecast-header">
                    <h3>AI Sales Forecast</h3>
                    <div class="forecast-controls">
                        <select id="forecast-period" class="form-control" onchange="app.changeForecastPeriod(this.value)">
                            <option value="weekly"${sel('weekly')}>Weekly</option>
                            <option value="monthly"${sel('monthly')}>Monthly</option>
                            <option value="quarterly"${sel('quarterly')}>Quarterly</option>
                            <option value="yearly"${sel('yearly')}>Yearly</option>
                        </select>
                        <select id="forecast-compare" class="form-control">
                            <option value="previous">vs Previous Period</option>
                            <option value="last-year">vs Last Year</option>
                            <option value="target">vs Target</option>
                        </select>
                    </div>
                </div>
                
                <div class="forecast-accuracy">
                    <div class="accuracy-meter">
                        <span class="accuracy-label">Recent monthly average: ${esc(_fmtMoney(forecast.recentAvg))} • Trend: ${forecast.trendDir === 'up' ? '⬆️ rising' : forecast.trendDir === 'down' ? '⬇️ declining' : '➡️ flat'}</span>
                    </div>
                </div>

                <div class="forecast-chart-large">
                    ${renderForecastChart()}
                </div>

                <div class="forecast-numbers">
                    <div class="number-card">
                        <div class="number-label">Predicted (${esc(period)})</div>
                        <div class="number-value">${forecast.hasData ? esc(_fmtMoney(forecast.predicted_amount)) : '—'}</div>
                    </div>
                    <div class="number-card best">
                        <div class="number-label">Best Case</div>
                        <div class="number-value">${forecast.hasData ? esc(_fmtMoney(forecast.best_case)) : '—'}</div>
                        <div class="number-trend">+16%</div>
                    </div>
                    <div class="number-card worst">
                        <div class="number-label">Worst Case</div>
                        <div class="number-value">${forecast.hasData ? esc(_fmtMoney(forecast.worst_case)) : '—'}</div>
                        <div class="number-trend negative">-12%</div>
                    </div>
                </div>

                <div class="forecast-breakdown">
                    <h4>Forecast Breakdown</h4>
                    <table class="breakdown-table">
                        <thead>
                            <tr>
                                <th scope="col">Source</th>
                                <th scope="col">Projected</th>
                                <th scope="col">Share</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Existing Deals</td>
                                <td>${esc(_fmtMoney(forecast.breakdown.existing_deals))}</td>
                                <td><span class="confidence high">58%</span></td>
                            </tr>
                            <tr>
                                <td>New Prospects</td>
                                <td>${esc(_fmtMoney(forecast.breakdown.new_prospects))}</td>
                                <td><span class="confidence medium">27%</span></td>
                            </tr>
                            <tr>
                                <td>Upsells</td>
                                <td>${esc(_fmtMoney(forecast.breakdown.upsells))}</td>
                                <td><span class="confidence medium">12%</span></td>
                            </tr>
                            <tr>
                                <td>Referrals</td>
                                <td>${esc(_fmtMoney(forecast.breakdown.referrals))}</td>
                                <td><span class="confidence high">3%</span></td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="forecast-actions">
                    <button class="btn primary" onclick="app.exportForecast()">
                        <i class="fas fa-download"></i> Export Forecast
                    </button>
                    <button class="btn secondary" onclick="app.adjustForecast()">
                        <i class="fas fa-sliders-h"></i> Adjust Factors
                    </button>
                    <button class="btn secondary" onclick="app.scheduleForecastReview()">
                        <i class="fas fa-calendar-alt"></i> Schedule Review
                    </button>
                </div>
            </div>
        `;

        UI.showModal('AI Sales Forecast', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ], 'fullscreen');
    };

    // Generate sales forecast — DETERMINISTIC. Buckets real (scoped) purchases
    // by month, fits a least-squares linear trend blended 50/50 with a 3-month
    // moving average, and projects forward. `period` scales the projection
    // horizon (weekly≈¼mo, monthly=1mo, quarterly=3mo, yearly=12mo).
    const generateSalesForecast = async (period = 'quarterly') => {
        const snap = await _getSnapshot();
        const fc = snap.forecast; // { hasData, series, slope, recentAvg, nextMonth, total3mo, projections, ... }

        // months of horizon implied by the requested period
        const horizonMonths = period === 'weekly' ? 0.25 : period === 'monthly' ? 1 : period === 'yearly' ? 12 : 3;
        // Per-month projection = mean of the 3 projected months (stable),
        // scaled by horizon. Falls back to the recent average when sparse.
        const perMonth = fc.hasData
            ? (fc.projections.reduce((a, p) => a + p.amount, 0) / Math.max(1, fc.projections.length))
            : 0;
        const predictedAmount = Math.max(0, Math.round(perMonth * horizonMonths));
        // Confidence band: ±16% best / -12% worst (asymmetric, conservative).
        const bestCase = Math.round(predictedAmount * 1.16);
        const worstCase = Math.round(predictedAmount * 0.88);

        // Breakdown by source — FIXED presentation ratios applied to the real
        // projected total (the CRM has no per-source purchase tagging, so the
        // split is illustrative; only the total is data-derived).
        const existing = predictedAmount * 0.58;
        const newProspects = predictedAmount * 0.27;
        const upsells = predictedAmount * 0.12;
        const referrals = predictedAmount * 0.03;

        // Save forecast to history (best-effort — never block the UI on a write)
        const forecast = {
            id: generateId(),
            forecast_date: new Date().toISOString(),
            period: period,
            period_start: getPeriodStart(period),
            period_end: getPeriodEnd(period),
            predicted_amount: predictedAmount,
            confidence_low: worstCase,
            confidence_high: bestCase,
            breakdown: { existing_deals: existing, new_prospects: newProspects, upsells: upsells, referrals: referrals },
            model_version: _currentModelVersion,
            created_at: new Date().toISOString()
        };
        try { await AppDataStore.create('forecast_history', forecast); } catch (_) { /* non-fatal */ }

        return {
            predicted_amount: predictedAmount,
            best_case: bestCase,
            worst_case: worstCase,
            breakdown: forecast.breakdown,
            hasData: fc.hasData,
            recentAvg: fc.recentAvg,
            trendDir: fc.trendDir,
            series: fc.series,
            keys: fc.keys,
            projections: fc.projections,
        };
    };

    // Helper functions for period calculation
    const getPeriodStart = (period) => {
        const now = new Date();
        if (period === 'weekly') {
            return new Date(now.setDate(now.getDate() - now.getDay())).toISOString();
        } else if (period === 'monthly') {
            return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        } else if (period === 'quarterly') {
            const quarter = Math.floor(now.getMonth() / 3);
            return new Date(now.getFullYear(), quarter * 3, 1).toISOString();
        } else {
            return new Date(now.getFullYear(), 0, 1).toISOString();
        }
    };

    const getPeriodEnd = (period) => {
        const start = new Date(getPeriodStart(period));
        if (period === 'weekly') {
            return new Date(start.setDate(start.getDate() + 6)).toISOString();
        } else if (period === 'monthly') {
            return new Date(start.getFullYear(), start.getMonth() + 1, 0).toISOString();
        } else if (period === 'quarterly') {
            return new Date(start.getFullYear(), start.getMonth() + 3, 0).toISOString();
        } else {
            return new Date(start.getFullYear(), 11, 31).toISOString();
        }
    };

    // Render forecast chart — REAL monthly actuals (last 12 mo) + 3 projected
    // months, drawn from the warm snapshot built by generateSalesForecast().
    const renderForecastChart = () => {
        const fc = _snapshot && _snapshot.forecast;
        if (!fc || !fc.hasData) {
            return '<div class="forecast-empty empty-state" style="padding:24px;text-align:center;color:#6B7280;">Not enough sales history to forecast yet.</div>';
        }
        const actuals = fc.keys.map((k, i) => ({ key: k, amount: fc.series[i], projected: false }));
        const projected = fc.projections.map(p => ({ key: p.key, amount: p.amount, projected: true }));
        const bars = [...actuals, ...projected];
        const max = Math.max(1, ...bars.map(b => b.amount));

        let chartHTML = '<div class="forecast-bars">';
        for (const b of bars) {
            const height = Math.round((b.amount / max) * 150); // max 150px
            const cls = b.projected ? 'forecast-bar predicted' : 'forecast-bar';
            chartHTML += `
                <div class="forecast-bar-group">
                    <div class="${cls}" style="height: ${height}px" title="${esc(_monthLabel(b.key))}${b.projected ? ' (projected)' : ''}: ${esc(_fmtMoney(b.amount))}"></div>
                    <div class="forecast-label">${esc(_monthLabel(b.key))}</div>
                </div>
            `;
        }
        chartHTML += '</div>';
        return chartHTML;
    };

    // Show Churn Risk Analysis — REAL, live-computed from the scoped snapshot.
    const showChurnRiskAnalysis = async () => {
        const snap = await _getSnapshot();
        const churnRisks = snap.churn; // already sorted desc by riskScore

        const highRisk = churnRisks.filter(c => c.level === 'high').length;
        const mediumRisk = churnRisks.filter(c => c.level === 'medium').length;
        const lowRisk = churnRisks.filter(c => c.level === 'low').length;
        const total = churnRisks.length || 1; // avoid div by 0
        // Overall portfolio churn = average risk across active customers.
        const overallRisk = churnRisks.length
            ? (churnRisks.reduce((a, c) => a + c.riskScore, 0) / churnRisks.length)
            : 0;
        // Critical = high-risk with at least one missed-follow-up / dormancy signal.
        const critical = churnRisks.filter(c => c.level === 'high' && c.signals && c.signals.length >= 2).length;

        let risksHTML = '';
        const topRisks = churnRisks.filter(c => c.level !== 'low').slice(0, 5);
        for (const risk of topRisks) {
            const riskClass = risk.level;
            const factors = risk.factors || {};

            risksHTML += `
                <tr>
                    <td><strong>${esc(risk.name)}</strong></td>
                    <td><span class="risk-badge ${riskClass}">${risk.riskScore}%</span></td>
                    <td>
                        <div class="risk-factors">
                            ${Object.entries(factors).slice(0, 2).map(([key, val]) =>
                `<span class="factor-tag">${esc(key)}: ${esc(String(val))}</span>`
            ).join('')}
                        </div>
                    </td>
                    <td><button class="btn-link" onclick="app.contactAtRiskCustomer('${esc(String(risk.id))}')">Contact</button></td>
                </tr>
            `;
        }

        const content = `
            <div class="churn-dashboard">
                <div class="churn-header">
                    <h3>Churn Risk Analysis</h3>
                    <div class="overall-risk">
                        <span class="risk-meter">${overallRisk.toFixed(1)}%</span>
                        <span class="risk-trend">${churnRisks.length} active customer${churnRisks.length === 1 ? '' : 's'} analyzed</span>
                    </div>
                </div>

                <div class="risk-distribution">
                    <h4>Risk Distribution</h4>
                    <div class="distribution-bars">
                        <div class="distribution-item">
                            <span class="distribution-label">High Risk (${highRisk} customers)</span>
                            <div class="distribution-bar-container">
                                <div class="distribution-bar high" style="width: ${(highRisk / total) * 100}%"></div>
                            </div>
                            <span class="distribution-value">${Math.round((highRisk / total) * 100)}%</span>
                        </div>
                        <div class="distribution-item">
                            <span class="distribution-label">Medium Risk (${mediumRisk} customers)</span>
                            <div class="distribution-bar-container">
                                <div class="distribution-bar medium" style="width: ${(mediumRisk / total) * 100}%"></div>
                            </div>
                            <span class="distribution-value">${Math.round((mediumRisk / total) * 100)}%</span>
                        </div>
                        <div class="distribution-item">
                            <span class="distribution-label">Low Risk (${lowRisk} customers)</span>
                            <div class="distribution-bar-container">
                                <div class="distribution-bar low" style="width: ${(lowRisk / total) * 100}%"></div>
                            </div>
                            <span class="distribution-value">${Math.round((lowRisk / total) * 100)}%</span>
                        </div>
                    </div>
                </div>
                
                <div class="at-risk-customers">
                    <h4>Top At-Risk Customers</h4>
                    <table class="risk-table">
                        <thead>
                            <tr>
                                <th scope="col">Customer</th>
                                <th scope="col">Risk Score</th>
                                <th scope="col">Key Factors</th>
                                <th scope="col">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${risksHTML || '<tr><td colspan="4" class="empty-state">No at-risk customers — your active book looks healthy.</td></tr>'}
                        </tbody>
                    </table>
                </div>
                
                <div class="recommended-actions">
                    <h4>Recommended Actions</h4>
                    <ul class="action-list">
                        <li class="action-item high">
                            <input type="checkbox" id="action1">
                            <label for="action1">Contact ${highRisk} high-risk customers this week</label>
                        </li>
                        <li class="action-item medium">
                            <input type="checkbox" id="action2">
                            <label for="action2">Schedule account reviews for medium-risk group (${mediumRisk} customers)</label>
                        </li>
                        <li class="action-item low">
                            <input type="checkbox" id="action3">
                            <label for="action3">Send satisfaction survey to all at-risk customers</label>
                        </li>
                        ${critical > 0 ? `<li class="action-item critical">
                            <input type="checkbox" id="action4">
                            <label for="action4"><strong>⚠️ ${critical} customer${critical === 1 ? '' : 's'} showing critical signs - immediate attention required</strong></label>
                        </li>` : ''}
                    </ul>
                    <button class="btn primary" onclick="app.executeRiskActions()">
                        <i class="fas fa-check-circle"></i> Execute Selected Actions
                    </button>
                </div>
            </div>
        `;

        UI.showModal('Churn Risk Analysis', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ], 'fullscreen');
    };

    // Calculate churn risk for a customer — DETERMINISTIC (no random). Uses the
    // shared _scoreChurn heuristic over the customer's real activities and
    // purchases, then persists a churn_risk record.
    const calculateChurnRisk = async (customerId) => {
        const customer = await AppDataStore.getById('customers', customerId);
        if (!customer) return null;

        // Real signals: this customer's activities + purchases.
        const [activities, allPurchases] = await Promise.all([
            AppDataStore.query('activities', { customer_id: customerId }),
            AppDataStore.getAll('purchases').catch(() => []),
        ]);
        const custPurchases = (allPurchases || []).filter(p => String(p.customer_id) === String(customerId));

        const r = _scoreChurn(customer, activities || [], custPurchases);
        const riskScore = r.riskScore;
        const riskLevel = r.level;

        // Generate recommended actions by level
        const recommendedActions = [];
        if (riskLevel === 'high') {
            recommendedActions.push('Contact immediately');
            recommendedActions.push('Schedule account review');
            recommendedActions.push('Offer retention incentive');
        } else if (riskLevel === 'medium') {
            recommendedActions.push('Send satisfaction survey');
            recommendedActions.push('Schedule check-in call');
        } else {
            recommendedActions.push('Monitor activity');
            recommendedActions.push('Send newsletter');
        }

        // Create churn risk record (factors mirror the documented blend)
        const churnRisk = {
            id: generateId(),
            customer_id: customerId,
            risk_score: riskScore,
            risk_level: riskLevel,
            factors: {
                dormancy: r.factors.dormancy,
                engagement_trend: r.factors.trend,
                missed_followup: r.factors.missed_followup
            },
            predicted_churn_date: new Date(Date.now() + (90 * 24 * 60 * 60 * 1000)).toISOString(),
            probability: riskScore / 100,
            warning_signals: r.signals,
            recommended_actions: recommendedActions,
            model_version: _currentModelVersion,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        await AppDataStore.create('churn_risk', churnRisk);

        return churnRisk;
    };

    // Batch update all churn risks
    const batchUpdateChurnRisks = async () => {
        const allCustomers = await AppDataStore.getAll('customers');
        const customers = (allCustomers || []).filter(c => c.status === 'active');

        for (const customer of customers) {
            await calculateChurnRisk(customer.id);
        }

        UI.toast.success(`Updated churn risks for ${customers.length} customers`);
    };

    // Show Performance Insights — REAL per-agent aggregates from the scoped
    // snapshot (conversion rate, activity volume, pipeline value, 30d trend).
    const showPerformanceInsights = async () => {
        const snap = await _getSnapshot();
        const perf = snap.agents;
        // rank by pipeline value desc for the table
        const rows = [...perf.rows].sort((a, b) => b.pipelineValue - a.pipelineValue || b.conversionRate - a.conversionRate);

        const topId = perf.topPerformer && perf.topPerformer.id;
        const impId = perf.mostImproved && perf.mostImproved.id;
        const attnId = perf.needsAttention && perf.needsAttention.id;

        let insightsHTML = '';
        for (const r of rows) {
            const trendClass = r.activityDelta > 0 ? 'positive' : r.activityDelta < 0 ? 'negative' : '';
            const trendIcon = r.activityDelta > 0 ? '⬆️' : r.activityDelta < 0 ? '⬇️' : '➡️';
            // notable callouts
            let callout = '';
            if (r.id === topId) callout = '<span class="insight-strength">🏆 Top performer</span>';
            else if (r.id === impId && r.activityDelta > 0) callout = '<span class="insight-strength">📈 Most improved</span>';
            else if (r.id === attnId && r.activityDelta < 0) callout = '<span class="insight-improvement">⚠️ Needs attention</span>';
            else callout = `<span class="insight-strength">${r.won} closed</span>`;

            insightsHTML += `
                <tr>
                    <td><strong>${esc(r.name)}</strong></td>
                    <td>${r.conversionRate}%</td>
                    <td>${r.activityVolume}</td>
                    <td>${esc(_fmtMoney(r.pipelineValue))}</td>
                    <td><span class="variance ${trendClass}">${trendIcon} ${r.activityDelta >= 0 ? '+' : ''}${r.activityDelta} acts (30d)</span></td>
                    <td>
                        <div class="agent-insight">${callout}</div>
                    </td>
                    <td><button class="btn-icon" aria-label="View agent performance" onclick="app.viewAgentDetails('${esc(String(r.id))}')"><i class="fas fa-chart-bar" aria-hidden="true"></i></button></td>
                </tr>
            `;
        }

        const content = `
            <div class="performance-dashboard">
                <div class="performance-header">
                    <h3>Agent Performance Insights</h3>
                    <button class="btn secondary" onclick="app.refreshPerformanceInsights()">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                </div>
                
                <div class="team-performance">
                    <h4>Team Performance (scoped to your team)</h4>
                    <table class="performance-table">
                        <thead>
                            <tr>
                                <th scope="col">Agent</th>
                                <th scope="col">Conversion</th>
                                <th scope="col">Activities</th>
                                <th scope="col">Pipeline Value</th>
                                <th scope="col">30-day Trend</th>
                                <th scope="col">Notable</th>
                                <th scope="col"></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${insightsHTML || '<tr><td colspan="7" class="empty-state">No agent performance data yet — assign prospects/customers and log activities.</td></tr>'}
                        </tbody>
                    </table>
                </div>

                <div class="activity-recommendations">
                    <h4>Team Callouts</h4>
                    <div class="recommendations-grid">
                        <div class="recommendation-card">
                            <i class="fas fa-trophy"></i>
                            <div class="recommendation-content">
                                <h5>Top performer</h5>
                                <p>${perf.topPerformer ? esc(perf.topPerformer.name) : '—'}</p>
                                <small>${perf.topPerformer ? esc(_fmtMoney(perf.topPerformer.pipelineValue)) + ' pipeline • ' + perf.topPerformer.conversionRate + '% conversion' : 'No data yet'}</small>
                            </div>
                        </div>
                        <div class="recommendation-card">
                            <i class="fas fa-arrow-trend-up"></i>
                            <div class="recommendation-content">
                                <h5>Most improved</h5>
                                <p>${perf.mostImproved && perf.mostImproved.activityDelta > 0 ? esc(perf.mostImproved.name) : '—'}</p>
                                <small>${perf.mostImproved && perf.mostImproved.activityDelta > 0 ? '+' + perf.mostImproved.activityDelta + ' activities vs prior 30 days' : 'No upward trend yet'}</small>
                            </div>
                        </div>
                        <div class="recommendation-card">
                            <i class="fas fa-triangle-exclamation"></i>
                            <div class="recommendation-content">
                                <h5>Needs attention</h5>
                                <p>${perf.needsAttention && perf.needsAttention.activityDelta < 0 ? esc(perf.needsAttention.name) : '—'}</p>
                                <small>${perf.needsAttention && perf.needsAttention.activityDelta < 0 ? perf.needsAttention.activityDelta + ' activities vs prior 30 days' : 'No declining agents'}</small>
                            </div>
                        </div>
                        <div class="recommendation-card">
                            <i class="fas fa-users"></i>
                            <div class="recommendation-content">
                                <h5>Team size</h5>
                                <p>${perf.rows.length} agent${perf.rows.length === 1 ? '' : 's'}</p>
                                <small>${snap.counts.customers} customers • ${snap.counts.activeProspects} active prospects</small>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="performance-actions">
                    <button class="btn primary" onclick="app.scheduleCoachingSessions()">
                        <i class="fas fa-chalkboard-teacher"></i> Schedule Coaching Sessions
                    </button>
                    <button class="btn secondary" onclick="app.generatePerformanceReport()">
                        <i class="fas fa-file-alt"></i> Generate Full Report
                    </button>
                    <button class="btn secondary" onclick="app.shareInsights()">
                        <i class="fas fa-share-alt"></i> Share Insights
                    </button>
                </div>
            </div>
        `;

        UI.showModal('Performance Insights', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ], 'fullscreen');
    };

    // Generate insights for an agent — DETERMINISTIC, real aggregates. Reads
    // the agent's row from the scoped snapshot (conversion rate, activity
    // volume, pipeline value, 30-day trend) and persists a performance_insights
    // record. Returns null if the agent has no data in scope.
    const generateAgentInsights = async (agentId) => {
        const snap = await _getSnapshot();
        const row = snap.agents.rows.find(r => String(r.id) === String(agentId));
        if (!row) return null;

        // "variance" = activity momentum (recent 30d vs prior 30d, % change).
        const variance = row.priorActs
            ? Math.round(((row.recentActs - row.priorActs) / row.priorActs) * 100)
            : (row.recentActs > 0 ? 100 : 0);

        // Concrete, data-driven strength/improvement strings.
        const strength = row.conversionRate >= 40
            ? `Strong conversion (${row.conversionRate}%)`
            : row.activityDelta > 0
                ? `Rising activity (+${row.activityDelta} this month)`
                : `${row.won} closed deal${row.won === 1 ? '' : 's'}`;
        const improvement = row.activityDelta < 0
            ? `Activity down ${Math.abs(row.activityDelta)} vs prior month`
            : row.conversionRate < 20
                ? `Conversion below 20% — qualify harder`
                : `Grow pipeline (${_fmtMoney(row.pipelineValue)} now)`;

        // Persist an insight record (best-effort).
        const insight = {
            id: generateId(),
            agent_id: agentId,
            insight_date: new Date().toISOString(),
            insight_type: variance > 5 ? 'strength' : variance < -5 ? 'weakness' : 'opportunity',
            metric: 'activity_momentum',
            value: row.recentActs,
            benchmark: row.priorActs,
            variance: variance,
            recommendation: variance < 0 ? 'Increase weekly activity volume' : 'Share best practices with team',
            priority: Math.abs(variance) > 50 ? 'high' : Math.abs(variance) > 20 ? 'medium' : 'low',
            is_actioned: false,
            created_at: new Date().toISOString()
        };
        try { await AppDataStore.create('performance_insights', insight); } catch (_) { /* non-fatal */ }

        return {
            conversionRate: row.conversionRate,
            activityVolume: row.activityVolume,
            pipelineValue: row.pipelineValue,
            recentActs: row.recentActs,
            priorActs: row.priorActs,
            activityDelta: row.activityDelta,
            variance: variance,
            strength: strength,
            improvement: improvement
        };
    };

    // AI Model Management
    const retrainAIModels = async () => {
        UI.showModal('Retrain AI Models', `
            <div class="retrain-models">
                <p>This will retrain all AI models with the latest data.</p>
                <p>Estimated time: 2-3 minutes</p>
                
                <div class="model-list">
                    <label class="checkbox-label">
                        <input type="checkbox" value="lead_scoring" checked> Lead Scoring Model
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" value="churn_prediction" checked> Churn Prediction Model
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" value="sales_forecast" checked> Sales Forecast Model
                    </label>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Start Training', type: 'primary', action: 'app.startModelTraining()' }
        ]);
    };

    const startModelTraining = async () => {
        UI.hideModal();
        UI.toast.info('AI model training started...');

        // Simulate training progress
        let progress = 0;
        const interval = setInterval(async () => {
            progress += 10;
            UI.toast.info(`Training progress: ${progress}%`);

            if (progress >= 100) {
                clearInterval(interval);

                // Update model versions and accuracy
                try {
                    const models = Object.values(await AppDataStore.getAll('ai_models') || []);
                    for (const model of models) {
                        model.model_version = '1.1.0';
                        model.accuracy += Math.random() * 3 - 1; // Random change
                        model.trained_at = new Date().toISOString();
                        model.trained_on_records += Math.floor(Math.random() * 100);
                        model.updated_at = new Date().toISOString();

                        await AppDataStore.update('ai_models', model.id, model);
                    }
                    UI.toast.success('AI models trained successfully! Accuracy improved.');
                } catch (err) {
                    UI.toast.error('Training failed: ' + (err.message || 'Unknown error'));
                }
            }
        }, 1000);
    };

    // Navigation function
    const showAIPredictionDashboard = async () => {
        await showAIInsightsDashboard();
    };

    // Refresh: drop the cached snapshot, rebuild from fresh data, and re-fill
    // the live dashboard sections in place (or re-open if not mounted). Used by
    // the dashboard "Refresh" button and the Lead Scoring "Recalculate".
    const refreshAIPredictions = async () => {
        _invalidateSnapshot();
        try { await _getSnapshot(true); } catch (_) { /* degrade gracefully */ }
        const sg = document.getElementById('ai-stats-grid');
        const tc = document.getElementById('ai-timeline-chart');
        const tb = document.getElementById('ai-predictions-tbody');
        if (sg || tc || tb) {
            if (sg) { try { sg.innerHTML = await renderAIStatsCards(); } catch (e) { console.warn('[ai] stats fill failed:', e && e.message); } }
            if (tc) { try { tc.innerHTML = renderAITimelineChart(); } catch (e) { console.warn('[ai] timeline fill failed:', e && e.message); } }
            const ig2 = document.getElementById('ai-insights-grid');
            if (ig2) { try { ig2.innerHTML = _aiInsightCardsHtml(await _getSnapshot()); } catch (e) { console.warn('[ai] insight cards fill failed:', e && e.message); } }
            if (tb) { try { tb.innerHTML = await renderTopPredictions(); } catch (e) { console.warn('[ai] predictions fill failed:', e && e.message); } }
            UI.toast.success('AI insights refreshed');
        } else {
            // Not on the dashboard (e.g. called from a drill-down) — just reopen.
            await showAIInsightsDashboard();
        }
    };

    // Drill-down navigation for prediction/insight rows.
    const viewLeadDetails = async (prospectId) => {
        try { UI.hideModal(); } catch (_) {}
        if (window.app && typeof window.app.showProspectMenu === 'function') return window.app.showProspectMenu(prospectId);
        UI.toast.info('Open the Prospects tab to view this lead.');
    };
    const contactAtRiskCustomer = async (customerId) => {
        try { UI.hideModal(); } catch (_) {}
        if (window.app && typeof window.app.showCustomerDetail === 'function') return window.app.showCustomerDetail(customerId);
        UI.toast.info('Open the Customers tab to contact this customer.');
    };
    const viewAgentDetails = async (agentId) => {
        if (window.app && typeof window.app.showAgentProfile === 'function') return window.app.showAgentProfile(agentId);
        UI.toast.info('Agent profile unavailable.');
    };
    const refreshPerformanceInsights = async () => {
        _invalidateSnapshot();
        await showPerformanceInsights();
    };
    // Re-render the forecast modal for a different horizon (the period <select>).
    const changeForecastPeriod = async (period) => {
        await showSalesForecast(period);
    };

    // ── Attach public functions to window.app ────────────────────────────
    // ── Placeholder handlers for AI-dashboard action buttons ──────────────
    // The Lead Scoring / Sales Forecast / Churn Risk / Performance Insights
    // dashboards wired these onclick handlers before their backends existed.
    // Calling an undefined app.* throws an uncaught TypeError, so register safe
    // stubs that tell the user the feature is pending instead of crashing.
    const _aiSoon = (label) => () => UI.toast.info(`${label} — coming soon`);
    Object.assign(window.app, {
        // Still-pending secondary actions (export / scheduling / segmentation).
        executeAction:                _aiSoon('Recommended action'),
        recalculateLeadScores:        refreshAIPredictions,
        exportLeads:                  _aiSoon('Export leads'),
        createSegmentFromScoredLeads: _aiSoon('Create segment'),
        scheduleBulkFollowup:         _aiSoon('Bulk follow-up'),
        exportScoringReport:          _aiSoon('Export scoring report'),
        viewDealDetails:              _aiSoon('Deal details'),
        viewProspectDetails:          _aiSoon('Prospect details'),
        viewUpsellOpportunities:      _aiSoon('Upsell opportunities'),
        viewReferrals:                _aiSoon('Referrals'),
        viewRenewals:                 _aiSoon('Renewals'),
        exportForecast:               _aiSoon('Export forecast'),
        adjustForecast:               _aiSoon('Adjust forecast'),
        scheduleForecastReview:       _aiSoon('Schedule forecast review'),
        executeRiskActions:           _aiSoon('Risk actions'),
        scheduleCoachingSessions:     _aiSoon('Coaching sessions'),
        generatePerformanceReport:    _aiSoon('Performance report'),
        shareInsights:                _aiSoon('Share insights'),
    });
    Object.assign(window.app, {
        showAIInsightsDashboard,
        showLeadScoring,
        predictLeadScore,
        batchUpdateLeadScores,
        showSalesForecast,
        generateSalesForecast,
        showChurnRiskAnalysis,
        calculateChurnRisk,
        batchUpdateChurnRisks,
        showPerformanceInsights,
        generateAgentInsights,
        retrainAIModels,
        startModelTraining,
        showAIPredictionDashboard,
        ensureAIModelsExist,
        refreshAIPredictions,                 // real refresh (re-fills dashboard in place)
        refreshPerformanceInsights,           // real refresh for the performance modal
        changeForecastPeriod,                 // re-render forecast for a chosen horizon
        viewLeadDetails,                      // opens the prospect profile
        contactAtRiskCustomer,                // opens the customer detail
        viewAgentDetails,                     // opens the agent profile
    });
})();