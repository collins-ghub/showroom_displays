-- Whether the slideshow should display images in random order.
insert into public.showroom_settings (key, value)
values ('shuffle', 'false'::jsonb)
on conflict (key) do nothing;
