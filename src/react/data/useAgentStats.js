// React-island migration — Agents screen (after Customers/Prospects).
//
// React Query hook feeding the Agents table island. Fetches the aux tables
// (prospects, customers, agent_stats) via the existing AppDataStore (SWR-cached,
// RLS-scoped) and builds the per-agent count + stats maps, mirroring the legacy
// renderAgentsTable pre-fetch EXACTLY (chunks/script-prospects.js).
//
// The agent LIST itself (identity filter + visibility scope) is computed in the
// chunk — which owns isAgent + getVisibleUserIds — and passed to the view as a
// prop, so this hook never re-derives those (no cross-boundary helper needed).
import { useQuery } from '@tanstack/react-query';

async function fetchAgentStats() {
    const ds = window.AppDataStore;
    if (!ds || typeof ds.getAll !== 'function') throw new Error('AppDataStore unavailable');
    const [allProspects, allCustomers, allAgentStats] = await Promise.all([
        ds.getAll('prospects'),
        ds.getAll('customers'),
        ds.getAll('agent_stats'),
    ]);
    // Mirror renderAgentsTable's count loops byte-for-byte (incl. the customer
    // responsible_agent_id || agent_id fallback) so counts match the legacy table.
    const prospectCountMap = {};
    const customerCountMap = {};
    for (const p of allProspects) {
        const aid = String(p.responsible_agent_id);
        prospectCountMap[aid] = (prospectCountMap[aid] || 0) + 1;
    }
    for (const c of allCustomers) {
        const aid = String(c.responsible_agent_id || c.agent_id);
        if (aid) customerCountMap[aid] = (customerCountMap[aid] || 0) + 1;
    }
    const statsByAgentId = {};
    for (const s of allAgentStats) statsByAgentId[String(s.agent_id)] = s;
    return { prospectCountMap, customerCountMap, statsByAgentId };
}

export function useAgentStats() {
    return useQuery({
        queryKey: ['agent-stats-maps'],
        queryFn: fetchAgentStats,
        staleTime: 30_000,
        retry: 1,
        // networkMode 'always': the queryFn reads AppDataStore (local-first cache +
        // its own offline handling), NOT raw network — so it must run regardless of
        // React Query's online belief. Without this, a query created during a cold
        // load (before RQ's onlineManager settles) pauses as "offline" and never
        // resumes (no online transition event fires), leaving counts stuck at 0.
        networkMode: 'always',
    });
}
