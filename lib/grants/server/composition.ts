import "server-only";
import { createClient } from "@supabase/supabase-js";
import { GrantEditorService } from "../application/editor-service.ts";
import { GrantRevisionService } from "../application/revision-service.ts";
import { SupabaseGrantRevisionRepository } from "../infrastructure/supabase/supabase-grant-revision-repository.ts";

export function createGrantEditorService(ownerId: string): GrantEditorService {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error("Grant workspace database configuration is incomplete.");
  }
  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const repository = new SupabaseGrantRevisionRepository(client, ownerId);
  return new GrantEditorService(new GrantRevisionService({ repository }));
}
