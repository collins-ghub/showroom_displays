-- Future-proof for Supabase's Oct 30, 2026 change requiring explicit GRANTs
-- on public-schema tables to expose them through the Data API. No-op on the
-- current project (existing tables keep their grants), but ensures a fresh
-- project provisioned from these migrations works after the cutover.

grant select on public.showroom_images to anon;
grant select, insert, update, delete on public.showroom_images to authenticated;
grant select, insert, update, delete on public.showroom_images to service_role;

grant select on public.showroom_settings to anon;
grant select, insert, update, delete on public.showroom_settings to authenticated;
grant select, insert, update, delete on public.showroom_settings to service_role;
