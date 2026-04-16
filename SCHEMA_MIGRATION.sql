-- =============================================================================
-- Destin Oracles Solution CRM — Schema Drift Fix Migration
-- =============================================================================
-- Generated: 2026-04-10
--
-- This file fixes 60+ fields that the JavaScript code writes to Supabase but
-- that don't exist in the schema. Without this migration, those fields are
-- silently stripped on save and only survive in the writer's localStorage —
-- meaning other users never see the data.
--
-- HOW TO RUN:
-- 1. Open Supabase dashboard → project remuwhxvzkzjtgbzqjaa
-- 2. Click "SQL Editor" in the sidebar
-- 3. Click "New query"
-- 4. Paste this entire file
-- 5. Click "Run"
--
-- SAFETY: Every statement uses IF NOT EXISTS / IF EXISTS, so it is idempotent
-- and safe to re-run.
-- =============================================================================


-- =============================================================================
-- SECTION 1: MISSING COLUMNS ON EXISTING TABLES
-- =============================================================================

-- ---- activities ---------------------------------------------------------
-- Bug: agent sees venue on their own calendar but not on other agents'.
-- The venue column was missing, so data.js stripped it before Supabase save.
alter table activities
    add column if not exists venue text,
    add column if not exists consultants jsonb,
    add column if not exists summary text,
    add column if not exists closing_amount numeric,
    add column if not exists cps_invitation_method text,
    add column if not exists cps_invitation_details text,
    add column if not exists status text,
    add column if not exists discussion_summary text,
    add column if not exists source text,
    add column if not exists completed_at timestamptz,
    -- Post-Meetup Notes & aggregate fields read by the Potential & Opportunities
    -- / Next Actions accordions on the prospect profile. Were silently stripped
    -- by data.js before, so saving Post-Meetup Notes appeared to succeed but
    -- nothing flowed through to the accordions.
    add column if not exists opportunity_potential text,
    add column if not exists next_action text,
    add column if not exists core_problem text,
    add column if not exists next_action_done boolean default false,
    add column if not exists note_next_steps_done boolean default false,
    add column if not exists score_value integer,
    add column if not exists is_closed boolean default false;

-- Back-fill: the existing `amount_closed` column is where closed-case data
-- already sits. Copy it to the new `closing_amount` column that the code reads.
update activities
set closing_amount = amount_closed
where closing_amount is null and amount_closed is not null;


-- ---- events -------------------------------------------------------------
-- Bug: Quick-Add "Create new event" writes title/date/time/category/duration/
-- visibility — none of which exist in the schema (which uses event_title/
-- event_date/start_time/event_category_id). Every new event loses its title,
-- date and time on save.
alter table events
    add column if not exists title text,
    add column if not exists date date,
    add column if not exists time time,
    add column if not exists duration integer,
    add column if not exists category text,
    add column if not exists visibility text;

-- Back-fill the legacy columns from the existing schema columns so existing
-- events remain readable via either name.
update events set title = event_title where title is null and event_title is not null;
update events set date  = event_date  where date  is null and event_date  is not null;
update events set time  = start_time  where time  is null and start_time  is not null;


-- ---- event_attendees ----------------------------------------------------
-- Bug: activity_id, entity_id, entity_name are all written but stripped.
-- Breaks the attendee ↔ specific session link.
alter table event_attendees
    add column if not exists activity_id bigint,
    add column if not exists entity_id bigint,
    add column if not exists entity_name text,
    add column if not exists paid boolean default false,
    add column if not exists ticket_created boolean default false,
    add column if not exists attended boolean default false;

-- Back-fill: entity_id is an alias for attendee_id
update event_attendees set entity_id = attendee_id where entity_id is null and attendee_id is not null;


-- ---- event_templates ----------------------------------------------------
-- Bug: schema has only 5 columns (id, title, category, base_score, created_at)
-- but code writes 9 more. Entire template feature is broken cross-device.
alter table event_templates
    add column if not exists template_name text,
    add column if not exists event_category_id bigint,
    add column if not exists description text,
    add column if not exists location text,
    add column if not exists start_time time,
    add column if not exists end_time time,
    add column if not exists capacity integer,
    add column if not exists ticket_price numeric,
    add column if not exists score_multiplier numeric,
    add column if not exists duration integer;

update event_templates set template_name = title where template_name is null and title is not null;


-- ---- event_registrations ------------------------------------------------
alter table event_registrations
    add column if not exists points_breakdown jsonb,
    add column if not exists registered_next_event boolean default false;


