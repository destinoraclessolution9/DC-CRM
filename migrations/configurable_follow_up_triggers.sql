-- Migration: Make follow-up triggers fully configurable
-- Run this in Supabase SQL Editor. Safe to re-run (uses IF NOT EXISTS).

-- 1. Add new columns
ALTER TABLE follow_up_templates ADD COLUMN IF NOT EXISTS trigger_category text;
ALTER TABLE follow_up_templates ADD COLUMN IF NOT EXISTS event_keywords text;
ALTER TABLE follow_up_templates ADD COLUMN IF NOT EXISTS cps_interest_match text;
ALTER TABLE follow_up_templates ADD COLUMN IF NOT EXISTS solution_match text;
ALTER TABLE follow_up_templates ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE follow_up_templates ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE follow_up_templates ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

-- 2. Backfill existing rows with their previously hardcoded values
UPDATE follow_up_templates SET
    trigger_category = 'after_cps',
    event_keywords = '9 star,nine star,九星',
    cps_interest_match = '个人改命',
    solution_match = 'power ring',
    icon = '⭐',
    description = 'After CPS with interest 个人改命 or Power Ring proposed. Invites to next 9 Star Basic Class (30-day window).',
    sort_order = 1
WHERE trigger_type = 'cps_9star' AND trigger_category IS NULL;

UPDATE follow_up_templates SET
    trigger_category = 'after_cps',
    event_keywords = 'diy,风水diy,环境风水',
    cps_interest_match = '风水',
    solution_match = '风水方案,fengshui,office audit,home audit',
    icon = '🏠',
    description = 'After CPS with interest 风水 or 风水方案 proposed. Invites to next Feng Shui DIY (30-day window).',
    sort_order = 2
WHERE trigger_type = 'cps_fengshui' AND trigger_category IS NULL;

UPDATE follow_up_templates SET
    trigger_category = 'after_cps',
    event_keywords = '汇集,huiji,hui ji',
    cps_interest_match = '',
    solution_match = '',
    icon = '🏛️',
    description = 'After any CPS consultation. Invites to next 汇集 event (30-day window).',
    sort_order = 3
WHERE trigger_type = 'cps_huiji' AND trigger_category IS NULL;

UPDATE follow_up_templates SET
    trigger_category = 'on_apu_photo',
    event_keywords = '',
    cps_interest_match = '',
    solution_match = '',
    icon = '📋',
    description = 'When APU photo is attached. Reminds prospect to make an appointment.',
    sort_order = 4
WHERE trigger_type = 'apu_appointment' AND trigger_category IS NULL;

UPDATE follow_up_templates SET
    trigger_category = 'on_event_attendance',
    event_keywords = 'diy',
    cps_interest_match = '',
    solution_match = '',
    icon = '🔄',
    description = 'After attending a DIY event. Follows up after delay to review progress.',
    sort_order = 5
WHERE trigger_type = 'diy_review' AND trigger_category IS NULL;

UPDATE follow_up_templates SET
    trigger_category = 'on_birthday',
    event_keywords = '',
    cps_interest_match = '',
    solution_match = '',
    icon = '🎂',
    description = 'Daily on calendar load. Sends birthday greeting to prospects/customers.',
    sort_order = 6
WHERE trigger_type = 'birthday' AND trigger_category IS NULL;
