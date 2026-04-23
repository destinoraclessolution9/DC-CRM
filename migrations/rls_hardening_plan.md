# RLS Hardening Plan — DO NOT APPLY WITHOUT A STAGING TEST

**Status:** plan only. Current policies (`auth_full_access` with `qual='true'`)
let any authenticated user read every row in every table. That's a privacy
hole, not a perf problem. Applying the hardening below incorrectly will lock
every user out of the app — so it MUST be staged on a test Supabase project
first, then rolled forward one table at a time with a rollback plan ready.

## Why this isn't done yet

The app's current role hierarchy lives client-side (`getVisibleUserIds`,
`isSystemAdmin`, etc. in `script.js`). Mapping that to a SQL policy requires:
1. A stable link from `auth.uid()` (UUID) → `users.id` (bigint). Today the
   link is made at login by looking up `users.email = auth.email()`; there is
   no `auth_user_id` column on the `users` table.
2. A SECURITY DEFINER helper function that returns the caller's level + a
   set of `visible_user_ids` cheaply. Every SELECT on `prospects`/`activities`/
   etc. will run this per row, so it must be indexed and cached.

Both are doable; neither is a 30-minute task.

## Proposed approach (staged)

### Step 1: add `auth_user_id uuid` to `users`

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id
    ON users (auth_user_id) WHERE auth_user_id IS NOT NULL;
```

Backfill by matching on `LOWER(email)`:

```sql
UPDATE users u
SET auth_user_id = a.id
FROM auth.users a
WHERE u.auth_user_id IS NULL
  AND LOWER(u.email) = LOWER(a.email);
```

Add a trigger (or wire the app's signup flow) so new users get `auth_user_id`
populated at creation time.

### Step 2: helper functions

```sql
-- Returns the caller's level (1-14) or NULL if not linked.
CREATE OR REPLACE FUNCTION current_user_level() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
    lvl integer;
BEGIN
    SELECT (regexp_matches(role, 'Level\s+(\d+)'))[1]::integer
      INTO lvl
      FROM users
     WHERE auth_user_id = auth.uid()
     LIMIT 1;
    RETURN lvl;
END;
$$;

-- Returns the bigint users.id for the caller.
CREATE OR REPLACE FUNCTION current_user_row_id() RETURNS bigint
LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- Returns the set of user IDs the caller can see. Hard-coded hierarchy for
-- now; if the org tree grows to arbitrary depth, materialise it.
CREATE OR REPLACE FUNCTION current_user_visible_ids() RETURNS SETOF bigint
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
    lvl integer := current_user_level();
    me bigint := current_user_row_id();
BEGIN
    IF lvl IS NULL THEN RETURN; END IF;
    IF lvl <= 2 THEN
        -- Super Admin / Marketing Manager: see everyone
        RETURN QUERY SELECT id FROM users;
    ELSIF lvl <= 10 THEN
        -- Manager levels: self + direct reports + indirect reports
        -- Assumes users.reports_to references users.id
        RETURN QUERY
        WITH RECURSIVE tree AS (
            SELECT id FROM users WHERE id = me
            UNION
            SELECT u.id FROM users u JOIN tree t ON u.reports_to = t.id
        )
        SELECT id FROM tree;
    ELSE
        -- Agents (11-14): self only
        RETURN QUERY SELECT me;
    END IF;
END;
$$;
```

Grant the anon + authenticated roles EXECUTE on each function.

### Step 3: replace policies (one table at a time, with rollback)

For `prospects`:

```sql
-- Keep the old policy in place during rollout; remove ONLY after the new
-- one is proven to let the right users through.
CREATE POLICY "prospects_scoped_select_v2" ON prospects FOR SELECT TO authenticated
USING (
    responsible_agent_id IN (SELECT current_user_visible_ids())
    OR cps_agent_id IN (SELECT current_user_visible_ids())
);

CREATE POLICY "prospects_scoped_write_v2" ON prospects FOR INSERT TO authenticated
WITH CHECK (
    responsible_agent_id = current_user_row_id()
    OR current_user_level() <= 2
);

CREATE POLICY "prospects_scoped_update_v2" ON prospects FOR UPDATE TO authenticated
USING (
    responsible_agent_id IN (SELECT current_user_visible_ids())
    OR current_user_level() <= 2
);

CREATE POLICY "prospects_scoped_delete_v2" ON prospects FOR DELETE TO authenticated
USING (current_user_level() <= 5);
```

Rollback (if the app breaks):

```sql
DROP POLICY IF EXISTS "prospects_scoped_select_v2" ON prospects;
DROP POLICY IF EXISTS "prospects_scoped_write_v2" ON prospects;
DROP POLICY IF EXISTS "prospects_scoped_update_v2" ON prospects;
DROP POLICY IF EXISTS "prospects_scoped_delete_v2" ON prospects;
-- The original `auth_full_access` policy is still in place so the app keeps
-- working exactly as before.
```

Repeat for `customers`, `activities`, etc.

### Step 4: smoke test

- Log in as each role (Super Admin, Marketing Manager, Manager, Agent).
- Confirm each sees the right rows.
- Run the `prospects-table`, daily dashboard, reports, and CPS invite flows
  end-to-end.

### Step 5: retire the old policy

Once you've confirmed every role works for at least one full business day:

```sql
DROP POLICY IF EXISTS "auth_full_access" ON prospects;
-- Repeat for each hardened table.
```

## Cost check

`current_user_visible_ids()` is called per-row on scanned rows, which at
100K+ prospects is a perf risk. PostgreSQL inlines STABLE SECURITY DEFINER
functions in simple cases, but for safety:
- Run `EXPLAIN ANALYZE SELECT COUNT(*) FROM prospects` as each role after
  rollout.
- If latency spikes, rewrite the policy USING clause to expand the visible
  ID set inline rather than calling the function.

## Estimated work

- 2–3 hours to write + stage + manually test
- Needs a staging Supabase project or a maintenance window on prod
- Recommended: ship during a quiet evening with a DBA ready to rollback

## Decision

Not doing this now. Claude Code is a one-shot session; if a policy goes
wrong here, the app goes down for everyone until it's undone. Schedule a
dedicated session with someone who can sit at the DB and babysit the
rollout.
