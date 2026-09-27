create extension if not exists pgcrypto;

create type public.campaign_status as enum ('Draft', 'Active', 'Paused', 'Finished');
create type public.order_status as enum ('New', 'Converted', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled', 'Returned');
create type public.customer_type as enum ('New', 'Returning');
create type public.member_role as enum ('owner', 'admin', 'operator', 'viewer');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'operator',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create or replace function public.add_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (organization_id, user_id) do nothing;
  return new;
end;
$$;

create trigger add_organization_owner_after_insert
after insert on public.organizations
for each row execute function public.add_organization_owner();

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  brand_product text,
  platform text,
  ad_type text,
  objective text,
  start_date date,
  end_date date,
  status public.campaign_status not null default 'Active',
  target_cpa_delivered numeric(12, 2) not null default 0,
  target_roas numeric(10, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.daily_ad_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_code text,
  date date not null,
  platform text,
  spend numeric(12, 2) not null default 0,
  impressions integer not null default 0,
  clicks integer not null default 0,
  conversations integer not null default 0,
  leads integer not null default 0,
  add_to_cart integer not null default 0,
  platform_purchases integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, campaign_code) references public.campaigns(organization_id, code) on update cascade on delete restrict
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text not null,
  second_phone text,
  city text,
  address text,
  customer_type public.customer_type not null default 'New',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category text,
  default_cost numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_number text not null,
  order_date date not null default current_date,
  campaign_code text not null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  channel text,
  new_acquisition boolean not null default false,
  status public.order_status not null default 'New',
  discount numeric(12, 2) not null default 0,
  shipping_collected numeric(12, 2) not null default 0,
  packaging_cost numeric(12, 2) not null default 0,
  outbound_shipping_paid numeric(12, 2) not null default 0,
  cod_payment_fee numeric(12, 2) not null default 0,
  failed_return_cost numeric(12, 2) not null default 0,
  other_variable_cost numeric(12, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, order_number),
  foreign key (organization_id, campaign_code) references public.campaigns(organization_id, code) on update cascade on delete restrict
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  size text not null,
  color text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null default 0,
  unit_cost numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  changed_at timestamptz not null default now(),
  note text
);

create index campaigns_organization_code_idx on public.campaigns (organization_id, code);
create index daily_ad_metrics_campaign_date_idx on public.daily_ad_metrics (organization_id, campaign_code, date);
create index orders_campaign_status_idx on public.orders (organization_id, campaign_code, status);
create index order_items_size_idx on public.order_items (organization_id, size);
create index order_status_events_order_idx on public.order_status_events (order_id, changed_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_campaigns_updated_at before update on public.campaigns
for each row execute function public.touch_updated_at();

create trigger touch_daily_ad_metrics_updated_at before update on public.daily_ad_metrics
for each row execute function public.touch_updated_at();

create trigger touch_customers_updated_at before update on public.customers
for each row execute function public.touch_updated_at();

create trigger touch_products_updated_at before update on public.products
for each row execute function public.touch_updated_at();

create trigger touch_orders_updated_at before update on public.orders
for each row execute function public.touch_updated_at();

create or replace function public.user_is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = target_organization_id
      and member.user_id = auth.uid()
  );
$$;

create or replace function public.user_can_manage_org(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = target_organization_id
      and member.user_id = auth.uid()
      and member.role in ('owner', 'admin', 'operator')
  );
$$;

create view public.order_financials
with (security_invoker = true)
as
select
  orders.id as order_id,
  orders.organization_id,
  coalesce(sum(order_items.quantity * order_items.unit_price), 0) as gross_product_sales,
  coalesce(sum(order_items.quantity * order_items.unit_cost), 0) as product_cost,
  case
    when orders.status = 'Delivered'
      then greatest(0, coalesce(sum(order_items.quantity * order_items.unit_price), 0) - orders.discount) + orders.shipping_collected
    else 0
  end as final_revenue,
  orders.packaging_cost + orders.outbound_shipping_paid + orders.cod_payment_fee + orders.failed_return_cost + orders.other_variable_cost as variable_costs,
  case when orders.status = 'Delivered' then coalesce(sum(order_items.quantity * order_items.unit_cost), 0) else 0 end as recognized_cogs,
  case
    when orders.status = 'Delivered'
      then greatest(0, coalesce(sum(order_items.quantity * order_items.unit_price), 0) - orders.discount) + orders.shipping_collected
    else 0
  end
  - case when orders.status = 'Delivered' then coalesce(sum(order_items.quantity * order_items.unit_cost), 0) else 0 end
  - (orders.packaging_cost + orders.outbound_shipping_paid + orders.cod_payment_fee + orders.failed_return_cost + orders.other_variable_cost) as contribution_before_ads
from public.orders
left join public.order_items on order_items.order_id = orders.id
group by orders.id;

