-- 每日必做三件事 (石头理论 · daily must-do list) — per-user, editable in Account
-- Settings, shown in the daily wisdom popup. Additive nullable JSONB column;
-- stores an array of up to 3 short strings, e.g. ["读书","跟进3位客户","运动30分钟"].
-- Idempotent. No RLS change: users' UPDATE follows the existing permissive
-- baseline + users_guard trigger (which guards only privileged columns), same
-- posture as avatar/profile self-edits. Low-sensitivity personal field.
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_must_do jsonb DEFAULT '[]'::jsonb;
