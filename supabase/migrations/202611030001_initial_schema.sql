create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'manager', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
  );
$$;

create function public.is_org_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

create table public.subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan_key text not null default 'bronze' check (plan_key in ('bronze', 'essencial', 'gestao', 'rede')),
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'canceled', 'incomplete')),
  trial_ends_at date,
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('sale', 'expense')),
  description text not null check (char_length(description) between 1 and 140),
  category text not null check (char_length(category) between 1 and 60),
  amount numeric(14, 2) not null check (amount > 0),
  occurred_on date not null,
  payment_method text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index financial_entries_org_date_idx on public.financial_entries (organization_id, occurred_on desc);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  category text,
  unit text not null default 'un',
  cost_per_unit numeric(14, 4) not null default 0 check (cost_per_unit >= 0),
  sale_price numeric(14, 2) not null default 0 check (sale_price >= 0),
  stock_quantity numeric(14, 3) not null default 0 check (stock_quantity >= 0),
  minimum_stock numeric(14, 3) not null default 0 check (minimum_stock >= 0),
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  contact_name text,
  email text,
  phone text,
  category text,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.financial_commitments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('payable', 'receivable')),
  party_name text not null check (char_length(party_name) between 1 and 120),
  description text not null check (char_length(description) between 1 and 140),
  amount numeric(14, 2) not null check (amount > 0),
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'paid')),
  paid_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index financial_commitments_org_due_idx on public.financial_commitments (organization_id, due_date);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  selling_price numeric(14, 2) not null check (selling_price > 0),
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.recipe_ingredients (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(14, 4) not null check (quantity > 0),
  primary key (recipe_id, product_id)
);

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create function public.create_organization(organization_name text)
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
  values (created_organization_id, 'bronze', 'trial', current_date + 14);

  return created_organization_id;
end;
$$;

create function public.handle_new_user()
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
  values (created_organization_id, 'bronze', 'trial', current_date + 14);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;

  return jsonb_build_object(
    'organizations', (select count(*) from public.organizations),
    'subscriptions', (select count(*) from public.subscriptions),
    'active_trials', (select count(*) from public.subscriptions where status = 'trial' and trial_ends_at >= current_date)
  );
end;
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.financial_entries enable row level security;
alter table public.products enable row level security;
alter table public.suppliers enable row level security;
alter table public.financial_commitments enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.platform_admins enable row level security;

create policy "Members read organizations" on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy "Owners update organizations" on public.organizations
  for update to authenticated using (public.is_org_owner(id)) with check (public.is_org_owner(id));
create policy "Owners delete organizations" on public.organizations
  for delete to authenticated using (public.is_org_owner(id));

create policy "Members read membership" on public.organization_members
  for select to authenticated using (user_id = auth.uid() or public.is_org_member(organization_id));
create policy "Owners add membership" on public.organization_members
  for insert to authenticated with check (public.is_org_owner(organization_id));
create policy "Owners update membership" on public.organization_members
  for update to authenticated using (public.is_org_owner(organization_id)) with check (public.is_org_owner(organization_id));
create policy "Owners remove membership" on public.organization_members
  for delete to authenticated using (public.is_org_owner(organization_id) and user_id <> auth.uid());

create policy "Owners read subscriptions" on public.subscriptions
  for select to authenticated using (public.is_org_owner(organization_id));

create policy "Members manage financial entries" on public.financial_entries
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "Members manage products" on public.products
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "Members manage suppliers" on public.suppliers
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "Members manage commitments" on public.financial_commitments
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "Members manage recipes" on public.recipes
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

create policy "Members read recipe ingredients" on public.recipe_ingredients
  for select to authenticated using (
    exists (select 1 from public.recipes r where r.id = recipe_id and public.is_org_member(r.organization_id))
  );
create policy "Members insert recipe ingredients" on public.recipe_ingredients
  for insert to authenticated with check (
    exists (
      select 1
      from public.recipes r
      join public.products p on p.id = product_id and p.organization_id = r.organization_id
      where r.id = recipe_id and public.is_org_member(r.organization_id)
    )
  );
create policy "Members update recipe ingredients" on public.recipe_ingredients
  for update to authenticated using (
    exists (select 1 from public.recipes r where r.id = recipe_id and public.is_org_member(r.organization_id))
  ) with check (
    exists (
      select 1
      from public.recipes r
      join public.products p on p.id = product_id and p.organization_id = r.organization_id
      where r.id = recipe_id and public.is_org_member(r.organization_id)
    )
  );
create policy "Members delete recipe ingredients" on public.recipe_ingredients
  for delete to authenticated using (
    exists (select 1 from public.recipes r where r.id = recipe_id and public.is_org_member(r.organization_id))
  );

create policy "Users read own platform admin flag" on public.platform_admins
  for select to authenticated using (user_id = auth.uid());

grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.admin_overview() to authenticated;