-- ---- prospects ----------------------------------------------------------
-- Bug: ~20 critical deal-lifecycle fields stripped. All CPS/sales workflow
-- data is currently local-only.
alter table prospects
    add column if not exists closing_record jsonb,
    add column if not exists conversion_status text,
    add column if not exists conversion_requested_by bigint,
    add column if not exists conversion_rejected_by bigint,
    add column if not exists conversion_rejected_at timestamptz,
    add column if not exists closed_at timestamptz,
    add column if not exists closed_date date,
    add column if not exists closing_date date,
    add column if not exists potential_level text,
    add column if not exists close_probability numeric,
    add column if not exists is_own_business boolean,
    add column if not exists business_name text,
    add column if not exists business_industry text,
    add column if not exists business_area text,
    add column if not exists business_title_role text,
    add column if not exists business_started date,
    add column if not exists company_size text,
    add column if not exists pre2025_purchases jsonb,
    add column if not exists original_source text,
    add column if not exists source_id bigint,
    add column if not exists source text,
    add column if not exists lead_agent_id bigint;


-- ---- customers ----------------------------------------------------------
alter table customers
    add column if not exists conversion_date timestamptz;


-- ---- users --------------------------------------------------------------
alter table users
    add column if not exists consent_preferences jsonb;


-- ---- referrals ----------------------------------------------------------
alter table referrals
    add column if not exists memo text,
    add column if not exists is_converted boolean default false;


-- ---- case_studies -------------------------------------------------------
alter table case_studies
    add column if not exists activity_id bigint,
    -- case_type distinguishes CPS invitation cases ('cps') from closed cases ('closed').
    -- Without this column every case_studies row defaults to 'cps' in the JS filter,
    -- meaning closed cases accidentally appear in the CPS Invitation Cases table.
    add column if not exists case_type text default 'cps',
    -- cps_invitation_method / cps_invitation_details are written by both the
    -- Quick-Add-Activity CPS flow and the Case Study edit modal.  Without these
    -- columns data.js strips them on every save, so the Inv. Method / Details
    -- columns always show '-' for every user except the original writer (who has
    -- the values in their own localStorage).
    add column if not exists cps_invitation_method text,
    add column if not exists cps_invitation_details text;


-- ---- entity_tags --------------------------------------------------------
alter table entity_tags
    add column if not exists applied_at timestamptz default now(),
    add column if not exists source text,
    add column if not exists source_id bigint;


-- ---- purchases ----------------------------------------------------------
-- Bug: EPP payment plan data (epp_months, epp_bank) is lost on every sale.
alter table purchases
    add column if not exists epp_months integer,
    add column if not exists epp_bank text,
    add column if not exists notes text;


-- ---- monthly_targets ----------------------------------------------------
alter table monthly_targets
    add column if not exists quarter integer;


-- ---- whatsapp_campaigns -------------------------------------------------
alter table whatsapp_campaigns
    add column if not exists description text;


-- ---- notes --------------------------------------------------------------
-- note_type is used to distinguish "outcome" vs "post_meetup" notes across
-- 10+ read sites. Without the column, the type info is lost on save and the
-- read code can't find the right notes.
alter table notes
    add column if not exists note_type text,
    add column if not exists due_date date;


-- ---- folders ------------------------------------------------------------
-- Minor drift cleanup.
alter table folders
    add column if not exists description text;


-- =============================================================================
-- SECTION 2: CREATE TABLES THAT THE CODE USES BUT SUPABASE IS MISSING (19)
-- =============================================================================

-- ---- transactions -------------------------------------------------------
create table if not exists transactions (
    id bigint primary key,
    prospect_id bigint,
    customer_id bigint,
    amount numeric,
    type text,
    status text,
    description text,
    created_by bigint,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);


-- ---- contracts ----------------------------------------------------------
create table if not exists contracts (
    id bigint primary key,
    title text,
    customer_id bigint,
    prospect_id bigint,
    file_name text,
    file_url text,
    status text,
    signing_token text,
    sent_at timestamptz,
    signed_at timestamptz,
    created_by bigint,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);


-- ---- approval_queue -----------------------------------------------------
create table if not exists approval_queue (
    id bigint primary key,
    approval_type text,
    status text default 'pending',
    prospect_id bigint,
    customer_id bigint,
    submitted_by bigint,
    submitted_at timestamptz default now(),
    reviewed_by bigint,
    reviewed_at timestamptz,
    reject_reason text,
    snapshot_before jsonb,
    snapshot_after jsonb,
    description text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);


-- ---- user_preferences ---------------------------------------------------
create table if not exists user_preferences (
    id bigint primary key,
    user_id bigint,
    pref_key text,
    pref_value jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);


-- ---- special_programs (Special Program Fighting) -----------------------
create table if not exists special_programs (
    id bigint primary key,
    program_name text,
    reward text,
    description text,
    start_date date,
    end_date date,
    sales_target numeric,
    new_customers_target integer,
    cps_target integer,
    qualify_mode text default 'all',
    status text default 'active',
    created_by bigint,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);


-- ---- special_program_participants --------------------------------------
create table if not exists special_program_participants (
    id bigint primary key,
    program_id bigint,
    agent_id bigint,
    joined_at timestamptz default now(),
    progress jsonb,
    created_at timestamptz default now()
);


