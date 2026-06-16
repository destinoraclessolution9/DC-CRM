// AI Insights Dashboard — scaffold-shell island (modal-content, view 'ai_insights').
//
// Rendered as the body of a fullscreen UI.showModal. React owns the static
// layout (header + Refresh, chart title + legend, predictions-table headers)
// and the stable-id containers the chunk fills with REAL data:
//   #ai-stats-grid       ← chunk renderAIStatsCards()
//   #ai-timeline-chart   ← chunk renderAITimelineChart()
//   #ai-insights-grid    ← chunk _aiInsightCardsHtml() (the 4 clickable cards)
//   #ai-predictions-tbody← chunk renderTopPredictions()
// No hardcoded numbers live here — all logic + data fetches stay in
// chunks/script-ai.js (showAIInsightsDashboard awaits the island onReady then
// fills by id). The insight cards carry their own inline onclick="app.*"
// drill-downs built by the chunk; the Refresh button calls window.app.* here.
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
                <h3>Activity &amp; Sales Timeline (last 12 months)</h3>
                <div className="ai-timeline-chart" id="ai-timeline-chart"></div>
                <div className="chart-legend">
                    <div className="legend-item"><span className="color-dot actual"></span> Activities logged</div>
                    <div className="legend-item"><span className="color-dot predicted"></span> Closings</div>
                </div>
            </div>

            <div className="insights-grid" id="ai-insights-grid"></div>

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
