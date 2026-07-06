-- Promotion packages: agent-only bonus note
-- ------------------------------------------------------------------
-- Adds an agent-facing "Agent Bonus" field to promotions. This note is
-- shown ONLY on the agent/admin promo card (chunks/script-marketing.js
-- showMonthlyPromotionView gates it via _isAgentViewer) and is NEVER
-- included in the customer WhatsApp share (src/react/views/MonthlyPromotionView.jsx
-- sharePromo). Customers/referrers (level 12–14) never receive it.
--
-- Additive + idempotent. Safe to run against live. Must run BEFORE (or with)
-- the deploy that ships the code, otherwise Create/Update Package saves will
-- trigger the "Database Migration Required" modal on the missing column.

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS agent_note TEXT;
