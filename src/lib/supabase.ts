// Supabase client for the shared side-projects DB.
// All bracketeering tables are namespaced with the `bracketeering_` prefix.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _server: SupabaseClient | null = null;
let _browser: SupabaseClient | null = null;

export function supabaseServer(): SupabaseClient {
  if (_server) return _server;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  _server = createClient(url, key, { auth: { persistSession: false } });
  return _server;
}

export function supabaseBrowser(): SupabaseClient {
  if (_browser) return _browser;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  _browser = createClient(url, key);
  return _browser;
}
