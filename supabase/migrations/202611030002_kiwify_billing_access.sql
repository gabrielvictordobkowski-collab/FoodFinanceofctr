alter table public.subscriptions
  add column if not exists provider text,
  add column if not exists product_id text,
  add column if not exists buyer_email text,
  add column if not exists access_until timestamptz;

create unique index if not exists subscriptions_provider_subscription_idx
  on public.subscriptions (provider_subscription_id)
  where provider_subscription_id is not null;

create table if not exists public.billing_webhook_events (
  event_key text primary key,
  provider text not null check (provider = 'kiwify'),
  event_type text not null,
  order_id text not null,
  subscription_id text,
  payload_sha256 text not null,
  result text not null default 'received' check (result in ('received', 'applied', 'unmatched', 'ignored')),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_webhook_events from public, anon, authenticated;
grant all on public.billing_webhook_events to service_role;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and lower(u.email) = 'gabrieldobkowski@gmail.com'
  ) or exists (
    select 1
    from public.platform_admins p
    where p.user_id = auth.uid()
  );
$$;

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
        and (
          (s.status = 'trial' and s.trial_ends_at >= current_date)
          or (s.status = 'active' and s.access_until > now())
        )
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
    when s.status = 'trial' and s.trial_ends_at >= current_date then 1
    when s.status = 'past_due' then 2
    else 3
  end, s.created_at
  limit 1;

  return jsonb_build_object(
    'is_admin', exempt,
    'has_access', exempt or coalesce(
      (current_subscription.status = 'trial' and current_subscription.trial_ends_at >= current_date)
      or (current_subscription.status = 'active' and current_subscription.access_until > now()),
      false
    ),
    'plan_key', current_subscription.plan_key,
    'status', current_subscription.status,
    'trial_ends_at', current_subscription.trial_ends_at,
    'access_until', current_subscription.access_until
  );
end;
$$;

