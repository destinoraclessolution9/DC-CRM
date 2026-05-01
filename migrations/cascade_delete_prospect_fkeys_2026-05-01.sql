-- =====================================================================
-- Add ON DELETE CASCADE to all prospect FK constraints
-- 2026-05-01
--
-- Problem: deleting a prospect raised FK violation errors from tables
-- that reference prospects.id with NO ACTION (the Postgres default).
-- The app was only cleaning up activities/notes/names manually, missing
-- referrals, purchases, proposed_solutions, etc.
--
-- Fix: flip all relevant FK constraints to ON DELETE CASCADE so Postgres
-- automatically cleans up child rows when a prospect is deleted.
-- =====================================================================

BEGIN;

ALTER TABLE referrals         DROP CONSTRAINT referrals_referred_prospect_id_fkey;
ALTER TABLE referrals         ADD  CONSTRAINT referrals_referred_prospect_id_fkey         FOREIGN KEY (referred_prospect_id) REFERENCES prospects(id) ON DELETE CASCADE;

ALTER TABLE purchases         DROP CONSTRAINT purchases_prospect_id_fkey;
ALTER TABLE purchases         ADD  CONSTRAINT purchases_prospect_id_fkey                  FOREIGN KEY (prospect_id)          REFERENCES prospects(id) ON DELETE CASCADE;

ALTER TABLE proposed_solutions DROP CONSTRAINT proposed_solutions_prospect_id_fkey;
ALTER TABLE proposed_solutions ADD  CONSTRAINT proposed_solutions_prospect_id_fkey        FOREIGN KEY (prospect_id)          REFERENCES prospects(id) ON DELETE CASCADE;

ALTER TABLE my_potential_list DROP CONSTRAINT my_potential_list_prospect_id_fkey;
ALTER TABLE my_potential_list ADD  CONSTRAINT my_potential_list_prospect_id_fkey          FOREIGN KEY (prospect_id)          REFERENCES prospects(id) ON DELETE CASCADE;

ALTER TABLE manual_overrides  DROP CONSTRAINT manual_overrides_prospect_id_fkey;
ALTER TABLE manual_overrides  ADD  CONSTRAINT manual_overrides_prospect_id_fkey           FOREIGN KEY (prospect_id)          REFERENCES prospects(id) ON DELETE CASCADE;

ALTER TABLE campaign_messages DROP CONSTRAINT campaign_messages_prospect_id_fkey;
ALTER TABLE campaign_messages ADD  CONSTRAINT campaign_messages_prospect_id_fkey          FOREIGN KEY (prospect_id)          REFERENCES prospects(id) ON DELETE CASCADE;

ALTER TABLE reassignment_history DROP CONSTRAINT reassignment_history_prospect_id_fkey;
ALTER TABLE reassignment_history ADD  CONSTRAINT reassignment_history_prospect_id_fkey   FOREIGN KEY (prospect_id)          REFERENCES prospects(id) ON DELETE CASCADE;

ALTER TABLE inactivity_alerts DROP CONSTRAINT inactivity_alerts_prospect_id_fkey;
ALTER TABLE inactivity_alerts ADD  CONSTRAINT inactivity_alerts_prospect_id_fkey         FOREIGN KEY (prospect_id)          REFERENCES prospects(id) ON DELETE CASCADE;

ALTER TABLE lead_scores       DROP CONSTRAINT lead_scores_prospect_id_fkey;
ALTER TABLE lead_scores       ADD  CONSTRAINT lead_scores_prospect_id_fkey                FOREIGN KEY (prospect_id)          REFERENCES prospects(id) ON DELETE CASCADE;

ALTER TABLE case_studies      DROP CONSTRAINT case_studies_prospect_id_fkey;
ALTER TABLE case_studies      ADD  CONSTRAINT case_studies_prospect_id_fkey               FOREIGN KEY (prospect_id)          REFERENCES prospects(id) ON DELETE CASCADE;

COMMIT;
