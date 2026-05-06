-- Add the show_calendar setting (default true).
insert into public.showroom_settings (key, value)
values ('show_calendar', 'true'::jsonb)
on conflict (key) do nothing;
