-- NPO order atomicity (2026-07-03) — REVIEW BRANCH feat/npo-atomic-rpc
--
-- Replaces the client's 3 sequential inserts (npo_sales -> npo_sale_items ->
-- npo_installments) + best-effort compensating deletes with ONE server-side
-- transaction. A plpgsql function body is a single transaction, so if any insert
-- raises, ALL of them roll back — no orphan sale can survive a mid-sequence
-- failure, and a retry cannot stack duplicates.
--
-- SECURITY INVOKER: the function runs under the CALLING user's RLS, so it grants
-- no extra privilege — identical row-visibility/insert rights to the direct
-- inserts it replaces. `id` columns are GENERATED identity and are intentionally
-- NOT written. created_at defaults to now().
--
-- The client (chunks/script-npo.js) calls this via supabase.rpc('npo_create_order',
-- ...) and FALLS BACK to the legacy multi-insert path only when the function is
-- absent (error 42883 / PGRST202), so this migration and the client change can
-- deploy in either order without breaking saves.
--
-- APPLY: run in the Supabase SQL editor (project remuwhxvzkzjtgbzqjaa) or via the
-- Management API. Additive (CREATE FUNCTION) — safe.

CREATE OR REPLACE FUNCTION public.npo_create_order(
    p_sale         jsonb,
    p_items        jsonb,
    p_installments jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_sale_id bigint;
BEGIN
    INSERT INTO npo_sales (
        customer_id, customer_name, plan_id, tier_id, cart_total, tier_amount,
        overage, first_payment, monthly_amount, tenure_months, fulfillment_mode,
        redemption_period_months, start_date, status, responsible_agent_id, created_by
    )
    SELECT s.customer_id, s.customer_name, s.plan_id, s.tier_id, s.cart_total,
           s.tier_amount, s.overage, s.first_payment, s.monthly_amount, s.tenure_months,
           s.fulfillment_mode, s.redemption_period_months, s.start_date,
           COALESCE(s.status, 'active'), s.responsible_agent_id, s.created_by
    FROM jsonb_to_record(p_sale) AS s(
        customer_id bigint, customer_name text, plan_id bigint, tier_id bigint,
        cart_total numeric, tier_amount numeric, overage numeric, first_payment numeric,
        monthly_amount numeric, tenure_months integer, fulfillment_mode text,
        redemption_period_months integer, start_date date, status text,
        responsible_agent_id bigint, created_by bigint
    )
    RETURNING id INTO v_sale_id;

    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        INSERT INTO npo_sale_items (
            sale_id, product_id, product_name, qty, unit_price, line_total,
            redeem_after_months, delivery_status
        )
        SELECT v_sale_id, i.product_id, i.product_name, i.qty, i.unit_price,
               i.line_total, i.redeem_after_months, COALESCE(i.delivery_status, 'pending')
        FROM jsonb_to_recordset(p_items) AS i(
            product_id bigint, product_name text, qty integer, unit_price numeric,
            line_total numeric, redeem_after_months integer, delivery_status text
        );
    END IF;

    IF p_installments IS NOT NULL AND jsonb_array_length(p_installments) > 0 THEN
        INSERT INTO npo_installments (sale_id, seq, due_date, amount, status)
        SELECT v_sale_id, n.seq, n.due_date, n.amount, COALESCE(n.status, 'due')
        FROM jsonb_to_recordset(p_installments) AS n(
            seq integer, due_date date, amount numeric, status text
        );
    END IF;

    RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.npo_create_order(jsonb, jsonb, jsonb) TO authenticated;