-- ---- booking_slots ------------------------------------------------------
create table if not exists booking_slots (
    id bigint primary key,
    agent_id bigint,
    day_of_week integer,
    start_time text,
    end_time text,
    duration_minutes integer,
    is_active boolean default true,
    created_at timestamptz default now()
);


-- ---- booking_appointments ----------------------------------------------
create table if not exists booking_appointments (
    id bigint primary key,
    slot_id bigint,
    agent_id bigint,
    prospect_name text,
    prospect_phone text,
    prospect_email text,
    prospect_dob date,
    prospect_occupation text,
    prospect_company text,
    prospect_ic text,
    prospect_address text,
    prospect_city text,
    prospect_state text,
    prospect_postal text,
    referred_by text,
    referral_relationship text,
    booking_date date,
    start_time text,
    end_time text,
    status text default 'pending',
    notes text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);


-- ---- booking_pages ------------------------------------------------------
create table if not exists booking_pages (
    id bigint primary key,
    agent_id bigint,
    slug text,
    title text,
    description text,
    is_active boolean default true,
    created_at timestamptz default now()
);


-- ---- lead_forms ---------------------------------------------------------
create table if not exists lead_forms (
    id bigint primary key,
    name text,
    slug text,
    title text,
    description text,
    fields jsonb,
    assigned_agent_id bigint,
    is_active boolean default true,
    created_at timestamptz default now()
);


-- ---- lead_submissions ---------------------------------------------------
create table if not exists lead_submissions (
    id bigint primary key,
    form_id bigint,
    data jsonb,
    status text default 'new',
    prospect_id bigint,
    created_at timestamptz default now()
);


-- ---- surveys ------------------------------------------------------------
create table if not exists surveys (
    id bigint primary key,
    name text,
    type text,
    question text,
    description text,
    created_by bigint,
    is_active boolean default true,
    created_at timestamptz default now()
);


-- ---- survey_responses ---------------------------------------------------
create table if not exists survey_responses (
    id bigint primary key,
    survey_id bigint,
    respondent_name text,
    respondent_email text,
    score integer,
    feedback text,
    source text,
    submitted_at timestamptz default now()
);


-- ---- custom_field_definitions ------------------------------------------
create table if not exists custom_field_definitions (
    id bigint primary key,
    entity_type text,
    label text,
    field_key text,
    type text,
    options jsonb,
    is_required boolean default false,
    sort_order integer default 0,
    created_at timestamptz default now()
);


-- ---- custom_field_values -----------------------------------------------
create table if not exists custom_field_values (
    id bigint primary key,
    entity_type text,
    entity_id bigint,
    field_key text,
    value text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);


-- ---- portal_sessions ----------------------------------------------------
create table if not exists portal_sessions (
    id bigint primary key,
    customer_id bigint,
    email text,
    token text,
    expires_at timestamptz,
    created_at timestamptz default now()
);


-- ---- ai_predictions -----------------------------------------------------
create table if not exists ai_predictions (
    id bigint primary key,
    entity_type text,
    entity_id bigint,
    prediction_type text,
    result jsonb,
    confidence numeric,
    created_at timestamptz default now()
);


-- ---- document_tags ------------------------------------------------------
create table if not exists document_tags (
    id bigint primary key,
    name text,
    color text,
    created_at timestamptz default now()
);


-- ---- document_tag_mappings ----------------------------------------------
create table if not exists document_tag_mappings (
    id bigint primary key,
    document_id bigint,
    tag_id bigint,
    created_at timestamptz default now()
);


-- =============================================================================
-- SECTION 3: ENABLE ROW-LEVEL SECURITY + GRANT ACCESS
-- =============================================================================
-- New tables need RLS policies matching the rest of the schema. Since the app
-- uses the service-role key for writes (bypasses RLS), we only need to ensure
-- reads via the anon role work. These policies grant unrestricted read/write
-- to match the existing CRM table behavior.

do $$
declare t text;
begin
    for t in select unnest(array[
        'transactions','contracts','approval_queue','user_preferences',
        'special_programs','special_program_participants','booking_slots',
        'booking_appointments','booking_pages','lead_forms','lead_submissions',
        'surveys','survey_responses','custom_field_definitions',
        'custom_field_values','portal_sessions','ai_predictions',
        'document_tags','document_tag_mappings'
    ])
    loop
        execute format('alter table %I enable row level security', t);
        execute format('drop policy if exists "allow_all" on %I', t);
        execute format('create policy "allow_all" on %I for all using (true) with check (true)', t);
    end loop;
end $$;


-- =============================================================================
-- DONE
-- =============================================================================
-- After running this, the app's schema-stripping behavior in data.js will
-- never strip these fields again, and all cross-user data sync bugs in this
-- class are fixed.
-- =============================================================================
