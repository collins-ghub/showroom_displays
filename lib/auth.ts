import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";

export const ADMIN_COOKIE = "sd_admin";

export function isAdminAuthed(): boolean {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  try {
    return token === serverEnv.adminPassword();
  } catch {
    return false;
  }
}

export function requireAdmin() {
  if (!isAdminAuthed()) {
    throw new Response("Unauthorized", { status: 401 });
  }
}
