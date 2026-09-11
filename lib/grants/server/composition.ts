import "server-only";
import { randomUUID } from "node:crypto";
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
import { GrantAssistantChatService } from "../application/grant-assistant-chat-service.ts";
import { GrantCandidateDiffService } from "../application/grant-candidate-diff-service.ts";
import { GrantModelExecutor } from "../application/grant-model-executor.ts";
import { SupabaseGrantAiEditSessionRepository } from "../infrastructure/supabase/supabase-grant-ai-edit-session-repository.ts";
import { SupabaseGrantModelCallRepository } from "../infrastructure/supabase/supabase-grant-model-call-repository.ts";
import { SupabaseGrantAssistantSessionRepository } from "../infrastructure/supabase/supabase-grant-assistant-session-repository.ts";
import { GrantWebSourceService } from "../application/grant-web-source-service.ts";
import { SupabaseGrantWebSourceRepository } from "../infrastructure/supabase/supabase-grant-web-source-repository.ts";
import { OpenAlexGrantWebSearchProvider, PublicWebSnapshotFetcher } from "../infrastructure/web/openalex-grant-web-source.ts";
import { AiUsageIntegration } from "../../billing/application/ai-usage-integration.ts";
import { SupabaseAiUsageEventSink } from "../../billing/infrastructure/supabase/supabase-ai-usage-event-sink.ts";
import { tokenUsage } from "../../ai/billable-usage.ts";
import { AI_OPERATIONS } from "../../ai/operation-registry.ts";
import { isGrantWebGroundingEnabled } from "./config.ts";
import { OpenAIGrantWebGroundingModel } from "../infrastructure/model/openai-grant-web-grounding-model.ts";
import { OpenAIWebSearchProvider } from "../infrastructure/model/openai-web-search-provider.ts";
import { SupabaseGrantWebGroundingRepository } from "../infrastructure/supabase/supabase-grant-web-grounding-repository.ts";
import { SupabaseGrantWebSearchEgressAuditRepository } from "../infrastructure/supabase/supabase-grant-web-search-egress-audit-repository.ts";
import { GrantGeneralWebSearchService } from "../application/grant-general-web-search-service.ts";
import { GrantWebGroundedChatOrchestrator } from "../application/grant-web-grounded-chat-orchestrator.ts";
import { GrantWebGroundedChargingAdapter } from "./grant-web-grounded-charging-adapter.ts";
import { SupabasePointLedgerRepository } from "../../billing/infrastructure/supabase/supabase-point-ledger-repository.ts";
import { SupabasePriceCatalogRepository } from "../../billing/infrastructure/supabase/supabase-price-catalog-repository.ts";
import { PointBillingService } from "../../billing/application/point-billing-service.ts";
import { AtomicDeliveryChargingCoordinator } from "../../billing/application/atomic-delivery-charging-coordinator.ts";
import { AtomicDeliveryCanaryChargingCoordinator } from "../../billing/application/atomic-delivery-canary-charging-coordinator.ts";
import { resolveChargingRolloutPolicy } from "../../billing/domain/charging-rollout.ts";

function createGrantSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) throw new Error("Grant workspace database configuration is incomplete.");
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function createGrantModelExecutor(
  client: ReturnType<typeof createGrantSupabaseClient>,
  ownerId: string,
  repository = new SupabaseGrantModelCallRepository(client, ownerId),
) {
  const usage = new AiUsageIntegration(new SupabaseAiUsageEventSink(client, {
    feature: "grant",
    taskKind: "grant_model_call",
  }));
  return new GrantModelExecutor(repository, undefined, undefined, async (event) => {
    await usage.record(ownerId, {
      usageEventId: event.usageEventId,
      billingOperationId: event.billingOperationId,
      operation: event.operation,
      provider: event.provider,
      modelId: event.modelId,
      attemptNumber: event.attemptNumber,
      cacheHit: false,
      usage: [tokenUsage(event.usage)],
      occurredAt: event.occurredAt,
    });
  });
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
    modelExecutor: createGrantModelExecutor(client, ownerId),
    patchService: patches,
    configuredGrantModelId: ai.config.modelId,
  });
}

