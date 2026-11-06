-- Ajuste: único plano = bronze
-- Rode no SQL Editor do Supabase se as migrations antigas já foram aplicadas.

alter table public.subscriptions drop constraint if exists subscriptions_plan_key_check;

alter table public.subscriptions
  add constraint subscriptions_plan_key_check
  check (plan_key in ('bronze', 'essencial', 'gestao', 'rede'));

alter table public.subscriptions
  alter column plan_key set default 'bronze';

update public.subscriptions
set plan_key = 'bronze'
where plan_key in ('essencial', 'gestao', 'rede');
