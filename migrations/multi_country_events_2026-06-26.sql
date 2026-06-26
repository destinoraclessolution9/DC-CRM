-- Multi-country Phase 4b — tag events with a market — 2026-06-26
-- ADDITIVE + NON-DESTRUCTIVE. events.country defaults 'MY' so every existing
-- event reads as Malaysia. An event is wholly one market (owner decision); its
-- ticket prices render in that market's currency and reporting headcount buckets
-- by it. Re-runnable.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'MY';
CREATE INDEX IF NOT EXISTS events_country_idx ON public.events (country);
