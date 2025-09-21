-- Supabase Schema for Riverdale East Africa Travel
-- Run this in Supabase SQL editor. Safe to re-run (uses IF NOT EXISTS where possible).

-- Required extension for UUIDs (usually enabled)
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- Countries (East Africa scope)
create table if not exists public.countries (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null unique
);

insert into public.countries(code, name)
values
  ('KE','Kenya'),
  ('TZ','Tanzania'),
  ('UG','Uganda'),
  ('RW','Rwanda')
on conflict (code) do nothing;

-- Profiles linked to auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('admin','staff','user')),
  created_at timestamptz not null default now()
);

-- Destinations
create table if not exists public.destinations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text generated always as (regexp_replace(lower(name),'[^a-z0-9]+','-','g')) stored,
  description text,
  country text,
  country_id bigint references public.countries(id),
  location text,
  price_from integer,
  duration text,
  max_group_size integer,
  rating numeric(2,1),
  reviews_count integer,
  image_url text,
  featured_image text,
  category text,
  featured boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);
create index if not exists idx_destinations_category on public.destinations(category);
create index if not exists idx_destinations_featured on public.destinations(featured) where featured = true;

-- Packages (experiences) linked to destinations
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid references public.destinations(id) on delete set null,
  name text not null,
  slug text generated always as (regexp_replace(lower(name),'[^a-z0-9]+','-','g')) stored,
  description text,
  duration text,
  base_price integer,
  rating numeric(2,1),
  best_time text,
  difficulty text,
  max_group_size integer,
  images jsonb,
  highlights text[],
  itinerary jsonb,
  inclusions text[],
  exclusions text[],
  created_at timestamptz not null default now()
);
create index if not exists idx_packages_destination on public.packages(destination_id);

-- Hotels/Lodges
create table if not exists public.hotels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text generated always as (regexp_replace(lower(name),'[^a-z0-9]+','-','g')) stored,
  description text,
  location text,
  country text,
  price_per_night integer,
  rating numeric(2,1),
  reviews_count integer,
  category text,
  amenities text[],
  image_url text,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_hotels_featured on public.hotels(featured) where featured = true;

-- Inquiries
do $$
begin
  create type inquiry_status as enum ('pending','contacted','quoted','confirmed','cancelled');
exception when duplicate_object then
  null;
end $$;

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  verification_id text not null unique,
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  package_id uuid references public.packages(id) on delete set null,
  package_name text,
  package_price integer,
  adults integer default 0,
  children integer default 0,
  preferred_start_date date,
  group_size integer,
  special_requests text,
  admin_notes text,
  quoted_amount integer,
  inquiry_status inquiry_status not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists idx_inquiries_status on public.inquiries(inquiry_status);
create index if not exists idx_inquiries_created on public.inquiries(created_at desc);

-- Customer Reviews
create table if not exists public.customer_reviews (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references public.packages(id) on delete set null,
  customer_name text not null,
  customer_email text not null,
  customer_location text,
  title text not null,
  content text not null,
  rating integer not null check (rating between 1 and 5),
  travel_date date,
  admin_approved boolean not null default false,
  verified boolean not null default false,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_reviews_pkg on public.customer_reviews(package_id);
create index if not exists idx_reviews_approved on public.customer_reviews(admin_approved) where admin_approved = true;

-- Notification Queue
create table if not exists public.notification_queue (
  id bigint generated always as identity primary key,
  notification_type text not null,
  recipient_email text not null,
  title text,
  message text,
  review_id uuid references public.customer_reviews(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- RLS: enable and add policies
alter table public.destinations enable row level security;
alter table public.packages enable row level security;
alter table public.hotels enable row level security;
alter table public.inquiries enable row level security;
alter table public.customer_reviews enable row level security;
alter table public.notification_queue enable row level security;
alter table public.profiles enable row level security;

-- Public read policies for read-only content
create policy if not exists "destinations_read" on public.destinations
  for select using (true);
create policy if not exists "packages_read" on public.packages
  for select using (true);
create policy if not exists "hotels_read" on public.hotels
  for select using (true);
create policy if not exists "reviews_read_public" on public.customer_reviews
  for select using (admin_approved = true);

-- Write restricted to admins (checked via JWT; fallback is service role bypass)
create policy if not exists "destinations_write_admin" on public.destinations
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin','staff')
    )
  ) with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin','staff')
    )
  );

create policy if not exists "packages_write_admin" on public.packages
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff'))
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff'))
  );

create policy if not exists "hotels_write_admin" on public.hotels
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff'))
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff'))
  );

-- Inquiries: allow inserts from anon, read/write for admins
create policy if not exists "inquiries_insert_public" on public.inquiries
  for insert with check (true);
create policy if not exists "inquiries_read_admin" on public.inquiries
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff'))
  );
create policy if not exists "inquiries_update_admin" on public.inquiries
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff'))
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff'))
  );

-- Reviews: public can insert; admin approves
create policy if not exists "reviews_insert_public" on public.customer_reviews
  for insert with check (true);
create policy if not exists "reviews_update_admin" on public.customer_reviews
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff'))
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff'))
  );

-- Profiles: only owner or admin can read/update
create policy if not exists "profiles_self_read" on public.profiles
  for select using (auth.uid() = id);
create policy if not exists "profiles_admin_read" on public.profiles
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff')));
create policy if not exists "profiles_self_upsert" on public.profiles
  for insert with check (auth.uid() = id);
create policy if not exists "profiles_self_update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Helpers: ensure an admin user (run manually once with your user id)
-- insert into public.profiles(id, role) values ('<your-auth-user-id>', 'admin') on conflict (id) do update set role='admin';
