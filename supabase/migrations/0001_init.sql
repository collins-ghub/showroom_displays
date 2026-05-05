-- Showroom Display: initial schema
-- Run in Supabase SQL editor (or via supabase db push).

create extension if not exists "pgcrypto";

create table if not exists public.showroom_images (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  width integer,
  height integer,
  duration_ms integer not null default 7000 check (duration_ms between 500 and 600000),
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists showroom_images_position_idx
  on public.showroom_images (position asc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists showroom_images_set_updated_at on public.showroom_images;
create trigger showroom_images_set_updated_at
  before update on public.showroom_images
  for each row execute function public.set_updated_at();

-- RLS: admin writes happen via service-role key (bypasses RLS).
-- The /display page reads via the anon key, so allow public reads of active rows only.
alter table public.showroom_images enable row level security;

drop policy if exists "public read active images" on public.showroom_images;
create policy "public read active images"
  on public.showroom_images
  for select
  using (is_active = true);

-- Storage bucket for images. Public-read so the TVs can fetch via CDN.
insert into storage.buckets (id, name, public)
values ('showroom-images', 'showroom-images', true)
on conflict (id) do update set public = excluded.public;

-- Allow public read of objects in the bucket.
drop policy if exists "public read showroom-images" on storage.objects;
create policy "public read showroom-images"
  on storage.objects
  for select
  using (bucket_id = 'showroom-images');
-- Writes use the service-role key (RLS bypass) from server routes.
