-- E-Voucher generator — singleton template config + global atomic running-number counter.
-- Additive DDL (pre-authorized). Applied to live via Management API 2026-06-22.
--
-- One row (id=1) holds: the uploaded voucher template URL, the two field
-- placements (name + 序号) as jsonb, the running-number prefix, and the global
-- last_seq counter (NEVER resets — the running number only ever climbs).
-- Voucher images themselves are stored as prospect_attachments rows with
-- attachment_type='evoucher' (no schema change — reuses the existing table +
-- its metadata jsonb column).

create table if not exists public.evoucher_config (
  id           integer primary key default 1,
  template_url text,
  prefix       text not null default '169',
  name_field   jsonb not null default '{}'::jsonb,
  number_field jsonb not null default '{}'::jsonb,
  last_seq     bigint not null default 0,
  updated_at   timestamptz default now(),
  updated_by   bigint,
  constraint evoucher_config_singleton check (id = 1)
);

insert into public.evoucher_config (id) values (1) on conflict (id) do nothing;

grant select, insert, update on public.evoucher_config to authenticated;

alter table public.evoucher_config enable row level security;

-- Everyone signed in can READ the template (agents need it to generate).
drop policy if exists evoucher_config_sel on public.evoucher_config;
create policy evoucher_config_sel on public.evoucher_config
  for select to authenticated using (true);

-- Only admin / marketing-manager (level <= 2) may CHANGE the template config.
drop policy if exists evoucher_config_ins on public.evoucher_config;
create policy evoucher_config_ins on public.evoucher_config
  for insert to authenticated with check (current_user_level() <= 2);

drop policy if exists evoucher_config_upd on public.evoucher_config;
create policy evoucher_config_upd on public.evoucher_config
  for update to authenticated
  using (current_user_level() <= 2) with check (current_user_level() <= 2);

-- Atomic running-number issuer. SECURITY DEFINER so any authenticated agent can
-- claim the next number (row-locked increment) even though they can't edit the
-- config row. Two agents can never receive the same number.
create or replace function public.next_evoucher_number()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v bigint;
begin
  update public.evoucher_config
     set last_seq = last_seq + 1, updated_at = now()
   where id = 1
  returning last_seq into v;
  if v is null then
    insert into public.evoucher_config (id, last_seq) values (1, 1)
      on conflict (id) do update set last_seq = public.evoucher_config.last_seq + 1
      returning last_seq into v;
  end if;
  return v;
end;
$$;

grant execute on function public.next_evoucher_number() to authenticated;
