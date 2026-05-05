import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { withUrls } from "@/lib/images";
import type { ShowroomImage } from "@/lib/supabase/types";
import ImageManager from "./ImageManager";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!isAdminAuthed()) redirect("/admin/login?next=/admin");

  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("showroom_images")
    .select("*")
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);

  const images = withUrls((data ?? []) as ShowroomImage[]);

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Showroom Admin</h1>
        <form action="/admin/logout" method="post">
          <button className="text-sm text-neutral-400 hover:text-white">Sign out</button>
        </form>
      </header>
      <ImageManager initialImages={images} />
    </main>
  );
}