create or replace function public.create_organization(organization_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_organization_id uuid;
  has_existing_subscription boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if char_length(trim(organization_name)) not between 1 and 120 then
    raise exception 'Organization name must contain between 1 and 120 characters';
  end if;

  select exists (
    select 1
    from public.organizations existing_organization
    join public.subscriptions existing_subscription on existing_subscription.organization_id = existing_organization.id
    where existing_organization.owner_user_id = auth.uid()
  ) into has_existing_subscription;

  insert into public.organizations (owner_user_id, name)
  values (auth.uid(), trim(organization_name))
  returning id into created_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (created_organization_id, auth.uid(), 'owner');

  insert into public.subscriptions (organization_id, plan_key, status, trial_ends_at)
  values (
    created_organization_id,
    'bronze',
    case when has_existing_subscription then 'incomplete' else 'trial' end,
    case when has_existing_subscription then null else current_date + 14 end
  );

  return created_organization_id;
end;
$$;

create or replace function public.process_kiwify_event(
  event_key text,
  event_type text,
  order_id text,
  subscription_id text,
  buyer_email text,
  product_id text,
  plan_key text,
  order_status text,
  access_until timestamptz,
  has_access boolean,
  payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_event_key text;
  prior_result text;
  billing_organization_id uuid;
  current_plan text;
  normalized_email text := lower(trim(coalesce(buyer_email, '')));
  next_status text;
  next_access_until timestamptz;
  updated_subscriptions integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if event_type not in (
    'order_approved', 'order_rejected', 'order_refunded', 'chargeback',
    'subscription_renewed', 'subscription_late', 'subscription_canceled'
  ) then
    raise exception 'Unsupported Kiwify event';
  end if;

  insert into public.billing_webhook_events (
    event_key, provider, event_type, order_id, subscription_id, payload_sha256
  ) values (
    event_key, 'kiwify', event_type, order_id, subscription_id, payload_sha256
  ) on conflict (event_key) do nothing
  returning event_key into inserted_event_key;

  if inserted_event_key is null then
    select result into prior_result
    from public.billing_webhook_events
    where billing_webhook_events.event_key = process_kiwify_event.event_key;
    if prior_result in ('applied', 'ignored') then
      return jsonb_build_object('result', 'duplicate');
    end if;
  end if;

  if event_type in ('subscription_renewed', 'subscription_late', 'subscription_canceled', 'order_refunded', 'chargeback')
     and subscription_id is null then
    update public.billing_webhook_events
    set result = 'ignored', processed_at = now()
    where billing_webhook_events.event_key = process_kiwify_event.event_key;
    return jsonb_build_object('result', 'ignored');
  end if;

  if process_kiwify_event.plan_key is not null
     and process_kiwify_event.plan_key not in ('bronze', 'essencial', 'gestao', 'rede') then
    raise exception 'Unsupported FoodFinance plan';
  end if;

  if subscription_id is not null then
    select organization_id, subscriptions.plan_key
      into billing_organization_id, current_plan
    from public.subscriptions
    where provider_subscription_id = subscription_id
    for update;
  end if;

  if billing_organization_id is null and normalized_email <> '' then
    select o.id, s.plan_key
      into billing_organization_id, current_plan
    from public.organizations o
    join auth.users u on u.id = o.owner_user_id
    left join public.subscriptions s on s.organization_id = o.id
    where lower(u.email) = normalized_email
    order by o.created_at asc
    limit 1
    for update of o;
  end if;

  if billing_organization_id is null then
    update public.billing_webhook_events
    set result = 'unmatched', processed_at = now()
    where billing_webhook_events.event_key = process_kiwify_event.event_key;
    return jsonb_build_object('result', 'unmatched');
  end if;

  if event_type in ('order_approved', 'subscription_renewed') then
    if subscription_id is null or access_until is null or access_until <= now()
       or order_status <> 'paid' or coalesce(has_access, false) is false then
      raise exception 'A valid paid subscription period is required';
    end if;
    next_status := 'active';
    next_access_until := access_until;
  elsif event_type = 'subscription_late' then
    next_status := 'past_due';
    next_access_until := access_until;
  elsif event_type in ('subscription_canceled', 'order_refunded', 'chargeback') then
    next_status := 'canceled';
    if event_type = 'subscription_canceled' and coalesce(has_access, false) and access_until > now() then
      next_access_until := access_until;
    else
      next_access_until := now();
    end if;
  else
    update public.billing_webhook_events
    set result = 'ignored', processed_at = now()
    where billing_webhook_events.event_key = process_kiwify_event.event_key;
    return jsonb_build_object('result', 'ignored');
  end if;

  update public.subscriptions
  set status = next_status,
      access_until = next_access_until,
      provider = 'kiwify',
      provider_subscription_id = coalesce(subscription_id, provider_subscription_id),
      buyer_email = nullif(normalized_email, ''),
      product_id = coalesce(process_kiwify_event.product_id, public.subscriptions.product_id),
      plan_key = coalesce(process_kiwify_event.plan_key, current_plan, public.subscriptions.plan_key),
      updated_at = now()
  where organization_id = billing_organization_id;

  get diagnostics updated_subscriptions = row_count;
  if updated_subscriptions = 0 then
    raise exception 'Subscription record not found for Kiwify event';
  end if;

  update public.billing_webhook_events
  set result = 'applied', processed_at = now()
  where billing_webhook_events.event_key = process_kiwify_event.event_key;

  return jsonb_build_object('result', 'applied', 'organization_id', billing_organization_id);
end;
$$;

drop policy if exists "Members read organizations" on public.organizations;
drop policy if exists "Owners update organizations" on public.organizations;
drop policy if exists "Owners delete organizations" on public.organizations;
drop policy if exists "Owners and admins update organizations" on public.organizations;
drop policy if exists "Owners and admins delete organizations" on public.organizations;
create policy "Members and admins read organizations" on public.organizations
  for select to authenticated using (public.is_org_member(id) or public.is_platform_admin());
create policy "Platform admins update organizations" on public.organizations
  for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "Platform admins delete organizations" on public.organizations
  for delete to authenticated using (public.is_platform_admin());

drop policy if exists "Members read membership" on public.organization_members;
drop policy if exists "Owners add membership" on public.organization_members;
drop policy if exists "Owners update membership" on public.organization_members;
drop policy if exists "Owners remove membership" on public.organization_members;
create policy "Members and admins read membership" on public.organization_members
  for select to authenticated using (user_id = auth.uid() or public.is_org_member(organization_id) or public.is_platform_admin());
create policy "Owners and admins add membership" on public.organization_members
  for insert to authenticated with check (public.is_org_owner(organization_id) or public.is_platform_admin());
create policy "Owners and admins update membership" on public.organization_members
  for update to authenticated using (public.is_org_owner(organization_id) or public.is_platform_admin())
  with check (public.is_org_owner(organization_id) or public.is_platform_admin());
create policy "Owners and admins remove membership" on public.organization_members
  for delete to authenticated using ((public.is_org_owner(organization_id) and user_id <> auth.uid()) or public.is_platform_admin());

drop policy if exists "Owners read subscriptions" on public.subscriptions;
create policy "Members and admins read subscriptions" on public.subscriptions
  for select to authenticated using (public.is_org_owner(organization_id) or public.is_platform_admin());

drop policy if exists "Members manage financial entries" on public.financial_entries;
create policy "Entitled members manage financial entries" on public.financial_entries
  for all to authenticated using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));
