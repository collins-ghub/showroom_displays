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
  if ("welcome_template" in body) {
    if (typeof body.welcome_template !== "string") {
      return NextResponse.json(
        { error: "welcome_template must be string" },
        { status: 400 }
      );
    }
    const trimmed = body.welcome_template.trim();
    updates.push({
      key: "welcome_template",
      value: trimmed.length > 0 ? body.welcome_template : "Welcome {name} — {time}",
    });
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
  if ("show_calendar" in body) {
    if (typeof body.show_calendar !== "boolean") {
      return NextResponse.json(
        { error: "show_calendar must be boolean" },
        { status: 400 }
      );
    }
    updates.push({ key: "show_calendar", value: body.show_calendar });
  }
  if ("shuffle" in body) {
    if (typeof body.shuffle !== "boolean") {
      return NextResponse.json(
        { error: "shuffle must be boolean" },
        { status: 400 }
      );
    }
    updates.push({ key: "shuffle", value: body.shuffle });
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  for (const u of updates) {
    // The value column is NOT NULL, so clearing a setting (e.g. the welcome
    // override) deletes the row; parseSettingsRows falls back to the default.
    if (u.value === null) {
      const { error } = await supabase
        .from("showroom_settings")
        .delete()
        .eq("key", u.key);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      continue;
    }
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