create view public.campaign_performance
with (security_invoker = true)
as
with ad_rollup as (
  select
    organization_id,
    campaign_code,
    sum(spend) as ad_spend,
    sum(impressions) as impressions,
    sum(clicks) as clicks,
    sum(conversations) as conversations,
    sum(leads) as leads
  from public.daily_ad_metrics
  group by organization_id, campaign_code
),
order_rollup as (
  select
    orders.organization_id,
    orders.campaign_code,
    count(*) as orders_created,
    count(*) filter (where orders.status in ('Confirmed', 'Shipped', 'Delivered', 'Returned')) as confirmed_funnel,
    count(*) filter (where orders.status in ('Shipped', 'Delivered', 'Returned')) as shipped_funnel,
    count(*) filter (where orders.status = 'Delivered') as delivered_orders,
    count(*) filter (where orders.status = 'Cancelled') as cancelled_orders,
    count(*) filter (where orders.status = 'Returned') as returned_orders,
    count(*) filter (where orders.new_acquisition and orders.status = 'Delivered') as new_customers_delivered,
    sum(order_financials.final_revenue) as delivered_revenue,
    sum(order_financials.recognized_cogs) as delivered_cogs,
    sum(order_financials.variable_costs) as order_variable_costs,
    sum(order_financials.contribution_before_ads) as contribution_before_ads
  from public.orders
  join public.order_financials on order_financials.order_id = orders.id
  group by orders.organization_id, orders.campaign_code
)
select
  campaigns.id as campaign_id,
  campaigns.organization_id,
  campaigns.code,
  campaigns.name,
  coalesce(ad_rollup.ad_spend, 0) as ad_spend,
  coalesce(ad_rollup.impressions, 0) as impressions,
  coalesce(ad_rollup.clicks, 0) as clicks,
  coalesce(ad_rollup.conversations, 0) as conversations,
  coalesce(ad_rollup.leads, 0) as leads,
  coalesce(order_rollup.orders_created, 0) as orders_created,
  coalesce(order_rollup.confirmed_funnel, 0) as confirmed_funnel,
  coalesce(order_rollup.shipped_funnel, 0) as shipped_funnel,
  coalesce(order_rollup.delivered_orders, 0) as delivered_orders,
  coalesce(order_rollup.cancelled_orders, 0) as cancelled_orders,
  coalesce(order_rollup.returned_orders, 0) as returned_orders,
  coalesce(order_rollup.new_customers_delivered, 0) as new_customers_delivered,
  coalesce(order_rollup.delivered_revenue, 0) as delivered_revenue,
  coalesce(order_rollup.delivered_cogs, 0) as delivered_cogs,
  coalesce(order_rollup.order_variable_costs, 0) as order_variable_costs,
  coalesce(order_rollup.contribution_before_ads, 0) as contribution_before_ads,
  coalesce(order_rollup.contribution_before_ads, 0) - coalesce(ad_rollup.ad_spend, 0) as net_profit_after_ads
from public.campaigns
left join ad_rollup on ad_rollup.organization_id = campaigns.organization_id and ad_rollup.campaign_code = campaigns.code
left join order_rollup on order_rollup.organization_id = campaigns.organization_id and order_rollup.campaign_code = campaigns.code;

create view public.product_size_performance
with (security_invoker = true)
as
select
  orders.organization_id,
  order_items.product_name,
  order_items.size,
  sum(order_items.quantity) as quantity_sold,
  sum(order_items.quantity * order_items.unit_price) as gross_sales,
  sum(order_items.quantity * (order_items.unit_price - order_items.unit_cost)) as item_margin
from public.orders
join public.order_items on order_items.order_id = orders.id
where orders.status = 'Delivered'
group by orders.organization_id, order_items.product_name, order_items.size;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.campaigns enable row level security;
alter table public.daily_ad_metrics enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_events enable row level security;

create policy "Members can read organizations" on public.organizations
for select using (public.user_is_org_member(id) or created_by = auth.uid());

create policy "Authenticated users can create organizations" on public.organizations
for insert with check (created_by = auth.uid());

create policy "Members can read memberships" on public.organization_members
for select using (public.user_is_org_member(organization_id));

create policy "Owners and admins can manage memberships" on public.organization_members
for all using (public.user_can_manage_org(organization_id))
with check (public.user_can_manage_org(organization_id));

create policy "Org members can read campaigns" on public.campaigns
for select using (public.user_is_org_member(organization_id));

create policy "Operators can manage campaigns" on public.campaigns
for all using (public.user_can_manage_org(organization_id))
with check (public.user_can_manage_org(organization_id));

create policy "Org members can read daily ads" on public.daily_ad_metrics
for select using (public.user_is_org_member(organization_id));

create policy "Operators can manage daily ads" on public.daily_ad_metrics
for all using (public.user_can_manage_org(organization_id))
with check (public.user_can_manage_org(organization_id));

create policy "Org members can read customers" on public.customers
for select using (public.user_is_org_member(organization_id));

create policy "Operators can manage customers" on public.customers
for all using (public.user_can_manage_org(organization_id))
with check (public.user_can_manage_org(organization_id));

create policy "Org members can read products" on public.products
for select using (public.user_is_org_member(organization_id));

create policy "Operators can manage products" on public.products
for all using (public.user_can_manage_org(organization_id))
with check (public.user_can_manage_org(organization_id));

create policy "Org members can read orders" on public.orders
for select using (public.user_is_org_member(organization_id));

create policy "Operators can manage orders" on public.orders
for all using (public.user_can_manage_org(organization_id))
with check (public.user_can_manage_org(organization_id));

create policy "Org members can read order items" on public.order_items
for select using (public.user_is_org_member(organization_id));

create policy "Operators can manage order items" on public.order_items
for all using (public.user_can_manage_org(organization_id))
with check (public.user_can_manage_org(organization_id));

create policy "Org members can read order status events" on public.order_status_events
for select using (public.user_is_org_member(organization_id));

create policy "Operators can manage order status events" on public.order_status_events
for all using (public.user_can_manage_org(organization_id))
with check (public.user_can_manage_org(organization_id));

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.organizations,
  public.organization_members,
  public.campaigns,
  public.daily_ad_metrics,
  public.customers,
  public.products,
  public.orders,
  public.order_items,
  public.order_status_events
to authenticated;

grant select on
  public.order_financials,
  public.campaign_performance,
  public.product_size_performance
to authenticated;
