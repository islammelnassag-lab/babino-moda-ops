create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  size text not null,
  unit_price numeric(12, 2) not null default 0,
  unit_cost numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_id, size)
);

create index if not exists product_variants_product_size_idx on public.product_variants (organization_id, product_id, size);

create trigger touch_product_variants_updated_at before update on public.product_variants
for each row execute function public.touch_updated_at();

alter table public.product_variants enable row level security;

create policy "Org members can read product variants" on public.product_variants
for select using (public.user_is_org_member(organization_id));

create policy "Operators can manage product variants" on public.product_variants
for all using (public.user_can_manage_org(organization_id))
with check (public.user_can_manage_org(organization_id));

grant select, insert, update, delete on public.product_variants to authenticated;
