import { env } from "@/lib/env";
import type { ShowroomImage } from "@/lib/supabase/types";

export function publicImageUrl(storagePath: string): string {
  return `${env.supabaseUrl}/storage/v1/object/public/${env.storageBucket}/${storagePath}`;
}

export type ImageWithUrl = ShowroomImage & { url: string };

export function withUrls(rows: ShowroomImage[]): ImageWithUrl[] {
  return rows.map((r) => ({ ...r, url: publicImageUrl(r.storage_path) }));
}
