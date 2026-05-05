import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, serverEnv } from "@/lib/env";

// Untyped DB client — we don't generate Database types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, "public", any>;

let cached: AnySupabase | null = null;

export function createAdminSupabase(): AnySupabase {
  if (cached) return cached;
  cached = createClient(env.supabaseUrl, serverEnv.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as AnySupabase;
  return cached;
}
