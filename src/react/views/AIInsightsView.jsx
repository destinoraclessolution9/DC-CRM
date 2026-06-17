// AI Insights Dashboard — componentized island (modal-content, view 'ai_insights').
//
// React owns the static layout (header + Refresh, chart title + legend,
// predictions-table headers) PLUS — when props.data is present (componentization
// SW-103+) — the REAL data sections rendered as JSX:
//   #ai-stats-grid   stats grid cards          ← props.data.stats
//   #ai-insights-grid 4 clickable insight cards ← props.data.cards
//   #ai-predictions-tbody predictions rows      ← props.data.predictions
// The timeline chart (#ai-timeline-chart) is INTENTIONALLY left as an empty
// stable-id container in BOTH paths — the chunk fills it by id with
// renderAITimelineChart() (React does not own/manage the chart's children).
//
// FALLBACK / FLAG-OFF: when props.data is absent (kill-switch off, or the chunk
// failed to build the payload), this renders the original empty stable-id
// containers exactly as before (#ai-stats-grid / #ai-insights-grid /
// #ai-predictions-tbody) so the chunk's by-id fills run unchanged — byte-for-byte
// the legacy scaffold-fill behavior. No hardcoded numbers live here.
//
// React auto-escapes curly-brace values (do NOT call esc() in JSX). Inline
// onclick app.fn(x) becomes onClick → window.app.fn(x).
import React, { useEffect } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };

// ── Stats grid (mirrors chunk renderAIStatsCards) ──────────────────────────
function StatsGrid({ stats }) {
    const {
        fcHasData, fcVal, fcDelta, fcUp,
        highValueLeads, warmLeads, highRisk, mediumRisk,
    } = stats;
    return (
        <>
            <div className="stat-card">
                <div className="stat-icon blue">
                    <i className="fas fa-chart-line"></i>
                </div>
                <div className="stat-content">
                    <h4>Sales Forecast</h4>
                    <div className="stat-value">{fcVal}</div>
                    {!fcHasData ? (
                        <div className="stat-trend">Not enough data yet</div>
                    ) : (
                        <div className={`stat-trend ${fcUp ? 'positive' : 'negative'}`}>
                            <i className={`fas fa-arrow-${fcUp ? 'up' : 'down'}`}></i> {Math.abs(fcDelta)}% vs last month
                        </div>
                    )}
                </div>
            </div>

            <div className="stat-card">
                <div className="stat-icon green">
                    <i className="fas fa-trophy"></i>
                </div>
                <div className="stat-content">
                    <h4>Lead Scoring</h4>
                    <div className="stat-value">{highValueLeads}</div>
                    <div className="stat-trend positive">
                        <i className="fas fa-arrow-up"></i> {warmLeads} warm leads
                    </div>
                </div>
            </div>

            <div className="stat-card">
                <div className="stat-icon red">
                    <i className="fas fa-exclamation-circle"></i>
                </div>
                <div className="stat-content">
                    <h4>Churn Risk</h4>
                    <div className="stat-value">{highRisk}</div>
                    <div className={`stat-trend ${mediumRisk ? 'negative' : ''}`}>
                        <i className={`fas fa-${mediumRisk ? 'arrow-up' : 'minus'}`}></i> {mediumRisk} medium risk
                    </div>
                </div>
            </div>
        </>
    );
}

