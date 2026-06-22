import { createClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";
import { env } from "@/lib/env";
import { withUrls } from "@/lib/images";
import { parseSettingsRows } from "@/lib/settings";
import type { ShowroomImage } from "@/lib/supabase/types";
import { listTodaysEvents, type ShowroomEvent } from "@/lib/calendar";
import Slideshow from "./Slideshow";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function DisplayPage() {
  noStore();
  const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
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

  const images = withUrls((imagesRes.data ?? []) as ShowroomImage[]);
  const settings = parseSettingsRows(
    (settingsRes.data ?? []) as Array<{ key: string; value: unknown }>
  );

  let events: ShowroomEvent[] = [];
  if (settings.show_calendar) {
    try {
      events = await listTodaysEvents();
    } catch (e) {
      console.error("Calendar fetch failed:", e);
    }
  }

  const stamps = [
    ...images.map((i) => i.updated_at),
    ...((settingsRes.data ?? []) as Array<{ updated_at: string }>).map(
      (s) => s.updated_at
    ),
  ];
  const dataVersion = stamps.sort().at(-1) ?? "";
  const eventKey =
    events.length > 0
      ? events.map((e) => `${e.startsAt}|${e.endsAt}|${e.name}`).join(",")
      : "none";
  const version = `${dataVersion}#${eventKey}`;

  return <Slideshow initial={{ images, settings, version, events }} />;
}
