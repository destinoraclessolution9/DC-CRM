-- Meeting minutes (ChatGPT paste → auto-fill) + atomic meet-up photo append/remove.
--
-- 1. meeting_minutes jsonb on activities AND event_attendees (per-attendee
--    post-event notes use the same Minutes form). Shape (v1):
--      { v, raw, background, advisor, reaction, source, updated_at }
--    raw         = the full ChatGPT minutes the agent pasted (audit / re-parse)
--    background  = 客户背景  customer background
--    advisor     = 顾问观察与建议 advisor observations & suggestions
--    reaction    = 客户反应与DC记录 customer reaction & DC records
--    Key points / next actions / opportunities / grade / outcome keep living in
--    their existing columns — this column only holds what had no home before.
--
-- 2. append_activity_photos / remove_activity_photo — the Minutes "Discussion
--    Papers" and the Meet Up "Attach Photo" flows did a client-side
--    read-modify-write of activities.photo_urls from a per-tab pinned copy of the
--    row that is never refreshed after a write, so the SECOND upload in a session
--    wrote [stale + new] and silently dropped the first photo. These RPCs change
--    the array in ONE statement against the live row, so uploads/removals compose
--    (also across two devices).
--
-- SECURITY INVOKER (default): runs as the caller, so the existing activities
-- UPDATE RLS still applies — no privilege escalation. Returns the new array, or
-- NULL when RLS / a bad id matched no row (the client treats NULL as failure).
-- Additive only (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE FUNCTION).

ALTER TABLE public.activities      ADD COLUMN IF NOT EXISTS meeting_minutes jsonb;
ALTER TABLE public.event_attendees ADD COLUMN IF NOT EXISTS meeting_minutes jsonb;

CREATE OR REPLACE FUNCTION public.append_activity_photos(
  p_activity_id bigint,
  p_urls jsonb
) RETURNS jsonb
LANGUAGE sql
AS $$
  UPDATE public.activities a
     SET photo_urls = COALESCE(a.photo_urls, '[]'::jsonb) || COALESCE((
           SELECT jsonb_agg(u)
             FROM jsonb_array_elements(COALESCE(p_urls, '[]'::jsonb)) u
            WHERE NOT (COALESCE(a.photo_urls, '[]'::jsonb) @> jsonb_build_array(u))
         ), '[]'::jsonb),
         updated_at = now()
   WHERE a.id = p_activity_id
  RETURNING a.photo_urls;
$$;

CREATE OR REPLACE FUNCTION public.remove_activity_photo(
  p_activity_id bigint,
  p_url text
) RETURNS jsonb
LANGUAGE sql
AS $$
  UPDATE public.activities a
     SET photo_urls = COALESCE((
           SELECT jsonb_agg(e ORDER BY ord)
             FROM jsonb_array_elements(COALESCE(a.photo_urls, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
            WHERE e <> to_jsonb(p_url)
         ), '[]'::jsonb),
         updated_at = now()
   WHERE a.id = p_activity_id
  RETURNING a.photo_urls;
$$;

GRANT EXECUTE ON FUNCTION public.append_activity_photos(bigint, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_activity_photo(bigint, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
