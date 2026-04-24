# Push Reminder Notifications — Deploy Checklist

## Step 1 — Run the SQL migration
Open **Supabase → SQL Editor** and paste + run:
`migrations/add_notification_preferences.sql`

This creates:
- `notification_preferences` (user reminder choices)
- `notification_reminder_log` (deduplication — prevents double-firing)

## Step 2 — Deploy the new Edge Function
```bash
supabase functions deploy send-activity-reminders --project-ref <your-ref>
```
The function shares the same secrets already set for `send-activity-push`
(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL).
No new secrets needed.

## Step 3 — Schedule with pg_cron (in SQL Editor)

Replace `<SUPABASE_URL>` and `<SERVICE_ROLE_KEY>` with your actual values, then run:

```sql
-- Every 5 minutes: fire reminders + daily summary window check
SELECT cron.schedule(
    'activity-reminders',
    '*/5 * * * *',
    $$
    SELECT net.http_post(
        url     := 'https://<SUPABASE_URL>.supabase.co/functions/v1/send-activity-reminders',
        headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
        body    := '{}'::jsonb
    ) AS request_id;
    $$
);
```

To verify the cron is set:
```sql
SELECT jobname, schedule, active FROM cron.job;
```

To remove the cron later:
```sql
SELECT cron.unschedule('activity-reminders');
```

## How it works

| User chooses    | Edge function fires when activity is… |
|-----------------|---------------------------------------|
| 1 day before    | ~1440 min away (±3 min window)        |
| 1 hour before   | ~60 min away (±3 min window)          |
| 15 min before   | ~15 min away (±3 min window)          |
| 10 min before   | ~10 min away (±3 min window)          |
| Daily summary   | 10:00 AM MYT — lists today's events   |

- Each reminder fires **once per activity per user** (deduped via `notification_reminder_log`).
- Users set their preference in **Settings → Phone Push Notifications → Reminder Timing**.
- The edge function only sends to devices that have subscribed (`push_subscriptions` table).
