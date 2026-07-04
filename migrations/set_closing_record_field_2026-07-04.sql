-- Atomic single-key merge into prospects.closing_record (audit fix customers:2242).
-- _setDelivery / saveDeliveryRemarks did read-modify-write of the WHOLE closing_record
-- JSON, so a near-simultaneous status edit and remarks edit clobbered each other. This
-- RPC merges ONE key server-side via jsonb_set, so concurrent per-field edits compose.
--
-- SECURITY INVOKER (default): runs as the caller, so the existing prospects UPDATE RLS
-- still applies — no privilege escalation. Additive (CREATE OR REPLACE), pre-authorized.
CREATE OR REPLACE FUNCTION public.set_closing_record_field(
  p_prospect_id bigint,
  p_key text,
  p_value jsonb
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.prospects
     SET closing_record = jsonb_set(COALESCE(closing_record, '{}'::jsonb), ARRAY[p_key], p_value, true),
         updated_at = now()
   WHERE id = p_prospect_id;
$$;

GRANT EXECUTE ON FUNCTION public.set_closing_record_field(bigint, text, jsonb) TO authenticated;
