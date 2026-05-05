-- Settings: simple key/value for display configuration
create table if not exists public.showroom_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists showroom_settings_set_updated_at on public.showroom_settings;
create trigger showroom_settings_set_updated_at
  before update on public.showroom_settings
  for each row execute function public.set_updated_at();

alter table public.showroom_settings enable row level security;

drop policy if exists "public read settings" on public.showroom_settings;
create policy "public read settings"
  on public.showroom_settings
  for select
  using (true);
-- Writes via service-role key (bypasses RLS).

-- Seed defaults if missing.
insert into public.showroom_settings (key, value)
values
  ('welcome_override', 'null'::jsonb),
  ('slideshow_only', 'false'::jsonb)
on conflict (key) do nothing;
