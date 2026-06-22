-- APU express lane activation (pairs with calendar.js commit b6a4d83).
-- Adds prospects.apu_namelist_at + an AFTER-INSERT trigger on `names` that stamps it = now()
-- whenever a referral name is added. dispatchApuAckTouches then queues a next-day "thank you,
-- slots reserved" touch (episode-keyed on the namelist date+1: same-day adds dedupe, a new
-- day's batch re-arms). Until this runs, the dispatcher no-ops safely (reads a missing column).
-- Additive + idempotent. Apply via the Supabase SQL editor (or Management API).

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS apu_namelist_at timestamptz;

CREATE OR REPLACE FUNCTION stamp_apu_namelist() RETURNS trigger AS $f$
BEGIN
  IF NEW.prospect_id IS NOT NULL THEN
    UPDATE prospects SET apu_namelist_at = now() WHERE id = NEW.prospect_id;
  END IF;
  RETURN NEW;
END;
$f$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stamp_apu_namelist ON names;
CREATE TRIGGER trg_stamp_apu_namelist
  AFTER INSERT ON names
  FOR EACH ROW EXECUTE FUNCTION stamp_apu_namelist();

-- Verify: add a name to a prospect, then confirm the stamp landed.
-- select id, full_name, apu_namelist_at from prospects where apu_namelist_at is not null order by apu_namelist_at desc limit 5;
