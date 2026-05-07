-- Default welcome template used when a calendar event matches.
insert into public.showroom_settings (key, value)
values ('welcome_template', '"Welcome {name} — {time}"'::jsonb)
on conflict (key) do nothing;
