-- 2026-10-19 — CPS Paste Info: learn new Google Maps share links per venue.
-- A fresh maps.app.goo.gl link is resolved by the resolve-map-link Edge
-- Function; once the agent confirms the venue, the link (and the place's
-- position, if the venue has none yet) is saved so the next paste matches it.
-- Additive only.

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS lng double precision;

-- Append p_link to venues.map_links (space-separated) unless already there;
-- fill lat/lng only when empty. Atomic, so two agents can't drop each other's link.
CREATE OR REPLACE FUNCTION public.venue_add_map_link(p_venue_id bigint, p_link text, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
    UPDATE public.venues v
       SET map_links = CASE
                WHEN coalesce(trim(v.map_links), '') = '' THEN trim(p_link)
                WHEN trim(p_link) = ANY (regexp_split_to_array(trim(v.map_links), '[\s,]+')) THEN v.map_links
                ELSE trim(v.map_links) || ' ' || trim(p_link)
           END,
           lat = coalesce(v.lat, CASE WHEN p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 THEN p_lat END),
           lng = coalesce(v.lng, CASE WHEN p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 THEN p_lng END),
           updated_at = now()
     WHERE v.id = p_venue_id
       AND p_link ~* '^https://(maps\.app\.goo\.gl|goo\.gl/maps)/[A-Za-z0-9_/-]+$';
$$;

REVOKE ALL ON FUNCTION public.venue_add_map_link(bigint, text, double precision, double precision) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.venue_add_map_link(bigint, text, double precision, double precision) TO authenticated;