// ── Clickable insight cards (mirrors chunk _aiInsightCardsHtml) ─────────────
function InsightCards({ cards }) {
    const {
        highLeads, warmLeads, fcHasData, fcNextMonthLabel, fcDelta,
        atRisk, highRisk, agentCount, topName,
    } = cards;
    return (
        <>
            <div className="insight-card" onClick={() => call('showLeadScoring')}>
                <i className="fas fa-chart-line"></i>
                <h4>Lead Scoring</h4>
                <p>{highLeads} lead{highLeads === 1 ? '' : 's'} &gt; 80 score</p>
                <span className="trend up">{warmLeads} warm in pipeline</span>
            </div>
            <div className="insight-card" onClick={() => call('showSalesForecast')}>
                <i className="fas fa-dollar-sign"></i>
                <h4>Sales Forecast</h4>
                <p>{fcHasData ? `${fcNextMonthLabel} next month` : 'Not enough data yet'}</p>
                <span className={`trend ${fcDelta >= 0 ? 'up' : 'down'}`}>{fcHasData ? `${fcDelta >= 0 ? '+' : ''}${fcDelta}% vs last month` : '—'}</span>
            </div>
            <div className="insight-card" onClick={() => call('showChurnRiskAnalysis')}>
                <i className="fas fa-exclamation-triangle"></i>
                <h4>Churn Risk</h4>
                <p>{atRisk} customer{atRisk === 1 ? '' : 's'} at risk</p>
                <span className={`trend ${highRisk ? 'up warning' : 'up'}`}>{highRisk} high priority</span>
            </div>
            <div className="insight-card" onClick={() => call('showPerformanceInsights')}>
                <i className="fas fa-users"></i>
                <h4>Team Insights</h4>
                <p>{agentCount} agent{agentCount === 1 ? '' : 's'} analyzed</p>
                <span className="trend up">{topName ? `Top: ${topName}` : 'No data yet'}</span>
            </div>
        </>
    );
}

// ── Predictions table body (mirrors chunk renderTopPredictions) ────────────
function PredictionsBody({ predictions }) {
    if (!predictions || !predictions.length) {
        return (
            <tr>
                <td colSpan="5" className="empty-state">Not enough data yet — log activities and purchases to generate predictions.</td>
            </tr>
        );
    }
    return (
        <>
            {predictions.map((p, i) => (
                <tr key={p.kind + '-' + p.id + '-' + i}>
                    <td><strong>{p.icon} {p.name}</strong></td>
                    <td>{p.type}</td>
                    <td><span className={`score-badge ${p.scoreClass}`}>{p.score}</span></td>
                    <td><span className={`confidence ${p.confidenceClass}`}>{p.confidence}%</span></td>
                    <td><button className="btn-link" onClick={() => call(p.fn, p.id)}>{p.action}</button></td>
                </tr>
            ))}
        </>
    );
}

export function AIInsightsView({ onReady, data }) {
    try { window.__REACT_AI_STATE = 'ready'; } catch (_) { /* noop */ }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
    }, [onReady]);

    const hasData = !!data;

    return (
        <div className="ai-dashboard">
            <div className="dashboard-header">
                <h2>AI Insights Dashboard</h2>
                <button className="btn secondary" onClick={() => call('refreshAIPredictions')}>
                    <i className="fas fa-sync-alt"></i> Refresh
                </button>
            </div>

            {hasData ? (
                <div className="stats-grid" id="ai-stats-grid"><StatsGrid stats={data.stats} /></div>
            ) : (
                <div className="stats-grid" id="ai-stats-grid"></div>
            )}

            <div className="chart-container">
                <h3>Activity &amp; Sales Timeline (last 12 months)</h3>
                {/* Chart stays a by-id fill in BOTH paths — chunk renderAITimelineChart() */}
                <div className="ai-timeline-chart" id="ai-timeline-chart"></div>
                <div className="chart-legend">
                    <div className="legend-item"><span className="color-dot actual"></span> Activities logged</div>
                    <div className="legend-item"><span className="color-dot predicted"></span> Closings</div>
                </div>
            </div>

            {hasData ? (
                <div className="insights-grid" id="ai-insights-grid"><InsightCards cards={data.cards} /></div>
            ) : (
                <div className="insights-grid" id="ai-insights-grid"></div>
            )}

            <div className="recent-predictions">
                <h3>Top Predictions This Week</h3>
                <table className="predictions-table">
                    <thead>
                        <tr>
                            <th scope="col">Lead/Customer</th>
                            <th scope="col">Prediction Type</th>
                            <th scope="col">Score</th>
                            <th scope="col">Confidence</th>
                            <th scope="col">Recommended Action</th>
                        </tr>
                    </thead>
                    {hasData ? (
                        <tbody id="ai-predictions-tbody"><PredictionsBody predictions={data.predictions} /></tbody>
                    ) : (
                        <tbody id="ai-predictions-tbody"></tbody>
                    )}
                </table>
            </div>
        </div>
    );
}
