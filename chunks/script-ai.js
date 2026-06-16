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
    let _aiService = null;
    let _currentModelVersion = '1.0.0';

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
    const _aiBuildContent = async () => `
            <div class="ai-dashboard">
                <div class="dashboard-header">
                    <h2>AI Insights Dashboard</h2>
                    <button class="btn secondary" onclick="app.refreshAIPredictions()">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                </div>

                <div class="stats-grid" id="ai-stats-grid">
                    ${await renderAIStatsCards()}
                </div>

                <div class="chart-container">
                    <h3>AI Predictions Timeline</h3>
                    <div class="ai-timeline-chart" id="ai-timeline-chart">
                        ${renderAITimelineChart()}
                    </div>
                    <div class="chart-legend">
                        <div class="legend-item"><span class="color-dot actual"></span> Actual</div>
                        <div class="legend-item"><span class="color-dot predicted"></span> Predicted</div>
                        <div class="legend-item"><span class="color-dot target"></span> Target</div>
                        <div class="legend-item"><span class="color-dot confidence"></span> Confidence: 85%</div>
                    </div>
                </div>

                <div class="insights-grid">
                    <div class="insight-card" onclick="app.showLeadScoring()">
                        <i class="fas fa-chart-line"></i>
                        <h4>Lead Scoring</h4>
                        <p>156 leads> 80 score</p>
                        <span class="trend up">+34 this week</span>
                    </div>
                    <div class="insight-card" onclick="app.showSalesForecast()">
                        <i class="fas fa-dollar-sign"></i>
                        <h4>Sales Forecast</h4>
                        <p>$2.4M next 30 days</p>
                        <span class="trend down">-12% vs last month</span>
                    </div>
                    <div class="insight-card" onclick="app.showChurnRiskAnalysis()">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h4>Churn Risk</h4>
                        <p>23 customers at risk</p>
                        <span class="trend up warning">+15% increase</span>
                    </div>
                    <div class="insight-card" onclick="app.showPerformanceInsights()">
                        <i class="fas fa-users"></i>
                        <h4>Team Insights</h4>
                        <p>8 recommendations</p>
                        <span class="trend up">3 high priority</span>
                    </div>
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
                            ${await renderTopPredictions()}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

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
                const sg = document.getElementById('ai-stats-grid');
                if (sg) { try { sg.innerHTML = await renderAIStatsCards(); } catch (e) { console.warn('[ai] stats fill failed:', e && e.message); } }
                const tc = document.getElementById('ai-timeline-chart');
                if (tc) { try { tc.innerHTML = renderAITimelineChart(); } catch (e) { console.warn('[ai] timeline fill failed:', e && e.message); } }
                const tb = document.getElementById('ai-predictions-tbody');
                if (tb) { try { tb.innerHTML = await renderTopPredictions(); } catch (e) { console.warn('[ai] predictions fill failed:', e && e.message); } }
                if (window._resolveAttachmentImages) window._resolveAttachmentImages(rootEl);
                return;
            }
        }

        UI.showModal('AI Insights Dashboard', await _aiBuildContent(), closeBtn, 'fullscreen');
    };

    // Render AI Stats Cards
    const renderAIStatsCards = async () => {
        // Get forecast data
        const forecasts = (await AppDataStore.getAll('forecast_history'))
            .filter(f => new Date(f.forecast_date) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
            .sort((a, b) => new Date(b.forecast_date) - new Date(a.forecast_date));

        const latestForecast = forecasts[0] || { predicted_amount: 2400000 };

        // Get lead scores
        const leadScores = (await AppDataStore.getAll('lead_scores'))
            .filter(l => new Date(l.score_date) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

        const highValueLeads = leadScores.filter(l => l.overall_score >= 80).length;
        const newHighValueLeads = leadScores.filter(l =>
            l.overall_score >= 80 &&
            new Date(l.score_date) > new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
        ).length;

        // Get churn risks
        const churnRisks = (await AppDataStore.getAll('churn_risk'))
            .filter(c => c.risk_level === 'high');

        return `
            <div class="stat-card">
                <div class="stat-icon blue">
                    <i class="fas fa-chart-line"></i>
                </div>
                <div class="stat-content">
                    <h4>Sales Forecast</h4>
                    <div class="stat-value">$${(latestForecast.predicted_amount / 1000000).toFixed(1)}M</div>
                    <div class="stat-trend negative">
                        <i class="fas fa-arrow-down"></i> 12% vs last month
                    </div>
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
                        <i class="fas fa-arrow-up"></i> ${newHighValueLeads} new this week
                    </div>
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon red">
                    <i class="fas fa-exclamation-circle"></i>
                </div>
                <div class="stat-content">
                    <h4>Churn Risk</h4>
                    <div class="stat-value">${churnRisks.length}</div>
                    <div class="stat-trend negative">
                        <i class="fas fa-arrow-up"></i> 15% increase
                    </div>
                </div>
            </div>
        `;
    };

    // Render AI Timeline Chart
    const renderAITimelineChart = () => {
        // Generate mock data for the chart
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const actualData = [1.2, 1.5, 1.4, 1.8, 1.9, 2.1, 2.0, 2.2, 2.3, 2.1, 2.4, 2.6];
        const predictedData = [1.3, 1.6, 1.5, 1.9, 2.0, 2.2, 2.1, 2.3, 2.4, 2.2, 2.5, 2.8];
        const targetData = [1.5, 1.7, 1.7, 2.0, 2.1, 2.3, 2.3, 2.5, 2.6, 2.5, 2.7, 3.0];

        let chartHTML = '<div class="timeline-bars">';

        for (let i = 0; i < months.length; i++) {
            const actualHeight = (actualData[i] / 3) * 100;
            const predictedHeight = (predictedData[i] / 3) * 100;
            const targetHeight = (targetData[i] / 3) * 100;

            chartHTML += `
                <div class="timeline-bar-group">
                    <div class="bar-container">
                        <div class="bar actual" style="height: ${actualHeight}px" title="Actual: $${actualData[i]}M"></div>
                        <div class="bar predicted" style="height: ${predictedHeight}px" title="Predicted: $${predictedData[i]}M"></div>
                        <div class="bar target" style="height: ${targetHeight}px" title="Target: $${targetData[i]}M"></div>
                    </div>
                    <div class="bar-label">${months[i]}</div>
                </div>
            `;
        }

        chartHTML += '</div>';

        return chartHTML;
    };

    // Render Top Predictions
    const renderTopPredictions = async () => {
        // Combine lead scores and churn risks for display
        const predictions = [];

        // Pre-load all data in parallel
        const [allLeadScores, allChurnRisks, allProspectsAI, allCustomersAI] = await Promise.all([
            AppDataStore.getAll('lead_scores'),
            AppDataStore.getAll('churn_risk'),
            AppDataStore.getAll('prospects'),
            AppDataStore.getAll('customers'),
        ]);
        const prospectMapAI = new Map((allProspectsAI || []).map(p => [String(p.id), p]));
        const customerMapAI = new Map((allCustomersAI || []).map(c => [String(c.id), c]));

        // Add top lead scores
        const leadScores = (allLeadScores || [])
            .filter(l => l.prospect_id)
            .sort((a, b) => b.overall_score - a.overall_score)
            .slice(0, 3);

        for (const score of leadScores) {
            const prospect = prospectMapAI.get(String(score.prospect_id));
            if (prospect) {
                predictions.push({
                    name: prospect.full_name,
                    type: 'Lead Score',
                    score: score.overall_score,
                    confidence: 85 + Math.floor(Math.random() * 10),
                    action: score.recommended_action || 'Contact now',
                    icon: '🔥'
                });
            }
        }

        // Add top churn risks
        const churnRisks = (allChurnRisks || [])
            .sort((a, b) => b.risk_score - a.risk_score)
            .slice(0, 2);

        for (const risk of churnRisks) {
            const customer = customerMapAI.get(String(risk.customer_id));
            if (customer) {
                predictions.push({
                    name: customer.full_name,
                    type: 'Churn Risk',
                    score: risk.risk_score,
                    confidence: 78 + Math.floor(Math.random() * 15),
                    action: risk.recommended_actions?.[0] || 'Contact immediately',
                    icon: '⚠️'
                });
            }
        }

        // Sort by score descending
        predictions.sort((a, b) => b.score - a.score);

        let rows = '';
        predictions.forEach(p => {
            const confidenceClass = p.confidence >= 85 ? 'high' : p.confidence >= 70 ? 'medium' : 'low';

            rows += `
                <tr>
                    <td><strong>${p.icon} ${window._crmUtils.escapeHtml(p.name)}</strong></td>
                    <td>${window._crmUtils.escapeHtml(p.type)}</td>
                    <td><span class="score-badge ${p.score >= 80 ? 'high' : p.score >= 60 ? 'medium' : 'low'}">${p.score}</span></td>
                    <td><span class="confidence ${confidenceClass}">${p.confidence}%</span></td>
                    <td><button class="btn-link" onclick="app.executeAction('${window._crmUtils.escapeHtml(p.action)}')">${window._crmUtils.escapeHtml(p.action)}</button></td>
                </tr>
            `;
        });

        return rows || '<tr><td colspan="5" class="empty-state">No predictions available</td></tr>';
    };

    // Show Lead Scoring Interface
    const showLeadScoring = async () => {
        // Get active model
        const allModels = await AppDataStore.getAll('ai_models');
        const model = (allModels || []).find(m => m.model_name === 'lead_scoring' && m.is_active);

        // Get recent lead scores — pre-load prospects in parallel
        const [allLeadScoresLS, allProspectsLS] = await Promise.all([
            AppDataStore.getAll('lead_scores'),
            AppDataStore.getAll('prospects'),
        ]);
        const prospectMapLS = new Map((allProspectsLS || []).map(p => [String(p.id), p]));
        const leadScores = (allLeadScoresLS || [])
            .filter(l => l.prospect_id)
            .sort((a, b) => new Date(b.score_date) - new Date(a.score_date))
            .slice(0, 10);

        let scoresHTML = '';
        for (const score of leadScores) {
            const prospect = prospectMapLS.get(String(score.prospect_id));
            if (!prospect) continue;

            const trendIcon = score.trend === 'up' ? '⬆️' : score.trend === 'down' ? '⬇️' : '➡️';
            const scoreClass = score.overall_score >= 80 ? 'high' : score.overall_score >= 60 ? 'medium' : 'low';

            scoresHTML += `
                <tr>
                    <td><strong>${prospect.full_name}</strong></td>
                    <td><span class="score-badge ${scoreClass}">${score.overall_score}</span></td>
                    <td>${trendIcon} ${score.trend === 'up' ? '+' + (score.factors?.engagement_score || 0) : ''}</td>
                    <td>${score.prediction === 'hot' ? '🔥 Hot' : score.prediction === 'warm' ? '👌 Warm' : '❄️ Cold'}</td>
                    <td>${score.recommended_action || 'Contact'}</td>
                    <td><button class="btn-icon" aria-label="View lead details" onclick="app.viewLeadDetails(${prospect.id})"><i class="fas fa-eye" aria-hidden="true"></i></button></td>
                </tr>
            `;
        }

        const content = `
            <div class="lead-scoring-dashboard">
                <div class="scoring-header">
                    <h3>AI Lead Scoring</h3>
                    <div>
                        <span class="model-badge">Model v${model?.model_version || '1.0'} • Accuracy: ${model?.accuracy || 87.5}%</span>
                        <button class="btn secondary" onclick="app.retrainAIModels()">
                            <i class="fas fa-sync-alt"></i> Retrain
                        </button>
                    </div>
                </div>
                
                <div class="factors-card">
                    <h4>Lead Scoring Factors</h4>
                    <table class="factors-table">
                        <thead>
                            <tr>
                                <th scope="col">Factor</th>
                                <th scope="col">Weight</th>
                                <th scope="col">Current Value</th>
                                <th scope="col">Impact</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Engagement Score</td>
                                <td>35%</td>
                                <td>82/100</td>
                                <td><span class="trend up">⬆️ +12</span></td>
                            </tr>
                            <tr>
                                <td>Demographic Fit</td>
                                <td>25%</td>
                                <td>90/100</td>
                                <td><span class="trend up">⬆️ +8</span></td>
                            </tr>
                            <tr>
                                <td>Behavioral Signals</td>
                                <td>20%</td>
                                <td>65/100</td>
                                <td><span class="trend down">⬇️ -5</span></td>
                            </tr>
                            <tr>
                                <td>Source Quality</td>
                                <td>15%</td>
                                <td>95/100</td>
                                <td><span class="trend up">⬆️ +10</span></td>
                            </tr>
                            <tr>
                                <td>Recency</td>
                                <td>5%</td>
                                <td>40/100</td>
                                <td><span class="trend down">⬇️ -3</span></td>
                            </tr>
                            <tr class="total-row">
                                <td colspan="2"><strong>TOTAL SCORE</strong></td>
                                <td><span class="score-large">82/100</span></td>
                                <td><span class="prediction-badge high">HIGH VALUE</span></td>
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
                                <th scope="col">Trend</th>
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

    // Predict lead score for a prospect
    const predictLeadScore = async (prospectId) => {
        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) return null;

        // Get activities for this prospect
        const activities = await AppDataStore.query('activities', { prospect_id: prospectId });

        // Calculate engagement score (0-100)
        const recentActivities = activities.filter(a =>
            new Date(a.activity_date) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        ).length;

        const emailOpens = activities.filter(a => a.activity_type === 'EMAIL_OPEN').length;
        const whatsappReplies = activities.filter(a => a.activity_type === 'WHATSAPP_REPLY').length;

        const engagementScore = Math.min(100, Math.floor(
            (recentActivities * 5) +
            (emailOpens * 10) +
            (whatsappReplies * 15)
        ));

        // Calculate demographic fit (mock - would use real demographic data)
        const demographicFit = 70 + Math.floor(Math.random() * 30);

        // Calculate behavioral signals
        const timeOnSite = Math.floor(Math.random() * 100);
        const pageViews = Math.floor(Math.random() * 50);
        const behavioralScore = Math.min(100, Math.floor((timeOnSite + pageViews) / 1.5));

        // Source quality based on referral source
        let sourceQuality = 50;
        if (prospect.source === 'referral') sourceQuality = 95;
        else if (prospect.source === 'website') sourceQuality = 70;
        else if (prospect.source === 'event') sourceQuality = 80;
        else if (prospect.source === 'social') sourceQuality = 60;

        // Recency score
        const lastActivity = activities.sort((a, b) =>
            new Date(b.activity_date) - new Date(a.activity_date)
        )[0];

        let recencyScore = 0;
        if (lastActivity) {
            const daysSince = Math.floor((Date.now() - new Date(lastActivity.activity_date).getTime()) / (24 * 60 * 60 * 1000));
            recencyScore = Math.max(0, 100 - (daysSince * 5));
        }

        // Calculate weighted score
        const overallScore = Math.floor(
            (engagementScore * 0.35) +
            (demographicFit * 0.25) +
            (behavioralScore * 0.20) +
            (sourceQuality * 0.15) +
            (recencyScore * 0.05)
        );

        // Determine async trend (compare with last score)
        const allScores = await AppDataStore.getAll('lead_scores');
        const lastScore = allScores
            .filter(l => l.prospect_id === prospectId)
            .sort((a, b) => new Date(b.score_date) - new Date(a.score_date))[0];

        let trend = 'stable';
        if (lastScore) {
            if (overallScore > lastScore.overall_score + 5) trend = 'up';
            else if (overallScore < lastScore.overall_score - 5) trend = 'down';
        }

        // Determine prediction
        let prediction = 'cold';
        let recommendedAction = 'Nurture with content';

        if (overallScore >= 80) {
            prediction = 'hot';
            recommendedAction = 'Contact immediately - high priority';
        } else if (overallScore >= 60) {
            prediction = 'warm';
            recommendedAction = 'Schedule follow-up within 3 days';
        } else if (overallScore >= 40) {
            recommendedAction = 'Send nurturing sequence';
        }

        // Create lead score record
        const leadScore = {
            id: generateId(),
            prospect_id: prospectId,
            score_date: new Date().toISOString(),
            overall_score: overallScore,
            factors: {
                engagement_score: engagementScore,
                demographic_fit: demographicFit,
                behavioral_signals: behavioralScore,
                source_quality: sourceQuality,
                recency: recencyScore
            },
            trend: trend,
            prediction: prediction,
            recommended_action: recommendedAction,
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
    const showSalesForecast = async () => {
        const forecast = await generateSalesForecast('quarterly');

        const content = `
            <div class="forecast-dashboard">
                <div class="forecast-header">
                    <h3>AI Sales Forecast</h3>
                    <div class="forecast-controls">
                        <select id="forecast-period" class="form-control" onchange="app.changeForecastPeriod(this.value)">
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="quarterly" selected>Quarterly</option>
                            <option value="yearly">Yearly</option>
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
                        <span class="accuracy-label">Forecast Accuracy: 87% ±3%</span>
                        <div class="accuracy-bar">
                            <div class="accuracy-fill" style="width: 87%"></div>
                        </div>
                    </div>
                </div>
                
                <div class="forecast-chart-large">
                    ${renderForecastChart()}
                </div>
                
                <div class="forecast-numbers">
                    <div class="number-card">
                        <div class="number-label">Predicted</div>
                        <div class="number-value">$${(forecast.predicted_amount / 1000000).toFixed(1)}M</div>
                    </div>
                    <div class="number-card best">
                        <div class="number-label">Best Case</div>
                        <div class="number-value">$${(forecast.best_case / 1000000).toFixed(1)}M</div>
                        <div class="number-trend">+16%</div>
                    </div>
                    <div class="number-card worst">
                        <div class="number-label">Worst Case</div>
                        <div class="number-value">$${(forecast.worst_case / 1000000).toFixed(1)}M</div>
                        <div class="number-trend negative">-12%</div>
                    </div>
                </div>
                
                <div class="forecast-breakdown">
                    <h4>Forecast Breakdown</h4>
                    <table class="breakdown-table">
                        <thead>
                            <tr>
                                <th scope="col">Source</th>
                                <th scope="col">Current</th>
                                <th scope="col">Predicted</th>
                                <th scope="col">Confidence</th>
                                <th scope="col"></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Existing Deals</td>
                                <td>$1.2M</td>
                                <td>$1.4M <span class="trend up">⬆️</span></td>
                                <td><span class="confidence high">95%</span></td>
                                <td><button class="btn-link" onclick="app.viewDealDetails('existing')">View</button></td>
                            </tr>
                            <tr>
                                <td>New Prospects</td>
                                <td>$850K</td>
                                <td>$650K <span class="trend down">⬇️</span></td>
                                <td><span class="confidence medium">72%</span></td>
                                <td><button class="btn-link" onclick="app.viewProspectDetails()">View</button></td>
                            </tr>
                            <tr>
                                <td>Upsells</td>
                                <td>$350K</td>
                                <td>$280K <span class="trend down">⬇️</span></td>
                                <td><span class="confidence medium">68%</span></td>
                                <td><button class="btn-link" onclick="app.viewUpsellOpportunities()">View</button></td>
                            </tr>
                            <tr>
                                <td>Referrals</td>
                                <td>$120K</td>
                                <td>$180K <span class="trend up">⬆️</span></td>
                                <td><span class="confidence high">88%</span></td>
                                <td><button class="btn-link" onclick="app.viewReferrals()">View</button></td>
                            </tr>
                            <tr>
                                <td>Renewals</td>
                                <td>$180K</td>
                                <td>$160K <span class="trend down">⬇️</span></td>
                                <td><span class="confidence high">91%</span></td>
                                <td><button class="btn-link" onclick="app.viewRenewals()">View</button></td>
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

    // Generate sales forecast
    const generateSalesForecast = async (period = 'quarterly') => {
        // Get historical transactions
        const transactions = await AppDataStore.getAll('transactions');

        // Server-side status filter so we don't pull every dormant/closed
        // prospect just to count the active pipeline. Cap large enough that
        // even multi-tenant scale fits in one page; falls back to client
        // filter on error.
        const prospectsRes = await AppDataStore.queryAdvanced('prospects', {
            filters: { status: 'active' },
            limit: 50000,
            countMode: null,
        }).catch(() => null);
        const prospects = prospectsRes?.data
            || (await AppDataStore.getAll('prospects')).filter(p => p.status === 'active');

        // Simple forecast calculation
        const historicalAvg = transactions.length > 0
            ? transactions.reduce((sum, t) => sum + (t.amount || 0), 0) / Math.max(1, transactions.length / 30)
            : 100000;

        const pipelineValue = prospects.length * 5000; // Mock calculation

        const predictedAmount = historicalAvg + (pipelineValue * 0.3);
        const bestCase = predictedAmount * 1.16;
        const worstCase = predictedAmount * 0.88;

        // Save forecast to history
        const forecast = {
            id: generateId(),
            forecast_date: new Date().toISOString(),
            period: period,
            period_start: getPeriodStart(period),
            period_end: getPeriodEnd(period),
            predicted_amount: predictedAmount,
            confidence_low: worstCase,
            confidence_high: bestCase,
            breakdown: {
                existing_deals: predictedAmount * 0.58,
                new_prospects: predictedAmount * 0.27,
                upsells: predictedAmount * 0.12,
                referrals: predictedAmount * 0.03
            },
            model_version: _currentModelVersion,
            created_at: new Date().toISOString()
        };

        await AppDataStore.create('forecast_history', forecast);

        return {
            predicted_amount: predictedAmount,
            best_case: bestCase,
            worst_case: worstCase,
            breakdown: forecast.breakdown
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

    // Render forecast chart
    const renderForecastChart = () => {
        const weeks = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'];
        const values = [1.8, 2.0, 1.9, 2.2, 2.3, 2.5, 2.4, 2.6, 2.7, 2.5, 2.8, 3.0];

        let chartHTML = '<div class="forecast-bars">';

        values.forEach((val, i) => {
            const height = (val / 3) * 150; // Scale to max height 150px
            chartHTML += `
                <div class="forecast-bar-group">
                    <div class="forecast-bar" style="height: ${height}px" title="$${val}M"></div>
                    <div class="forecast-label">${weeks[i]}</div>
                </div>
            `;
        });

        chartHTML += '</div>';

        return chartHTML;
    };

    // Show Churn Risk Analysis
    const showChurnRiskAnalysis = async () => {
        // Get all churn risks
        const allChurnRisks = await AppDataStore.getAll('churn_risk');
        const churnRisks = (allChurnRisks || [])
            .sort((a, b) => b.risk_score - a.risk_score);

        const highRisk = churnRisks.filter(c => c.risk_level === 'high').length;
        const mediumRisk = churnRisks.filter(c => c.risk_level === 'medium').length;
        const lowRisk = churnRisks.filter(c => c.risk_level === 'low').length;
        const total = churnRisks.length || 1; // avoid div by 0

        const allCustomersCRA = await AppDataStore.getAll('customers');
        const customerMapCRA = new Map((allCustomersCRA || []).map(c => [String(c.id), c]));

        let risksHTML = '';
        const topRisks = churnRisks.slice(0, 5);
        for (const risk of topRisks) {
            const customer = customerMapCRA.get(String(risk.customer_id));
            if (!customer) continue;

            const riskClass = risk.risk_level === 'high' ? 'high' : risk.risk_level === 'medium' ? 'medium' : 'low';
            const factors = risk.factors || {};

            risksHTML += `
                <tr>
                    <td><strong>${customer.full_name}</strong></td>
                    <td><span class="risk-badge ${riskClass}">${risk.risk_score}%</span></td>
                    <td>
                        <div class="risk-factors">
                            ${Object.entries(factors).slice(0, 2).map(([key, val]) =>
                `<span class="factor-tag">${key}: ${val}</span>`
            ).join('')}
                        </div>
                    </td>
                    <td><button class="btn-link" onclick="app.contactAtRiskCustomer(${customer.id})">Contact</button></td>
                </tr>
            `;
        }

        const content = `
            <div class="churn-dashboard">
                <div class="churn-header">
                    <h3>Churn Risk Analysis</h3>
                    <div class="overall-risk">
                        <span class="risk-meter">15.3%</span>
                        <span class="risk-trend negative">⬆️ +2.1% vs last month</span>
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
                            ${risksHTML || '<tr><td colspan="4" class="empty-state">No churn risk data available</td></tr>'}
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
                        <li class="action-item critical">
                            <input type="checkbox" id="action4">
                            <label for="action4"><strong>⚠️ 3 customers showing critical signs - immediate attention required</strong></label>
                        </li>
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

    // Calculate churn risk for a customer
    const calculateChurnRisk = async (customerId) => {
        const customer = await AppDataStore.getById('customers', customerId);
        if (!customer) return null;

        // Get customer activities
        const activities = await AppDataStore.query('activities', { customer_id: customerId });

        // Calculate activity recency
        const lastActivity = activities.sort((a, b) =>
            new Date(b.activity_date) - new Date(a.activity_date)
        )[0];

        let recencyScore = 0;
        if (lastActivity) {
            const daysSince = Math.floor((Date.now() - new Date(lastActivity.activity_date).getTime()) / (24 * 60 * 60 * 1000));
            recencyScore = daysSince > 60 ? 100 : daysSince > 30 ? 70 : daysSince > 14 ? 40 : 10;
        } else {
            recencyScore = 90; // No activity at all
        }

        // Support ticket count (mock)
        const supportTickets = Math.floor(Math.random() * 10);
        const supportScore = Math.min(100, supportTickets * 15);

        // Payment history
        const paymentScore = Math.floor(Math.random() * 100); // Mock

        // Engagement trend
        const recentActivities = activities.filter(a =>
            new Date(a.activity_date) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        ).length;

        const previousActivities = activities.filter(a => {
            const date = new Date(a.activity_date);
            return date > new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) &&
                date <= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        }).length;

        let trendScore = 50;
        if (recentActivities < previousActivities * 0.5) {
            trendScore = 80; // High risk - engagement dropping
        } else if (recentActivities > previousActivities * 1.5) {
            trendScore = 20; // Low risk - engagement increasing
        }

        // Contract status (mock)
        const contractScore = Math.floor(Math.random() * 100);

        // Calculate overall risk score
        const riskScore = Math.floor(
            (recencyScore * 0.30) +
            (supportScore * 0.20) +
            (paymentScore * 0.25) +
            (trendScore * 0.15) +
            (contractScore * 0.10)
        );

        // Determine risk level
        let riskLevel = 'low';
        if (riskScore >= 70) riskLevel = 'high';
        else if (riskScore >= 40) riskLevel = 'medium';

        // Generate warning signals
        const warningSignals = [];
        if (recencyScore > 70) warningSignals.push('No activity for over 30 days');
        if (supportScore > 70) warningSignals.push('High support ticket volume');
        if (paymentScore > 70) warningSignals.push('Payment delays detected');
        if (trendScore > 70) warningSignals.push('Engagement dropping significantly');
        if (contractScore > 70) warningSignals.push('Contract expiring soon');

        // Generate recommended actions
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

        // Create churn risk record
        const churnRisk = {
            id: generateId(),
            customer_id: customerId,
            risk_score: riskScore,
            risk_level: riskLevel,
            factors: {
                activity_recency: recencyScore,
                support_tickets: supportScore,
                payment_history: paymentScore,
                engagement_trend: trendScore,
                contract_status: contractScore
            },
            predicted_churn_date: new Date(Date.now() + (90 * 24 * 60 * 60 * 1000)).toISOString(),
            probability: riskScore / 100,
            warning_signals: warningSignals,
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

    // Show Performance Insights
    const showPerformanceInsights = async () => {
        const allAgents = await AppDataStore.getAll('users');
        const agents = (allAgents || []).filter(window._crmUtils.isAgent);

        let insightsHTML = '';
        for (const agent of agents) {
            const insights = await generateAgentInsights(agent.id);

            if (insights) {
                const varianceClass = insights.variance > 0 ? 'positive' : 'negative';
                const trendIcon = insights.variance > 0 ? '⬆️' : '⬇️';

                insightsHTML += `
                    <tr>
                        <td><strong>${agent.full_name}</strong></td>
                        <td>$${(insights.target / 1000).toFixed(0)}K</td>
                        <td>$${(insights.actual / 1000).toFixed(0)}K</td>
                        <td>$${(insights.predicted / 1000).toFixed(0)}K</td>
                        <td><span class="variance ${varianceClass}">${trendIcon} ${Math.abs(insights.variance)}%</span></td>
                        <td>
                            <div class="agent-insight">
                                <span class="insight-strength">💪 ${insights.strength}</span>
                                <span class="insight-improvement">📈 ${insights.improvement}</span>
                            </div>
                        </td>
                        <td><button class="btn-icon" aria-label="View agent performance" onclick="app.viewAgentDetails(${agent.id})"><i class="fas fa-chart-bar" aria-hidden="true"></i></button></td>
                    </tr>
                `;
            }
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
                    <h4>Team Performance vs AI Predictions</h4>
                    <table class="performance-table">
                        <thead>
                            <tr>
                                <th scope="col">Agent</th>
                                <th scope="col">Target</th>
                                <th scope="col">Actual</th>
                                <th scope="col">Predicted</th>
                                <th scope="col">Variance</th>
                                <th scope="col">Insights</th>
                                <th scope="col"></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${insightsHTML || '<tr><td colspan="7" class="empty-state">No performance data available</td></tr>'}
                        </tbody>
                    </table>
                </div>
                
                <div class="activity-recommendations">
                    <h4>AI Activity Recommendations</h4>
                    <div class="recommendations-grid">
                        <div class="recommendation-card">
                            <i class="fas fa-phone-alt"></i>
                            <div class="recommendation-content">
                                <h5>Best time to call</h5>
                                <p>Tue 10-11am (32% higher connect rate)</p>
                                <small>Based on 10,247 historical calls</small>
                            </div>
                        </div>
                        <div class="recommendation-card">
                            <i class="fas fa-calendar-check"></i>
                            <div class="recommendation-content">
                                <h5>Best day for meetings</h5>
                                <p>Wednesday (45% show rate)</p>
                                <small>Based on 3,892 scheduled meetings</small>
                            </div>
                        </div>
                        <div class="recommendation-card">
                            <i class="fas fa-clock"></i>
                            <div class="recommendation-content">
                                <h5>Optimal follow-up</h5>
                                <p>Within 2 hours (3x conversion)</p>
                                <small>Based on 15,678 follow-up sequences</small>
                            </div>
                        </div>
                        <div class="recommendation-card">
                            <i class="fas fa-envelope"></i>
                            <div class="recommendation-content">
                                <h5>Email subject line</h5>
                                <p>"Quick question" (22% open rate)</p>
                                <small>Based on 8,431 email campaigns</small>
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

    // Generate insights for an agent
    const generateAgentInsights = async (agentId) => {
        // Get agent stats
        const stats = (await AppDataStore.query('agent_stats', { agent_id: agentId }))[0];
        if (!stats) return null;

        // Get agent targets
        const target = (await AppDataStore.query('monthly_targets', { agent_id: agentId }))[0];

        // Mock data for demo
        const actual = 435000 + Math.floor(Math.random() * 150000);
        const predicted = 480000 + Math.floor(Math.random() * 50000);
        const targetValue = target?.target_amount || 500000;

        const variance = Math.round(((actual - predicted) / predicted) * 100);

        const strengths = [
            'Closing rate (32% vs avg 24%)',
            'Best at WhatsApp follow-ups',
            'High customer satisfaction',
            'Quick response time'
        ];

        const improvements = [
            'Follow-up async speed (2.1 days vs 1.2 avg)',
            'Call volume ↓40% this month',
            'Needs more prospecting',
            'Upsell rate below target'
        ];

        // Create insight record
        const insight = {
            id: generateId(),
            agent_id: agentId,
            insight_date: new Date().toISOString(),
            insight_type: variance > 5 ? 'strength' : variance < -5 ? 'weakness' : 'opportunity',
            metric: 'sales_performance',
            value: actual,
            benchmark: predicted,
            variance: variance,
            recommendation: variance < 0 ? 'Increase call volume to 15/day' : 'Share best practices with team',
            priority: Math.abs(variance) > 10 ? 'high' : Math.abs(variance) > 5 ? 'medium' : 'low',
            is_actioned: false,
            created_at: new Date().toISOString()
        };

        await AppDataStore.create('performance_insights', insight);

        return {
            target: targetValue,
            actual: actual,
            predicted: predicted,
            variance: variance,
            strength: strengths[Math.floor(Math.random() * strengths.length)],
            improvement: improvements[Math.floor(Math.random() * improvements.length)]
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

    // ── Attach public functions to window.app ────────────────────────────
    // ── Placeholder handlers for AI-dashboard action buttons ──────────────
    // The Lead Scoring / Sales Forecast / Churn Risk / Performance Insights
    // dashboards wired these onclick handlers before their backends existed.
    // Calling an undefined app.* throws an uncaught TypeError, so register safe
    // stubs that tell the user the feature is pending instead of crashing.
    const _aiSoon = (label) => () => UI.toast.info(`${label} — coming soon`);
    Object.assign(window.app, {
        executeAction:                _aiSoon('Recommended action'),
        viewLeadDetails:              _aiSoon('Lead details'),
        recalculateLeadScores:        _aiSoon('Recalculate lead scores'),
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
        contactAtRiskCustomer:        _aiSoon('Contact customer'),
        executeRiskActions:           _aiSoon('Risk actions'),
        viewAgentDetails:             _aiSoon('Agent details'),
        refreshPerformanceInsights:   _aiSoon('Refresh insights'),
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
        refreshAIPredictions: batchUpdateLeadScores,  // alias used in HTML onclick
    });
})();