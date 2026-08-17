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
import { isGrantRecheckEnabled, selectGrantSemanticDiagnosticRuntime } from "./config.ts";
import { resolveGrantAiConfig } from "./grant-ai-config.ts";
import { GrantFigureDisplayService } from "../application/figure-display-service.ts";
import { SupabaseGrantFigureAssetReader } from "../infrastructure/supabase/supabase-grant-figure-asset-reader.ts";
import { GrantFigureModelAuthorizationService } from "../application/figure-model-authorization-service.ts";
import { SupabaseGrantFigureAuthorizationRepository } from "../infrastructure/supabase/supabase-grant-figure-authorization-repository.ts";
import { GrantAiEditSessionService } from "../application/grant-ai-edit-session-service.ts";
import { GrantModelExecutor } from "../application/grant-model-executor.ts";
import { SupabaseGrantAiEditSessionRepository } from "../infrastructure/supabase/supabase-grant-ai-edit-session-repository.ts";
import { SupabaseGrantModelCallRepository } from "../infrastructure/supabase/supabase-grant-model-call-repository.ts";
import { GrantWebSourceService } from "../application/grant-web-source-service.ts";
import { SupabaseGrantWebSourceRepository } from "../infrastructure/supabase/supabase-grant-web-source-repository.ts";
import { OpenAlexGrantWebSearchProvider, PublicWebSnapshotFetcher } from "../infrastructure/web/openalex-grant-web-source.ts";

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
  const revisionService = new GrantRevisionService({
    repository: new SupabaseGrantRevisionRepository(client, ownerId),
  });
  return {
    config,
    gateway: new GrantModelDataGateway(
      model,
      new GrantEvidenceAuthorizationService(evidenceRepository),
      new GrantFigureModelAuthorizationService(
        revisionService,
        new SupabaseGrantFigureAuthorizationRepository(client, ownerId),
      ),
      new SupabaseGrantFigureAssetReader(client),
    ),
  };
}

export function createGrantEditorService(ownerId: string): GrantEditorService {
  const client = createGrantSupabaseClient();
  const repository = new SupabaseGrantRevisionRepository(client, ownerId);
  const revisions = new GrantRevisionService({ repository });
  return new GrantEditorService(
    revisions,
    new GrantFigureDisplayService(revisions, new SupabaseGrantFigureAssetReader(client)),
  );
}

export function createGrantFigureModelAuthorizationService(ownerId: string): GrantFigureModelAuthorizationService {
  const client = createGrantSupabaseClient();
  return new GrantFigureModelAuthorizationService(
    new GrantRevisionService({ repository: new SupabaseGrantRevisionRepository(client, ownerId) }),
    new SupabaseGrantFigureAuthorizationRepository(client, ownerId),
  );
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
  const diagnosticRepository = new SupabaseGrantDiagnosticRepository(client, ownerId);
  const semanticVersion = selectGrantSemanticDiagnosticRuntime(ownerId);
  return new GrantDiagnosticService({
    revisionService: new GrantRevisionService({ repository: revisionRepository }),
    repository: diagnosticRepository,
    checkers: [
      ...createDefaultGrantCheckers(),
      new GrantSemanticDiagnosticChecker(ai.gateway, ai.config.modelId, semanticVersion, diagnosticRepository),
    ],
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

export function createGrantAiEditSessionService(ownerId: string): GrantAiEditSessionService {
  const client = createGrantSupabaseClient();
  const ai = createGrantModelDataGateway(client, ownerId);
  const revisions = new GrantRevisionService({ repository: new SupabaseGrantRevisionRepository(client, ownerId) });
  const patches = new GrantPatchService(
    revisions,
    new SupabaseGrantDiagnosticRepository(client, ownerId),
    new SupabaseGrantPatchRepository(client, ownerId),
    ai.gateway,
  );
  return new GrantAiEditSessionService({
    repository: new SupabaseGrantAiEditSessionRepository(client, ownerId),
    revisionService: revisions,
    modelGateway: ai.gateway,
    modelExecutor: new GrantModelExecutor(new SupabaseGrantModelCallRepository(client, ownerId)),
    patchService: patches,
    configuredGrantModelId: ai.config.modelId,
  });
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

export function createGrantWebSourceService(ownerId: string): GrantWebSourceService {
  const client = createGrantSupabaseClient();
  const revisionService = new GrantRevisionService({
    repository: new SupabaseGrantRevisionRepository(client, ownerId),
  });
  return new GrantWebSourceService({
    revisionService,
    evidenceService: new GrantEvidenceService(revisionService, new SupabaseGrantEvidenceRepository(client, ownerId), new SupabaseGrantEvidenceStorage(client), new SharedGrantEvidenceParser()),
    repository: new SupabaseGrantWebSourceRepository(client, ownerId),
    searchProvider: new OpenAlexGrantWebSearchProvider(),
    fetcher: new PublicWebSnapshotFetcher(),
  });
}

export function createGrantExportService(ownerId: string): GrantExportService {
  const client = createGrantSupabaseClient();
  return new GrantExportService(
    new GrantRevisionService({ repository: new SupabaseGrantRevisionRepository(client, ownerId) }),
    new DeterministicGrantDocxRenderer(),
  );
}
