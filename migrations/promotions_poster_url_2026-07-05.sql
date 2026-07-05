-- ============================================================================
-- Promotion poster support
-- Date: 2026-07-05
-- ----------------------------------------------------------------------------
-- Adds a poster image URL to promotion packages. The image itself is uploaded
-- to the Supabase `attachments` storage bucket at `promotions/poster/{id}_{ts}`
-- (see savePackage() in chunks/script-marketing.js); this column just stores the
-- resulting public URL. The agent-facing Monthly Promotion view (React island
-- MonthlyPromotionView.jsx) leads each card with this poster.
--
-- Additive + idempotent. Applied to the live CRM via the Management API on
-- 2026-07-05 (already present in production); this file records the change.
-- ============================================================================

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS poster_url TEXT;