export function createGrantAssistantChatService(ownerId: string): GrantAssistantChatService {
  const client = createGrantSupabaseClient();
  const ai = createGrantModelDataGateway(client, ownerId);
  const modelCalls = new SupabaseGrantModelCallRepository(client, ownerId);
  const webRuntime = createGrantWebGroundedChatRuntime(ownerId);
  return new GrantAssistantChatService({
    revisionService: new GrantRevisionService({ repository: new SupabaseGrantRevisionRepository(client, ownerId) }),
    modelGateway: ai.gateway,
    modelExecutor: createGrantModelExecutor(client, ownerId, modelCalls),
    modelCalls,
    configuredGrantModelId: ai.config.modelId,
    sessions: new SupabaseGrantAssistantSessionRepository(client, ownerId),
    editSessions: new SupabaseGrantAiEditSessionRepository(client, ownerId),
    ...(webRuntime ? { webGrounding: { actorId: ownerId, orchestrator: webRuntime.orchestrator } } : {}),
  });
}

export function createGrantWebGroundedChatRuntime(ownerId: string) {
  if (!isGrantWebGroundingEnabled()) return null;
  const client = createGrantSupabaseClient();
  const ai = createGrantModelDataGateway(client, ownerId);
  if (!ai.config.apiKey) return null;
  const sourceRepository = new SupabaseGrantWebGroundingRepository(client, ownerId);
  const provider = new OpenAIWebSearchProvider({ apiKey: ai.config.apiKey, modelId: ai.config.modelId });
  const searchUsage = new AiUsageIntegration(new SupabaseAiUsageEventSink(client, {
    feature: "grant",
    taskKind: "grant_web_search",
  }));
  const searchService = new GrantGeneralWebSearchService({
    provider,
    auditRepository: new SupabaseGrantWebSearchEgressAuditRepository(client, ownerId),
    sourceRepository,
    onProviderUsage: async (event) => searchUsage.record(ownerId, {
      usageEventId: randomUUID(),
      billingOperationId: event.billingOperationId,
      operation: AI_OPERATIONS.grant.webSearchQuery,
      provider: "openai",
      modelId: ai.config.modelId,
      attemptNumber: 1,
      cacheHit: false,
      usage: [
        { kind: "tool_call", tool: "openai_web_search", count: event.webSearchCalls },
        { kind: "tokens", inputTokens: event.inputTokens, cachedInputTokens: event.cachedInputTokens,
          outputTokens: event.outputTokens, reasoningTokens: event.reasoningTokens },
      ],
      occurredAt: event.occurredAt,
    }),
  });
  const orchestrator = new GrantWebGroundedChatOrchestrator({
    model: new OpenAIGrantWebGroundingModel(ai.config.modelId, ai.config.apiKey),
    modelExecutor: createGrantModelExecutor(client, ownerId),
    searchService,
    sourceRepository,
    configuredGrantModelId: ai.config.modelId,
  });
  const ledger = new SupabasePointLedgerRepository(client);
  const billing = new PointBillingService({
    ledger,
    prices: new SupabasePriceCatalogRepository(client),
  });
  const charging = new AtomicDeliveryCanaryChargingCoordinator({
    atomic: new AtomicDeliveryChargingCoordinator(billing),
    ledger,
    rollout: resolveChargingRolloutPolicy(),
  });
  return Object.freeze({
    modelGateway: ai.gateway,
    orchestrator: new GrantWebGroundedChargingAdapter({ orchestrator, charging, modelId: ai.config.modelId }),
  });
}

export function createGrantCandidateDiffService(ownerId: string): GrantCandidateDiffService {
  const client = createGrantSupabaseClient();
  return new GrantCandidateDiffService({
    repository: new SupabaseGrantAiEditSessionRepository(client, ownerId),
    revisionService: new GrantRevisionService({ repository: new SupabaseGrantRevisionRepository(client, ownerId) }),
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
