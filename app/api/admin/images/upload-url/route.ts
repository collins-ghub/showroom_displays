import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

export const runtime = "nodejs";

// Mints a short-lived signed upload URL so the browser can upload large files
// (videos) straight to Supabase Storage, bypassing Vercel's 4.5 MB request
// body limit. The file never passes through our serverless function.
export async function POST(req: Request) {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const fileName = typeof body.fileName === "string" ? body.fileName : "";

  const ext = (fileName.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const storagePath = ext ? `${crypto.randomUUID()}.${ext}` : `${crypto.randomUUID()}`;

  const supabase = createAdminSupabase();
  const { data, error } = await supabase.storage
    .from(env.storageBucket)
    .createSignedUploadUrl(storagePath);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ path: data.path, token: data.token });
}
