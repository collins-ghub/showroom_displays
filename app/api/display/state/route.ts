import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";
import { env } from "@/lib/env";
import type { ShowroomImage } from "@/lib/supabase/types";
import { withUrls } from "@/lib/images";
import { parseSettingsRows } from "@/lib/settings";
import { findCurrentOrUpcomingEvent, type ShowroomEvent } from "@/lib/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Public endpoint — uses the anon key so we exercise RLS the same way
// the TVs would if we ever moved this client-side.
export async function GET() {
  noStore();
  const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Bypass Next.js's data cache for the underlying Supabase REST calls.
      fetch: (input, init) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });

  const [imagesRes, settingsRes] = await Promise.all([
    supabase
      .from("showroom_images")
      .select("*")
      .eq("is_active", true)
      .order("position", { ascending: true }),
    supabase.from("showroom_settings").select("key, value, updated_at"),
  ]);

  if (imagesRes.error) {
    return NextResponse.json({ error: imagesRes.error.message }, { status: 500 });
  }
  if (settingsRes.error) {
    return NextResponse.json({ error: settingsRes.error.message }, { status: 500 });
  }

  const images = withUrls((imagesRes.data ?? []) as ShowroomImage[]);
  const settings = parseSettingsRows(
    (settingsRes.data ?? []) as Array<{ key: string; value: unknown }>
  );

  let event: ShowroomEvent | null = null;
  if (settings.show_calendar) {
    try {
      event = await findCurrentOrUpcomingEvent();
    } catch (e) {
      // Calendar API failures shouldn't break the slideshow.
      console.error("Calendar fetch failed:", e);
      event = null;
    }
  }

  // Highest updated_at across images + settings. Client polls and rebuilds
  // its slide list when this changes.
  const stamps = [
    ...images.map((i) => i.updated_at),
    ...((settingsRes.data ?? []) as Array<{ updated_at: string }>).map(
      (s) => s.updated_at
    ),
  ];
  const version = stamps.sort().at(-1) ?? "";

  return NextResponse.json(
    { images, settings, version, event },
    { headers: { "Cache-Control": "no-store" } }
  );
}
