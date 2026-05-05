import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import type { ShowroomImage } from "@/lib/supabase/types";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  if (!isAdminAuthed()) return unauthorized();
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("showroom_images")
    .select("*")
    .order("position", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ images: data as ShowroomImage[] });
}

export async function POST(req: Request) {
  if (!isAdminAuthed()) return unauthorized();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image uploads allowed" }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const storagePath = `${crypto.randomUUID()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from(env.storageBucket)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: maxRow } = await supabase
    .from("showroom_images")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (maxRow?.position ?? -1) + 1;

  const { data: row, error: insErr } = await supabase
    .from("showroom_images")
    .insert({
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      position: nextPosition,
    })
    .select("*")
    .single();
  if (insErr) {
    await supabase.storage.from(env.storageBucket).remove([storagePath]);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  return NextResponse.json({ image: row as ShowroomImage });
}