drop policy if exists "Members manage products" on public.products;
create policy "Entitled members manage products" on public.products
  for all to authenticated using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));
drop policy if exists "Members manage suppliers" on public.suppliers;
create policy "Entitled members manage suppliers" on public.suppliers
  for all to authenticated using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));
drop policy if exists "Members manage commitments" on public.financial_commitments;
create policy "Entitled members manage commitments" on public.financial_commitments
  for all to authenticated using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));
drop policy if exists "Members manage recipes" on public.recipes;
create policy "Entitled members manage recipes" on public.recipes
  for all to authenticated using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

drop policy if exists "Members read recipe ingredients" on public.recipe_ingredients;
drop policy if exists "Members insert recipe ingredients" on public.recipe_ingredients;
drop policy if exists "Members update recipe ingredients" on public.recipe_ingredients;
drop policy if exists "Members delete recipe ingredients" on public.recipe_ingredients;
create policy "Entitled members read recipe ingredients" on public.recipe_ingredients
  for select to authenticated using (
    exists (select 1 from public.recipes r where r.id = recipe_id and public.has_org_access(r.organization_id))
  );
create policy "Entitled members insert recipe ingredients" on public.recipe_ingredients
  for insert to authenticated with check (
    exists (
      select 1
      from public.recipes r
      join public.products p on p.id = product_id and p.organization_id = r.organization_id
      where r.id = recipe_id and public.has_org_access(r.organization_id)
    )
  );
create policy "Entitled members update recipe ingredients" on public.recipe_ingredients
  for update to authenticated using (
    exists (select 1 from public.recipes r where r.id = recipe_id and public.has_org_access(r.organization_id))
  ) with check (
    exists (
      select 1
      from public.recipes r
      join public.products p on p.id = product_id and p.organization_id = r.organization_id
      where r.id = recipe_id and public.has_org_access(r.organization_id)
    )
  );
create policy "Entitled members delete recipe ingredients" on public.recipe_ingredients
  for delete to authenticated using (
    exists (select 1 from public.recipes r where r.id = recipe_id and public.has_org_access(r.organization_id))
  );

revoke all on function public.process_kiwify_event(text, text, text, text, text, text, text, text, timestamptz, boolean, text) from public, anon, authenticated;
grant execute on function public.process_kiwify_event(text, text, text, text, text, text, text, text, timestamptz, boolean, text) to service_role;
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.is_org_owner(uuid) from public, anon;
revoke all on function public.has_org_access(uuid) from public, anon;
revoke all on function public.get_org_entitlement(uuid) from public, anon;
revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.create_organization(text) from public, anon;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;
grant execute on function public.has_org_access(uuid) to authenticated;
grant execute on function public.get_org_entitlement(uuid) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.admin_overview() to authenticated;