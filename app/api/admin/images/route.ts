import { NextResponse } from "next/server";
import sharp from "sharp";
import { isAdminAuthed } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import type { ShowroomImage } from "@/lib/supabase/types";

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1920;
const WEBP_QUALITY = 82;

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
  const storagePath = `${crypto.randomUUID()}.webp`;
  const contentType = "image/webp";

  // Downscale + re-encode as WebP so the TVs aren't pulling 8 MB phone photos.
  // EXIF rotation is honored, then stripped along with other metadata.
  const original = Buffer.from(await file.arrayBuffer());
  let buffer: Buffer;
  try {
    buffer = await sharp(original)
      .rotate()
      .resize({
        width: MAX_WIDTH,
        height: MAX_HEIGHT,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "Could not process image" }, { status: 400 });
  }

  const { error: upErr } = await supabase.storage
    .from(env.storageBucket)
    .upload(storagePath, buffer, { contentType, upsert: false });
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
      mime_type: contentType,
      size_bytes: buffer.byteLength,
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
