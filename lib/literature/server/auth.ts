// Server-only module.

import { createClient } from "@/lib/supabase/server";
import { LiteratureError } from "@/lib/literature/errors";

export async function requireLiteratureUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new LiteratureError("Unauthorized", 401);
  }

  return { supabase, user };
}
