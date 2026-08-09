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
import { GrantPatchService } from "../application/patch-service.ts";
import { GrantModelDataGateway } from "../application/grant-model-data-gateway.ts";
import { OpenAICompatibleGrantPatchModel } from "../infrastructure/model/openai-compatible-grant-patch-model.ts";
import { SupabaseGrantPatchRepository } from "../infrastructure/supabase/supabase-grant-patch-repository.ts";
import { GrantEvidenceService } from "../application/evidence-service.ts";
import { GrantEvidenceAuthorizationService } from "../application/evidence-authorization-service.ts";
import { SupabaseGrantEvidenceRepository } from "../infrastructure/supabase/supabase-grant-evidence-repository.ts";
import { SupabaseGrantEvidenceStorage } from "../infrastructure/supabase/supabase-grant-evidence-storage.ts";
import { SharedGrantEvidenceParser } from "../infrastructure/documents/shared-grant-evidence-parser.ts";
import { GrantExportService } from "../application/export-service.ts";
import { DeterministicGrantDocxRenderer } from "../infrastructure/documents/deterministic-grant-docx-renderer.ts";
import { isGrantRecheckEnabled } from "./config.ts";

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
    incrementalEnabled: isGrantRecheckEnabled(),
  });
}

export function createGrantFeedbackService(ownerId: string): GrantFeedbackService {
  return new GrantFeedbackService(new SupabaseGrantFeedbackRepository(createGrantSupabaseClient(), ownerId));
}

export function createGrantPatchService(ownerId: string): GrantPatchService {
  const client = createGrantSupabaseClient();
  const provider = process.env.GRANT_PATCH_PROVIDER?.trim() === "openai" ? "openai" : "deepseek";
  const apiKey = provider === "openai"
    ? process.env.OPENAI_API_KEY?.trim()
    : process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error(`Grant patch ${provider} API key is not configured.`);
  const modelId = process.env.GRANT_PATCH_MODEL?.trim()
    || (provider === "openai" ? "gpt-4o-mini" : "deepseek-v4-flash");
  const model = new OpenAICompatibleGrantPatchModel(
    provider,
    modelId,
    apiKey,
    provider === "deepseek" ? process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com" : undefined,
  );
  const evidenceRepository = new SupabaseGrantEvidenceRepository(client, ownerId);
  return new GrantPatchService(
    new GrantRevisionService({ repository: new SupabaseGrantRevisionRepository(client, ownerId) }),
    new SupabaseGrantDiagnosticRepository(client, ownerId),
    new SupabaseGrantPatchRepository(client, ownerId),
    new GrantModelDataGateway(model, new GrantEvidenceAuthorizationService(evidenceRepository)),
  );
}

export function createGrantEvidenceService(ownerId: string): GrantEvidenceService {
  const client = createGrantSupabaseClient();
  return new GrantEvidenceService(
    new GrantRevisionService({ repository: new SupabaseGrantRevisionRepository(client, ownerId) }),
    new SupabaseGrantEvidenceRepository(client, ownerId),
    new SupabaseGrantEvidenceStorage(client),
    new SharedGrantEvidenceParser(),
  );
}

export function createGrantExportService(ownerId: string): GrantExportService {
  const client = createGrantSupabaseClient();
  return new GrantExportService(
    new GrantRevisionService({ repository: new SupabaseGrantRevisionRepository(client, ownerId) }),
    new DeterministicGrantDocxRenderer(),
  );
}
