// AI Insights Dashboard — scaffold-shell island (modal-content, view 'ai_insights').
//
// Rendered as the body of a fullscreen UI.showModal. React owns the static
// layout (header + Refresh, chart legend, the 4 static insight cards, the
// predictions-table headers) and the stable-id containers the chunk fills:
//   #ai-stats-grid       ← chunk renderAIStatsCards()
//   #ai-timeline-chart   ← chunk renderAITimelineChart()
//   #ai-predictions-tbody← chunk renderTopPredictions()
// All logic + data fetches stay in chunks/script-ai.js (showAIInsightsDashboard
// awaits the island onReady then fills by id). Insight-card / Refresh clicks
// call window.app.* exactly as the legacy inline onclick did.
import React, { useEffect } from 'react';

const app = () => window.app || {};
const call = (name) => { const f = app()[name]; if (typeof f === 'function') f(); };

export function AIInsightsView({ onReady }) {
    try { window.__REACT_AI_STATE = 'ready'; } catch (_) { /* noop */ }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
    }, [onReady]);

    return (
        <div className="ai-dashboard">
            <div className="dashboard-header">
                <h2>AI Insights Dashboard</h2>
                <button className="btn secondary" onClick={() => call('refreshAIPredictions')}>
                    <i className="fas fa-sync-alt"></i> Refresh
                </button>
            </div>

            <div className="stats-grid" id="ai-stats-grid"></div>

            <div className="chart-container">
                <h3>AI Predictions Timeline</h3>
                <div className="ai-timeline-chart" id="ai-timeline-chart"></div>
                <div className="chart-legend">
                    <div className="legend-item"><span className="color-dot actual"></span> Actual</div>
                    <div className="legend-item"><span className="color-dot predicted"></span> Predicted</div>
                    <div className="legend-item"><span className="color-dot target"></span> Target</div>
                    <div className="legend-item"><span className="color-dot confidence"></span> Confidence: 85%</div>
                </div>
            </div>

            <div className="insights-grid">
                <div className="insight-card" onClick={() => call('showLeadScoring')} role="button">
                    <i className="fas fa-chart-line"></i>
                    <h4>Lead Scoring</h4>
                    <p>156 leads&gt; 80 score</p>
                    <span className="trend up">+34 this week</span>
                </div>
                <div className="insight-card" onClick={() => call('showSalesForecast')} role="button">
                    <i className="fas fa-dollar-sign"></i>
                    <h4>Sales Forecast</h4>
                    <p>$2.4M next 30 days</p>
                    <span className="trend down">-12% vs last month</span>
                </div>
                <div className="insight-card" onClick={() => call('showChurnRiskAnalysis')} role="button">
                    <i className="fas fa-exclamation-triangle"></i>
                    <h4>Churn Risk</h4>
                    <p>23 customers at risk</p>
                    <span className="trend up warning">+15% increase</span>
                </div>
                <div className="insight-card" onClick={() => call('showPerformanceInsights')} role="button">
                    <i className="fas fa-users"></i>
                    <h4>Team Insights</h4>
                    <p>8 recommendations</p>
                    <span className="trend up">3 high priority</span>
                </div>
            </div>

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
                    <tbody id="ai-predictions-tbody"></tbody>
                </table>
            </div>
        </div>
    );
}
