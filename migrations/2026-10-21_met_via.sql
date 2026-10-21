-- "How did we meet?" (2026-10-21): one clear lead source per prospect, using
-- the Pipeline's deal-source ids so the Where-from view reads it directly.
-- Before this, `source` held import-batch tags and referred_by_type only said
-- who referred (212 prospects had neither).
alter table public.prospects add column if not exists met_via text
    check (met_via is null or met_via in ('customer_referral', 'agent_referral', 'prospect_referral', 'event', 'cps_walkin', 'social', 'other'));
