import "server-only";
import { createClient } from "@supabase/supabase-js";
import { GrantEditorService } from "../application/editor-service.ts";
import { GrantDocxImportService } from "../application/docx-import-service.ts";
import { GrantDiagnosticService } from "../application/diagnostic-service.ts";
import { GrantFeedbackService } from "../application/feedback-service.ts";
import { GrantStructuralCompletenessChecker } from "../diagnostics/structural-completeness-checker.ts";
import { SupabaseGrantDiagnosticRepository } from "../infrastructure/supabase/supabase-grant-diagnostic-repository.ts";
import { SupabaseGrantFeedbackRepository } from "../infrastructure/supabase/supabase-grant-feedback-repository.ts";
import { GrantRevisionService } from "../application/revision-service.ts";
import { SupabaseGrantRevisionRepository } from "../infrastructure/supabase/supabase-grant-revision-repository.ts";
import { SupabaseGrantImportStorage } from "../infrastructure/supabase/supabase-grant-import-storage.ts";

function createGrantSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) throw new Error("Grant workspace database configuration is incomplete.");
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function createGrantEditorService(ownerId: string): GrantEditorService {
  const client = createGrantSupabaseClient();
  const repository = new SupabaseGrantRevisionRepository(client, ownerId);
  return new GrantEditorService(new GrantRevisionService({ repository }));
}

export function createGrantDocxImportService(ownerId: string): GrantDocxImportService {
  const client = createGrantSupabaseClient();
  const editor = new GrantEditorService(new GrantRevisionService({
    repository: new SupabaseGrantRevisionRepository(client, ownerId),
  }));
  return new GrantDocxImportService(editor, new SupabaseGrantImportStorage(client));
}

export function createGrantDiagnosticService(ownerId: string): GrantDiagnosticService {
  const client = createGrantSupabaseClient();
  const revisionRepository = new SupabaseGrantRevisionRepository(client, ownerId);
  return new GrantDiagnosticService({
    revisionService: new GrantRevisionService({ repository: revisionRepository }),
    repository: new SupabaseGrantDiagnosticRepository(client, ownerId),
    checkers: [new GrantStructuralCompletenessChecker()],
  });
}

export function createGrantFeedbackService(ownerId: string): GrantFeedbackService {
  return new GrantFeedbackService(new SupabaseGrantFeedbackRepository(createGrantSupabaseClient(), ownerId));
}
