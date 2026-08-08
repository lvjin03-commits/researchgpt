import "server-only";
import { createClient } from "@supabase/supabase-js";
import { GrantEditorService } from "../application/editor-service.ts";
import { GrantDiagnosticService } from "../application/diagnostic-service.ts";
import { GrantStructuralCompletenessChecker } from "../diagnostics/structural-completeness-checker.ts";
import { SupabaseGrantDiagnosticRepository } from "../infrastructure/supabase/supabase-grant-diagnostic-repository.ts";
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

export function createGrantDiagnosticService(ownerId: string): GrantDiagnosticService {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) throw new Error("Grant workspace database configuration is incomplete.");
  const client = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const revisionRepository = new SupabaseGrantRevisionRepository(client, ownerId);
  return new GrantDiagnosticService({
    revisionService: new GrantRevisionService({ repository: revisionRepository }),
    repository: new SupabaseGrantDiagnosticRepository(client, ownerId),
    checkers: [new GrantStructuralCompletenessChecker()],
  });
}
