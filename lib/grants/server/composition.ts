import "server-only";
import { createClient } from "@supabase/supabase-js";
import { GrantEditorService } from "../application/editor-service.ts";
import { GrantDocxImportService } from "../application/docx-import-service.ts";
import { GrantDiagnosticService } from "../application/diagnostic-service.ts";
import { GrantFeedbackService } from "../application/feedback-service.ts";
import { createDefaultGrantCheckers } from "../diagnostics/default-checkers.ts";
import { GrantSemanticDiagnosticChecker } from "../application/semantic-diagnostic-checker.ts";
import { SupabaseGrantDiagnosticRepository } from "../infrastructure/supabase/supabase-grant-diagnostic-repository.ts";
import { SupabaseGrantFeedbackRepository } from "../infrastructure/supabase/supabase-grant-feedback-repository.ts";
import { GrantRevisionService } from "../application/revision-service.ts";
import { SupabaseGrantRevisionRepository } from "../infrastructure/supabase/supabase-grant-revision-repository.ts";
import { SupabaseGrantImportStorage } from "../infrastructure/supabase/supabase-grant-import-storage.ts";
import { GrantPatchService } from "../application/patch-service.ts";
import { GrantModelDataGateway } from "../application/grant-model-data-gateway.ts";
import { OpenAIGrantAiModel, UnavailableGrantAiModel } from "../infrastructure/model/openai-grant-ai-model.ts";
import { SupabaseGrantPatchRepository } from "../infrastructure/supabase/supabase-grant-patch-repository.ts";
import { GrantEvidenceService } from "../application/evidence-service.ts";
import { GrantEvidenceAuthorizationService } from "../application/evidence-authorization-service.ts";
import { SupabaseGrantEvidenceRepository } from "../infrastructure/supabase/supabase-grant-evidence-repository.ts";
import { SupabaseGrantEvidenceStorage } from "../infrastructure/supabase/supabase-grant-evidence-storage.ts";
import { SharedGrantEvidenceParser } from "../infrastructure/documents/shared-grant-evidence-parser.ts";
import { GrantExportService } from "../application/export-service.ts";
import { DeterministicGrantDocxRenderer } from "../infrastructure/documents/deterministic-grant-docx-renderer.ts";
import { isGrantRecheckEnabled } from "./config.ts";
import { resolveGrantAiConfig } from "./grant-ai-config.ts";

function createGrantSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) throw new Error("Grant workspace database configuration is incomplete.");
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function createGrantModelDataGateway(client: ReturnType<typeof createGrantSupabaseClient>, ownerId: string) {
  const config = resolveGrantAiConfig();
  const model = config.apiKey
    ? new OpenAIGrantAiModel(config.modelId, config.apiKey)
    : new UnavailableGrantAiModel();
  const evidenceRepository = new SupabaseGrantEvidenceRepository(client, ownerId);
  return {
    config,
    gateway: new GrantModelDataGateway(model, new GrantEvidenceAuthorizationService(evidenceRepository)),
  };
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
  const ai = createGrantModelDataGateway(client, ownerId);
  return new GrantDiagnosticService({
    revisionService: new GrantRevisionService({ repository: revisionRepository }),
    repository: new SupabaseGrantDiagnosticRepository(client, ownerId),
    checkers: [...createDefaultGrantCheckers(), new GrantSemanticDiagnosticChecker(ai.gateway, ai.config.modelId)],
    incrementalEnabled: isGrantRecheckEnabled(),
  });
}

export function createGrantFeedbackService(ownerId: string): GrantFeedbackService {
  return new GrantFeedbackService(new SupabaseGrantFeedbackRepository(createGrantSupabaseClient(), ownerId));
}

export function createGrantPatchService(ownerId: string): GrantPatchService {
  const client = createGrantSupabaseClient();
  const ai = createGrantModelDataGateway(client, ownerId);
  return new GrantPatchService(
    new GrantRevisionService({ repository: new SupabaseGrantRevisionRepository(client, ownerId) }),
    new SupabaseGrantDiagnosticRepository(client, ownerId),
    new SupabaseGrantPatchRepository(client, ownerId),
    ai.gateway,
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
