import "server-only";

import { createClient } from "@supabase/supabase-js";

export function createAccountAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) throw new Error("Account service configuration is incomplete.");
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
