import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.duration_ms === "number") {
    if (body.duration_ms < 500 || body.duration_ms > 600_000) {
      return NextResponse.json({ error: "duration_ms out of range" }, { status: 400 });
    }
    patch.duration_ms = Math.round(body.duration_ms);
  }
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("showroom_images")
    .update(patch)
    .eq("id", params.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ image: data });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return unauthorized();
  const supabase = createAdminSupabase();
  const { data: row, error: selErr } = await supabase
    .from("showroom_images")
    .select("storage_path")
    .eq("id", params.id)
    .maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error: delErr } = await supabase
    .from("showroom_images")
    .delete()
    .eq("id", params.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await supabase.storage.from(env.storageBucket).remove([row.storage_path]);
  return NextResponse.json({ ok: true });
}
