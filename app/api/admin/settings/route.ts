import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { DEFAULT_SETTINGS, parseSettingsRows } from "@/lib/settings";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  if (!isAdminAuthed()) return unauthorized();
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("showroom_settings")
    .select("key, value");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    settings: parseSettingsRows(
      (data ?? []) as Array<{ key: string; value: unknown }>
    ),
  });
}

export async function PUT(req: Request) {
  if (!isAdminAuthed()) return unauthorized();
  const body = await req.json().catch(() => ({}));

  const updates: Array<{ key: string; value: unknown }> = [];
  if ("welcome_override" in body) {
    const v = body.welcome_override;
    if (v !== null && typeof v !== "string") {
      return NextResponse.json(
        { error: "welcome_override must be string|null" },
        { status: 400 }
      );
    }
    const trimmed = typeof v === "string" ? v.trim() : null;
    updates.push({ key: "welcome_override", value: trimmed && trimmed.length > 0 ? trimmed : null });
  }
  if ("slideshow_only" in body) {
    if (typeof body.slideshow_only !== "boolean") {
      return NextResponse.json(
        { error: "slideshow_only must be boolean" },
        { status: 400 }
      );
    }
    updates.push({ key: "slideshow_only", value: body.slideshow_only });
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  for (const u of updates) {
    const { error } = await supabase
      .from("showroom_settings")
      .upsert({ key: u.key, value: u.value }, { onConflict: "key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("showroom_settings")
    .select("key, value");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    settings: parseSettingsRows(
      (data ?? []) as Array<{ key: string; value: unknown }>
    ),
  });
}
