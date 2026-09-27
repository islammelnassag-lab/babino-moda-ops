alter table public.customers
add column if not exists customer_code text,
add column if not exists phone_digits text;

update public.customers
set
  customer_code = coalesce(customer_code, 'CUS-' || upper(left(id::text, 8))),
  phone_digits = regexp_replace(phone, '\D', '', 'g')
where customer_code is null or phone_digits is null;

alter table public.customers
alter column customer_code set not null,
alter column phone_digits set not null;

create unique index if not exists customers_organization_customer_code_idx on public.customers (organization_id, customer_code);
create unique index if not exists customers_organization_phone_digits_idx on public.customers (organization_id, phone_digits);
