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

type SupabaseAdmin = ReturnType<typeof createAdminSupabase>;

async function nextPosition(supabase: SupabaseAdmin): Promise<number> {
  const { data: maxRow } = await supabase
    .from("showroom_images")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (maxRow?.position ?? -1) + 1;
}

// Register a row for a file the browser uploaded directly to Storage via a
// signed upload URL (used for videos, which are too big to route through the
// 4.5 MB Vercel request limit).
async function registerUploadedFile(req: Request) {
  const body = await req.json().catch(() => ({}));
  const storagePath = typeof body.storage_path === "string" ? body.storage_path : "";
  const fileName = typeof body.file_name === "string" ? body.file_name : "file";
  const mimeType = typeof body.mime_type === "string" ? body.mime_type : null;
  const sizeBytes = typeof body.size_bytes === "number" ? body.size_bytes : null;

  if (!storagePath) {
    return NextResponse.json({ error: "Missing storage_path" }, { status: 400 });
  }
  if (!mimeType || !(mimeType.startsWith("image/") || mimeType.startsWith("video/"))) {
    return NextResponse.json({ error: "Only image or video files allowed" }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  // Confirm the object actually landed in storage before recording it.
  const { error: headErr } = await supabase.storage
    .from(env.storageBucket)
    .createSignedUrl(storagePath, 60);
  if (headErr) {
    return NextResponse.json({ error: "Uploaded file not found in storage" }, { status: 400 });
  }

  const { data: row, error: insErr } = await supabase
    .from("showroom_images")
    .insert({
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      position: await nextPosition(supabase),
    })
    .select("*")
    .single();
  if (insErr) {
    await supabase.storage.from(env.storageBucket).remove([storagePath]);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  return NextResponse.json({ image: row as ShowroomImage });
}

export async function POST(req: Request) {
  if (!isAdminAuthed()) return unauthorized();

  // JSON body = "register a file already uploaded directly to Storage".
  if (req.headers.get("content-type")?.includes("application/json")) {
    return registerUploadedFile(req);
  }

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

  const { data: row, error: insErr } = await supabase
    .from("showroom_images")
    .insert({
      storage_path: storagePath,
      file_name: file.name,
      mime_type: contentType,
      size_bytes: buffer.byteLength,
      position: await nextPosition(supabase),
    })
    .select("*")
    .single();
  if (insErr) {
    await supabase.storage.from(env.storageBucket).remove([storagePath]);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  return NextResponse.json({ image: row as ShowroomImage });
}
