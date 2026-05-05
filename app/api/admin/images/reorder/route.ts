import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const ids: unknown = body.ids;
  if (!Array.isArray(ids) || ids.some((v) => typeof v !== "string")) {
    return NextResponse.json({ error: "ids must be string[]" }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  // Update positions one-by-one. Image lists are small (tens, not thousands).
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from("showroom_images")
      .update({ position: i })
      .eq("id", ids[i] as string);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
