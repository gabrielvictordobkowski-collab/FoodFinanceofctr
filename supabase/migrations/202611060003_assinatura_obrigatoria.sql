-- FoodFinance: assinatura obrigatória (sem período de avaliação grátis).
-- Rode UMA vez no SQL Editor do Supabase (depois das migrations anteriores).
-- Quem não tem assinatura ativa continua logando, mas não acessa os recursos.
-- O administrador (gabrieldobkowski@gmail.com) continua isento.

-- 1) Cadastros novos nascem SEM acesso até pagar.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  created_organization_id uuid;
  business_name text;
begin
  business_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'business_name'), ''), 'Minha empresa');

  insert into public.organizations (owner_user_id, name)
  values (new.id, left(business_name, 120))
  returning id into created_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (created_organization_id, new.id, 'owner');

  insert into public.subscriptions (organization_id, plan_key, status, trial_ends_at)
  values (created_organization_id, 'bronze', 'incomplete', null);

  return new;
end;
$$;

-- 2) Novas empresas também nascem sem acesso.
create or replace function public.create_organization(organization_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_organization_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if char_length(trim(organization_name)) not between 1 and 120 then
    raise exception 'Organization name must contain between 1 and 120 characters';
  end if;

  insert into public.organizations (owner_user_id, name)
  values (auth.uid(), trim(organization_name))
  returning id into created_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (created_organization_id, auth.uid(), 'owner');

  insert into public.subscriptions (organization_id, plan_key, status, trial_ends_at)
  values (created_organization_id, 'bronze', 'incomplete', null);

  return created_organization_id;
end;
$$;

-- 3) Só assinatura ativa libera os dados (o trial deixa de contar).
create or replace function public.has_org_access(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin() or (
    public.is_org_member(target_organization_id)
    and exists (
      select 1
      from public.subscriptions s
      join public.organizations billing_org on billing_org.id = s.organization_id
      join public.organizations target_org on target_org.id = target_organization_id
      where billing_org.owner_user_id = target_org.owner_user_id
        and s.status = 'active'
        and s.access_until > now()
    )
  );
$$;

create or replace function public.get_org_entitlement(target_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_subscription public.subscriptions%rowtype;
  exempt boolean;
begin
  exempt := public.is_platform_admin();
  if not exempt and not public.is_org_member(target_organization_id) then
    raise exception 'Organization access required';
  end if;

  select s.* into current_subscription
  from public.subscriptions s
  join public.organizations billing_org on billing_org.id = s.organization_id
  join public.organizations target_org on target_org.id = target_organization_id
  where billing_org.owner_user_id = target_org.owner_user_id
  order by case
    when s.status = 'active' and s.access_until > now() then 0
    when s.status = 'past_due' then 1
    else 2
  end, s.created_at
  limit 1;

  return jsonb_build_object(
    'is_admin', exempt,
    'has_access', exempt or coalesce(
      current_subscription.status = 'active' and current_subscription.access_until > now(),
      false
    ),
    'plan_key', current_subscription.plan_key,
    'status', current_subscription.status,
    'trial_ends_at', current_subscription.trial_ends_at,
    'access_until', current_subscription.access_until
  );
end;
$$;

-- 4) Contas que ainda estavam em avaliação passam a exigir assinatura.
update public.subscriptions
set status = 'incomplete', trial_ends_at = null, updated_at = now()
where status = 'trial';
