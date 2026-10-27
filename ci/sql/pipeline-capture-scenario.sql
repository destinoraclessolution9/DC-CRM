-- Scenario test for migrations/2026-10-27_pipeline_capture.sql and
-- 2026-10-27_chuanfu_board.sql. One DO block that ALWAYS raises (rolled back).
-- Result: PIPELINE_CAPTURE_RESULT {"pass","fail","failures"}
do $$
declare
    v_agent bigint;
    v_auth  uuid;
    v_p     bigint := 990000000001001;   -- the buyer
    v_ref   bigint := 990000000001002;   -- a client who introduces people
    v_new1  bigint := 990000000001003;   -- introduced by v_ref (agent as "Referred By")
    v_new2  bigint := 990000000001004;   -- referred by v_ref directly
    v_new3  bigint := 990000000001005;   -- agent, own contact
    v_act   bigint := 990000000001011;
    v_today date := public.journey_today();
    v_rm numeric; v_det jsonb; v_n int; v_b boolean; r record;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    select u.id, u.auth_user_id into v_agent, v_auth from public.users u
     where u.role_level between 3 and 5 and u.auth_user_id is not null order by u.id limit 1;
    perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);

    -- 1. names: codes / old names / typo resolve; generic plans do not
    if (select name from public.products where id = public.product_resolve('PR6')) like '六曜%'
       and (select name from public.products where id = public.product_resolve('PR4')) like '文昌%'
       and (select name from public.products where id = public.product_resolve('积仓富')) = '积仓富 Ji Cang Fu'
       and (select name from public.products where id = public.product_resolve('天之喜3')) like '天至喜3%'
       and public.product_resolve('灵活 Flexible Plan') is null and public.product_resolve('PR10') is null
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'product_resolve'::text; end if;

    -- 2. a meeting ticking "PR6" + a 专案 plan: PR6 counts at list price, the plan needs a quote
    insert into public.prospects (id, full_name, phone, status, responsible_agent_id) values
        (v_p, 'TEST buyer (Claude)', '+60990000001001', 'active', v_agent);
    insert into public.activities (id, prospect_id, activity_type, activity_title, activity_date, lead_agent_id, opportunity_potential)
    values (v_act, v_p, 'FTF', 'TEST', v_today - 1, v_agent, '[Products] PR6, 专案-排屋 Terrace House (Direct On)');
    select open_potential_rm, open_potential_detail into v_rm, v_det from public.prospects where id = v_p;
    if v_rm = 18990 and (v_det->>'unpriced')::int = 1 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('before quote ' || v_rm || ' ' || coalesce(v_det::text, '-')); end if;

    -- 3. quoted RM: beats the list price and prices the plan
    update public.activities set quoted_prices = jsonb_build_object('PR6', 15000, '专案-排屋 Terrace House (Direct On)', 58980) where id = v_act;
    select open_potential_rm, open_potential_detail into v_rm, v_det from public.prospects where id = v_p;
    if v_rm = 73980 and (v_det->>'unpriced')::int = 0 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('after quote ' || v_rm); end if;
    -- a junk quote is ignored (falls back to the list price)
    update public.activities set quoted_prices = jsonb_build_object('PR6', 'abc') where id = v_act;
    select open_potential_rm into v_rm from public.prospects where id = v_p;
    if v_rm = 18990 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('junk quote ' || v_rm); end if;

    -- 4. 传福者 credit: introduced_by beats an agent "Referred By"; a client referrer counts; own contact does not
    insert into public.prospects (id, full_name, phone, status, responsible_agent_id) values
        (v_ref, 'TEST introducer (Claude)', '+60990000001002', 'active', v_agent);
    insert into public.prospects (id, full_name, phone, status, responsible_agent_id, referred_by_type, referred_by_id, introduced_by_type, introduced_by_id) values
        (v_new1, 'TEST new 1 (Claude)', '+60990000001003', 'active', v_agent, 'Consultant', v_agent, 'Prospect', v_ref),
        (v_new2, 'TEST new 2 (Claude)', '+60990000001004', 'active', v_agent, 'Prospect', v_ref, null, null),
        (v_new3, 'TEST new 3 (Claude)', '+60990000001005', 'active', v_agent, 'Consultant', v_agent, 'Own', null);
    insert into public.activities (id, prospect_id, activity_type, activity_title, activity_date, lead_agent_id) values
        (990000000001021, v_new1, 'CPS', 'TEST CPS', v_today, v_agent),
        (990000000001022, v_new2, 'CPS', 'TEST CPS', v_today, v_agent),
        (990000000001023, v_new3, 'CPS', 'TEST CPS', v_today, v_agent);
    select * into r from public.chuanfu_board(v_today, v_today) b where b.person_key = 'p:' || v_ref;
    if r.cps_period = 2 and r.referred_total = 2 and not r.is_member then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('board ' || coalesce(r.cps_period::text, 'none')); end if;
    select * into r from public.chuanfu_summary(v_today, v_today);
    if r.cps_total >= 3 and r.own_contact >= 1 and r.from_clients >= 2 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('summary ' || r::text); end if;

    -- 5. promote / remove
    v_b := public.chuanfu_promote('p:' || v_ref, true);
    select is_member into v_b from public.chuanfu_board(v_today, v_today) b where b.person_key = 'p:' || v_ref;
    if v_b then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'promote'::text; end if;
    perform public.chuanfu_promote('p:' || v_ref, false);
    if not exists (select 1 from public.chuanfu_members where person_key = 'p:' || v_ref) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'unpromote'::text; end if;
    if not public.chuanfu_promote('x:1', true) then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'bad key accepted'::text; end if;

    -- 6. link text-only referrers: exact text (any case) in scope; then they count
    insert into public.prospects (id, full_name, phone, status, responsible_agent_id, referred_by) values
        (990000000001006, 'TEST typed 1 (Claude)', '+60990000001006', 'active', v_agent, 'test introducer (claude)'),
        (990000000001007, 'TEST typed 2 (Claude)', '+60990000001007', 'active', v_agent, '  TEST Introducer (Claude) ');
    select people into v_n from public.referrer_unlinked(500) u where lower(btrim(u.ref_text)) = 'test introducer (claude)';
    if v_n = 2 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('unlinked ' || coalesce(v_n::text, 'none')); end if;
    v_n := public.referrer_link('Test Introducer (Claude)', 'Prospect', v_ref);
    if v_n = 2 and (select count(*) from public.prospects where id in (990000000001006, 990000000001007) and referred_by_id = v_ref and referred_by_type = 'Prospect') = 2
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('link ' || v_n); end if;
    select referred_total into v_n from public.chuanfu_board(null, null) b where b.person_key = 'p:' || v_ref;
    if v_n = 4 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('after link total ' || coalesce(v_n::text, '-')); end if;

    -- 7. an agent (L6+) cannot promote or link
    perform set_config('request.jwt.claims', json_build_object('sub',
        (select auth_user_id from public.users where role_level between 6 and 12 and auth_user_id is not null order by id limit 1), 'role', 'authenticated')::text, true);
    if not public.chuanfu_promote('p:' || v_ref, true) and public.referrer_link('x', 'Prospect', v_ref) = 0
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'agent could promote/link'::text; end if;

    raise exception 'PIPELINE_CAPTURE_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
