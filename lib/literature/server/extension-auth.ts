// Server-only module.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { LiteratureError } from "@/lib/literature/errors";
import { createBearerClient } from "@/lib/supabase/bearer-client";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

function readBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

export async function requireExtensionUser(
  request: Request,
): Promise<{ supabase: SupabaseClient; user: User }> {
  const token = readBearerToken(request);

  if (token) {
    const supabase = createBearerClient(token);
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw new LiteratureError("Unauthorized", 401);
    }

    return { supabase, user };
  }

  return requireLiteratureUser();
}
