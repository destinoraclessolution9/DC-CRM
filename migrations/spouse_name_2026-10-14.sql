-- Spouse name on prospects + customers (2026-10-14).
-- Captured on the shared basic-info form (CPS entry / Add-Edit Prospect) when
-- marital status is not Single; carried across on prospect -> customer conversion.
-- Additive only.
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS spouse_name text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS spouse_name text;
