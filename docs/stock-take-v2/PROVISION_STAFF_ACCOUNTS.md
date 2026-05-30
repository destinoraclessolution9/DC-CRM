# Provision the 3 Stock Take Staff accounts

This guide creates the 3 per-store accounts you asked for. They land directly
on the **Stock Take** tab and only see **Per-shelf Count**, **Recount**, and
**Final Summary** — no admin setup, no other CRM modules.

| Username (email) | Display name | Password |
| --- | --- | --- |
| `001-wisma@destinoraclessolution.com` | 001 Wisma | (see step 1) |
| `002-bayavenue@destinoraclessolution.com` | 002 BayAvenue | (see step 1) |
| `003-bjpavillion@destinoraclessolution.com` | 003 BJPavillion | (see step 1) |

(Supabase Auth requires an email-shaped identifier — even if you don't actually
own the mailbox. Using `@destinoraclessolution.com` keeps them associated with
your domain and makes the username readable.)

---

## Step 0 — Apply the staff-role migration (one time)

Run `migrations/stock_take_v2_staff_role_2026-05-30.sql` in the Supabase SQL
editor (https://supabase.com/dashboard/project/remuwhxvzkzjtgbzqjaa/sql/new).
This grants Level 15 users SELECT on the lookup tables, SELECT on open
sessions, and INSERT on `st_counts`. Without it, RLS would reject every scan
they try to save.

```sql
-- one-liner verification after applying
select polname, polrelid::regclass, polcmd
  from pg_policy
 where polrelid::regclass::text like 'st_%'
 order by polrelid::regclass::text, polname;
```

You should see `st_admin_write`, `st_staff_select` (and `st_staff_insert` on
`st_counts`) for every table.

---

## Step 1 — ⚠️ Pick a real password

You asked for `12345678` — please don't ship that. It's the #1 most-leaked
password and Supabase Auth may even reject it.

Recommended pattern (still easy to type on a tablet):

| Account | Suggested password |
| --- | --- |
| 001 Wisma | `Wisma2026!stock` |
| 002 BayAvenue | `Bay2026!stock` |
| 003 BJPavillion | `BJP2026!stock` |

If you absolutely need a numeric-only password, use something like
`195638472` (random 9 digits) — anything but `12345678`.

For the rest of this guide I'll use a placeholder `<PASSWORD>`.

---

## Step 2 — Create the 3 Supabase Auth users (Dashboard)

1. Open
   https://supabase.com/dashboard/project/remuwhxvzkzjtgbzqjaa/auth/users
2. Click **Add user → Create new user**.
3. For each of the 3 accounts:
   - **Email**: e.g. `001-wisma@destinoraclessolution.com`
   - **Password**: your chosen password
   - **Auto-confirm user**: ✓ ON (so they can sign in immediately without an
     email confirmation round trip)
4. Repeat for `002-bayavenue@…` and `003-bjpavillion@…`.

---

## Step 3 — Insert matching `public.users` rows (one SQL block)

Run this in the SQL editor. It looks up each auth user by email and creates the
profile row with role `Level 15 Stock Take Staff`. Idempotent — safe to re-run
if you need to adjust.

```sql
-- Adjust the FROM clause if you used different emails in step 2.
with auth_pairs as (
    select id as auth_user_id, email
      from auth.users
     where email in (
         '001-wisma@destinoraclessolution.com',
         '002-bayavenue@destinoraclessolution.com',
         '003-bjpavillion@destinoraclessolution.com'
     )
)
insert into public.users (auth_user_id, email, full_name, role, status, created_at)
select
    ap.auth_user_id,
    ap.email,
    case ap.email
        when '001-wisma@destinoraclessolution.com'       then '001 Wisma'
        when '002-bayavenue@destinoraclessolution.com'   then '002 BayAvenue'
        when '003-bjpavillion@destinoraclessolution.com' then '003 BJPavillion'
    end                                          as full_name,
    'Level 15 Stock Take Staff'                  as role,
    'active'                                     as status,
    now()                                        as created_at
  from auth_pairs ap
 on conflict (auth_user_id) do update
   set role = excluded.role,
       full_name = excluded.full_name,
       status = 'active';

-- Verify:
select email, full_name, role, status from public.users
 where email like '00%-%@destinoraclessolution.com'
 order by email;
```

The role string `Level 15 Stock Take Staff` is what the CRM parses; the
display name is what shows up in the corner avatar.

---

## Step 4 — Test the login

1. Open https://destinoraclessolution.com in an incognito window.
2. Sign in as `001-wisma@destinoraclessolution.com` / your password.
3. You should land on the dashboard with **only the Stock Take item** in the
   left sidebar.
4. Open Stock Take. You should see only 3 sub-tabs: **Per-shelf Count**,
   **Recount**, **Final Summary**. The Sessions / Shelves (v2) / System Stock
   / Exclusions / Bulk Physical / Reconciliation tabs should be hidden.
5. If a Super Admin has an open session, the staff account picks it up
   automatically. Otherwise, they see "Activate a session first" — that means
   you need to open a session from the admin account before they can count.

---

## Step 5 — Hand off

Print or message this card to each staff member:

```
URL      :  https://destinoraclessolution.com
Email    :  001-wisma@destinoraclessolution.com
Password :  <PASSWORD>

To count stock:
  1. Tap Stock Take in the left menu
  2. Tap Per-shelf Count
  3. Tap "Scan Shelf" (purple button at top)
  4. Point the camera at the shelf's QR label
  5. Enter quantities for each product, hit Save
```

---

## Revoking access

If a staff account needs to be disabled, run:

```sql
update public.users
   set status = 'inactive'
 where email = '001-wisma@destinoraclessolution.com';
```

To fully delete, also remove from `auth.users` via the Supabase Dashboard
(Authentication → Users → … → Delete user).

---

## What Level 15 can and cannot do

| Action                          | Level 1 Super Admin | Level 15 Stock Take Staff |
| --- | --- | --- |
| See the Stock Take tab          | yes | yes |
| Per-shelf Count + Scan Shelf    | yes | yes |
| Recount existing items          | yes | yes |
| View Final Summary              | yes | yes |
| Open / close / delete sessions  | yes | **no** |
| Manage Shelves (v2) master      | yes | **no** |
| Import System Stock             | yes | **no** |
| Manage Exclusions               | yes | **no** |
| Upload Bulk Physical Excel      | yes | **no** |
| View Reconciliation tab         | yes | **no** |
| Accept Variances baseline       | yes | **no** |
| Any other CRM module            | yes | **no** |

Enforcement happens in two places:
- **UI** — `showStockTakeView` only renders the 3 staff tabs for Level 15
  (script.js)
- **Database RLS** — `st_admin_write` policies on `st_stores`, `st_shelves`,
  `st_product_master`, `st_shelf_expected`, `st_sessions`, `st_bulk_uploads`,
  `st_variance_reasons`, `st_exclusions` reject any INSERT/UPDATE/DELETE
  from Level 15 even if a malicious client bypasses the UI
  (migrations/stock_take_v2_staff_role_2026-05-30.sql)
