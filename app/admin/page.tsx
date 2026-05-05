import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { withUrls } from "@/lib/images";
import type { ShowroomImage } from "@/lib/supabase/types";
import { parseSettingsRows } from "@/lib/settings";
import ImageManager from "./ImageManager";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!isAdminAuthed()) redirect("/admin/login?next=/admin");

  const supabase = createAdminSupabase();
  const [imagesRes, settingsRes] = await Promise.all([
    supabase.from("showroom_images").select("*").order("position", { ascending: true }),
    supabase.from("showroom_settings").select("key, value"),
  ]);
  if (imagesRes.error) throw new Error(imagesRes.error.message);
  if (settingsRes.error) throw new Error(settingsRes.error.message);

  const images = withUrls((imagesRes.data ?? []) as ShowroomImage[]);
  const settings = parseSettingsRows(
    (settingsRes.data ?? []) as Array<{ key: string; value: unknown }>
  );

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Showroom Admin</h1>
        <form action="/admin/logout" method="post">
          <button className="text-sm text-neutral-400 hover:text-white">Sign out</button>
        </form>
      </header>
      <SettingsForm initial={settings} />
      <ImageManager initialImages={images} />
    </main>
  );
}
