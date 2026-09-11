import { randomUUID } from "node:crypto";
import type { StandardizedBillableUsage } from "../../ai/billable-usage.ts";
import { calculateUsagePrice } from "../../billing/domain/price-catalog.ts";
import type { PriceCatalogRepository } from "../../billing/ports/price-catalog-repository.ts";
import { sha256Canonical } from "../domain/canonical-json.ts";
import {
  GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION,
  GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION,
  GRANT_WEB_QUERY_REWRITE_OPERATION,
  GRANT_WEB_SOURCE_ASSESS_OPERATION,
  resolveGrantModelOperationPolicy,
  type GrantModelFailureCategory,
} from "../model-execution/operation-registry.ts";
import { getGrantWebBudgetOperationPolicy } from "../model-execution/web-budget-operation-policies.ts";
import type { GrantWebBudgetOperationKey } from "./grant-web-budgeted-phase-orchestrator.ts";
import { GrantWebModelError, type GrantWebGroundingModel } from "../ports/grant-web-grounding-model.ts";
import type { GrantWebGroundingRepository } from "../ports/grant-web-grounding-repository.ts";
import {
  GrantWebQueryRewriteProposalSchema,
  validateGrantWebSourceAssessments,
  type GrantWebSourceRecord,
} from "../web-sources/contracts.ts";
import { assembleGrantWebGroundedAnswer, GrantWebGroundingError } from "../web-sources/grounded-answer-assembler.ts";
import { revalidateGrantWebCheckpoint, type GrantWebResumableCheckpoint } from "../web-sources/resumable-checkpoint.ts";
import { GrantGeneralWebSearchService } from "./grant-general-web-search-service.ts";
import { GrantModelExecutionError, GrantModelExecutor } from "./grant-model-executor.ts";
import type { GrantWebContinuationStepExecutor, GrantWebContinuationStepResult } from "./grant-web-budget-commands.ts";
import { GrantWebResumablePhaseExecutor, type GrantWebCheckpointArtifact } from "./grant-web-resumable-flow.ts";

export type GrantWebContinuationContext = Readonly<{
  question: string;
  applicationContext: string;
  documentTextForEgressCheck: string;
  sensitiveTerms: readonly string[];
  assistantSessionId: string;
  sourceRevision: number;
  contextHash: string;
  authorizationFingerprint: string;
}>;

export interface GrantWebContinuationContextLoader {
  load(checkpoint: GrantWebResumableCheckpoint): Promise<GrantWebContinuationContext>;
}

function classifyModelFailure(error: unknown): GrantModelFailureCategory {
  if (error instanceof GrantWebModelError) return error.category;
  if (error instanceof GrantWebGroundingError) {
    return error.category === "assessment_invalid" || error.category === "grounded_answer_empty"
      ? "structured_output_invalid" : "structured_reference_invalid";
  }
  if (error && typeof error === "object" && "name" in error && error.name === "ZodError") {
    return "structured_output_invalid";
  }
  return "unknown_provider_failure";
}

function tokenUsage(usage: { inputTokens: number; outputTokens: number; reasoningTokens: number }): StandardizedBillableUsage {
  return { kind: "tokens", inputTokens: usage.inputTokens, cachedInputTokens: 0,
    outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens };
}

export class GrantWebConcreteContinuationStepExecutor implements GrantWebContinuationStepExecutor {
  private readonly dependencies: {
    phases: GrantWebResumablePhaseExecutor;
    contextLoader: GrantWebContinuationContextLoader;
    model: GrantWebGroundingModel;
    modelExecutor: GrantModelExecutor;
    searchService: GrantGeneralWebSearchService;
    sourceRepository: GrantWebGroundingRepository;
    prices: PriceCatalogRepository;
    configuredGrantModelId: string;
    createId?: () => string;
    now?: () => string;
  };

  constructor(dependencies: GrantWebConcreteContinuationStepExecutor["dependencies"]) {
    this.dependencies = dependencies;
  }

  async execute(input: Parameters<GrantWebContinuationStepExecutor["execute"]>[0]): Promise<GrantWebContinuationStepResult> {
    const context = await this.dependencies.contextLoader.load(input.checkpoint);
    const current = revalidateGrantWebCheckpoint({ checkpoint: input.checkpoint,
      sourceRevision: context.sourceRevision, contextHash: context.contextHash,
      authorizationFingerprint: context.authorizationFingerprint });
    if (current.invalidated.length > 0) {
      return { status: "advanced", state: input.state, checkpoint: current.checkpoint };
    }
    const checkpoint = current.checkpoint;
    const phaseId = this.createId();
    if (input.operation === "query_rewrite") {
      return this.runModelPhase({ input, checkpoint, context, phaseId, operationKey: "query_rewrite",
        operation: GRANT_WEB_QUERY_REWRITE_OPERATION, artifactOperation: "query_rewrite",
        invoke: (attemptPurpose) => this.dependencies.model.rewriteQuery({ question: context.question,
          admittedApplicationContext: context.applicationContext, attemptPurpose }),
        parse: (value) => GrantWebQueryRewriteProposalSchema.parse(value) });
    }
    if (input.operation === "search_query") return this.runSearchPhase({ input, checkpoint, context, phaseId });
    if (input.operation === "source_assessment") {
      const sources = this.requireSources(checkpoint);
      return this.runModelPhase({ input, checkpoint, context, phaseId, operationKey: "source_assessment",
        operation: GRANT_WEB_SOURCE_ASSESS_OPERATION, artifactOperation: "source_assessment",
        invoke: (attemptPurpose) => this.dependencies.model.assess({ question: context.question,
          admittedApplicationContext: context.applicationContext, sources, attemptPurpose }),
        parse: (value) => {
          validateGrantWebSourceAssessments({ proposal: value, sources });
          return value;
        } });
    }
    const sources = this.deliverySources(checkpoint, input.operation === "existing_results_delivery");
    const operationKey = input.operation;
    const operation = input.operation === "existing_results_delivery"
      ? GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION : GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION;
    return this.runModelPhase({ input, checkpoint, context, phaseId, operationKey, operation,
      artifactOperation: operationKey, deliveryOutcome: input.operation === "existing_results_delivery" ? "partial" : "complete",
      invoke: (attemptPurpose) => this.dependencies.model.synthesize({ question: context.question,
        admittedApplicationContext: context.applicationContext, sources, attemptPurpose,
        maximumOutputTokens: getGrantWebBudgetOperationPolicy(operationKey).maximumOutputTokens }),
      parse: (value) => {
        const assessment = checkpoint.assessment ?? { assessments: checkpoint.search!.sources.map((source) => ({
          sourceId: source.sourceId, disposition: "recommended" as const, reason: "Available saved result",
        })) };
        assembleGrantWebGroundedAnswer({ sources: checkpoint.search!.sources, assessmentProposal: assessment,
          answerProposal: value });
        return value;
      } });
  }

  async getProtectedDeliveryMaximumPoints(): Promise<number> {
    const policy = getGrantWebBudgetOperationPolicy("answer_synthesis");
    const attempts = policy.maximumProviderAttempts;
    const quote = await this.quote("answer_synthesis", [tokenUsage({
      inputTokens: policy.maximumInputTokens * attempts,
      outputTokens: policy.maximumOutputTokens * attempts,
      reasoningTokens: 0,
    })]);
    return quote.maximumChargePoints;
  }

  private async runSearchPhase(input: {
    input: Parameters<GrantWebContinuationStepExecutor["execute"]>[0]; checkpoint: GrantWebResumableCheckpoint;
    context: GrantWebContinuationContext; phaseId: string;
  }): Promise<GrantWebContinuationStepResult> {
    if (!input.checkpoint.query) throw new Error("Search requires a saved query rewrite.");
    const operationKey = "search_query" as const;
    const policy = getGrantWebBudgetOperationPolicy(operationKey);
    const quote = await this.quote(operationKey, [
      { kind: "tool_call", tool: "openai_web_search", count: policy.maximumToolCalls },
      tokenUsage({ inputTokens: policy.maximumInputTokens, outputTokens: policy.maximumOutputTokens, reasoningTokens: 0 }),
    ]);
    const result = await this.dependencies.phases.execute({ state: input.input.state, checkpoint: input.checkpoint,
      phaseId: input.phaseId, quote, plannedCall: this.plannedCall(operationKey), artifactOperation: operationKey,
      invoke: async () => {
        const queries = this.researchQueries(input.checkpoint.query!.query);
        const searches: Array<{
          status: "completed" | "no_results";
          searchAuditId: string;
          sources: GrantWebSourceRecord[];
          providerUsage: { webSearchCalls: number; inputTokens: number; cachedInputTokens: number;
            outputTokens: number; reasoningTokens: number };
        }> = [];
        for (const candidateQuery of queries) {
          const search = await this.dependencies.searchService.search({ documentId: input.checkpoint.documentId,
            sourceRevision: input.context.sourceRevision, actorId: input.input.state.ownerId,
            assistantSessionId: input.context.assistantSessionId, turnId: input.checkpoint.turnId,
            candidateQuery, documentText: input.context.documentTextForEgressCheck,
            sensitiveTerms: input.context.sensitiveTerms, maximumResults: 8,
            billingOperationId: input.phaseId });
          if (search.status === "blocked") throw new Error("A planned academic query failed the egress policy.");
          searches.push(search);
        }
        const completed = searches.filter((search) => search.status === "completed");
        if (completed.length === 0) throw new Error("The structured academic searches returned no abstracts.");
        const seen = new Set<string>();
        const sources = completed.flatMap((search) => search.sources).filter((source) => {
          const identity = source.providerRecordId ?? source.canonicalUrl;
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        }).slice(0, 25);
        const usage: StandardizedBillableUsage[] = completed.flatMap((search) => [
          { kind: "tool_call" as const, tool: "openai_web_search", count: search.providerUsage.webSearchCalls },
          { kind: "tokens" as const, inputTokens: search.providerUsage.inputTokens,
            cachedInputTokens: search.providerUsage.cachedInputTokens,
            outputTokens: search.providerUsage.outputTokens, reasoningTokens: search.providerUsage.reasoningTokens },
        ]);
        const searchAuditIds = completed.map((search) => search.searchAuditId);
        return { value: { searches, sources }, artifact: { operation: "search_query", value: {
          searchAuditId: searchAuditIds[0]!, searchAuditIds, sources } },
          chargedPoints: await this.actualCharge(quote.pricePolicyVersion, usage) };
      } });
    return this.toStepResult(result, input.checkpoint);
  }

  private async runModelPhase<T>(input: {
    input: Parameters<GrantWebContinuationStepExecutor["execute"]>[0]; checkpoint: GrantWebResumableCheckpoint;
    context: GrantWebContinuationContext; phaseId: string;
    operationKey: "query_rewrite" | "source_assessment" | "answer_synthesis" | "existing_results_delivery";
    operation: typeof GRANT_WEB_QUERY_REWRITE_OPERATION | typeof GRANT_WEB_SOURCE_ASSESS_OPERATION |
      typeof GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION | typeof GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION;
    artifactOperation: GrantWebCheckpointArtifact["operation"];
    invoke: (attemptPurpose: "initial" | "schema_repair" | "capacity_retry" | "transient_retry") => Promise<{ value: T; outputHash: string;
      providerRequestId?: string; usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number } }>;
    parse: (value: T) => unknown;
    deliveryOutcome?: "complete" | "partial";
  }): Promise<GrantWebContinuationStepResult> {
    const policy = getGrantWebBudgetOperationPolicy(input.operationKey);
    const attempts = policy.maximumProviderAttempts;
    const quote = await this.quote(input.operationKey, [tokenUsage({ inputTokens: policy.maximumInputTokens * attempts,
      outputTokens: policy.maximumOutputTokens * attempts, reasoningTokens: 0 })]);
    const result = await this.dependencies.phases.execute({ state: input.input.state, checkpoint: input.checkpoint,
      phaseId: input.phaseId, quote, plannedCall: this.plannedCall(input.operationKey),
      artifactOperation: input.artifactOperation,
      invoke: async () => {
        const execution = await this.dependencies.modelExecutor.execute<T>({ documentId: input.checkpoint.documentId,
          sessionId: input.context.assistantSessionId, turnId: input.checkpoint.turnId,
          billingOperationId: input.phaseId, traceId: input.phaseId,
          inputHash: sha256Canonical({ operation: input.operation, checkpoint: input.checkpoint }),
          policy: resolveGrantModelOperationPolicy({ operation: input.operation,
            configuredGrantModelId: this.dependencies.configuredGrantModelId }),
          classifyFailure: classifyModelFailure,
          invoke: async ({ attemptPurpose }) => {
            const response = await input.invoke(attemptPurpose);
            input.parse(response.value);
            return response;
          },
        });
        const artifact = { operation: input.artifactOperation, value: execution.value } as GrantWebCheckpointArtifact;
        return { value: execution.value, artifact,
          chargedPoints: await this.actualCharge(quote.pricePolicyVersion, [tokenUsage(execution.usage)]),
          ...(input.deliveryOutcome ? { deliveryOutcome: input.deliveryOutcome } : {}) };
      } });
    return this.toStepResult(result, input.checkpoint);
  }

  private async quote(operationKey: GrantWebBudgetOperationKey, maximumUsage: StandardizedBillableUsage[]) {
    const operation = getGrantWebBudgetOperationPolicy(operationKey).operation;
    const policy = await this.dependencies.prices.getPolicy({ operation, provider: "openai",
      modelId: this.dependencies.configuredGrantModelId, at: this.now() });
    if (!policy) throw new Error(`No active price policy for ${operation}.`);
    return { operation, pricePolicyVersion: policy.policyVersion,
      maximumChargePoints: calculateUsagePrice({ policy, usage: maximumUsage }).points };
  }

  private async actualCharge(policyVersion: string, usage: StandardizedBillableUsage[]) {
    const policy = await this.dependencies.prices.getPolicyByVersion(policyVersion);
    if (!policy) throw new Error("Frozen Grant web price policy is unavailable.");
    return calculateUsagePrice({ policy, usage }).points;
  }

  private plannedCall(operationKey: Parameters<typeof getGrantWebBudgetOperationPolicy>[0]) {
    const policy = getGrantWebBudgetOperationPolicy(operationKey);
    return { inputTokens: policy.maximumInputTokens, outputTokens: policy.maximumOutputTokens,
      toolCalls: policy.maximumToolCalls, providerAttempts: policy.maximumProviderAttempts,
      timeoutMilliseconds: policy.timeoutMilliseconds, maximumResults: policy.maximumResults };
  }

  private toStepResult(result: Awaited<ReturnType<GrantWebResumablePhaseExecutor["execute"]>>,
    checkpoint: GrantWebResumableCheckpoint): GrantWebContinuationStepResult {
    if (result.status === "awaiting_budget") return { ...result, checkpoint };
    const nextCheckpoint = result.value && typeof result.value === "object" && "checkpoint" in result.value
      ? (result.value as { checkpoint: GrantWebResumableCheckpoint }).checkpoint : undefined;
    if (!nextCheckpoint) {
      throw new Error("A completed Grant web phase must expose its checkpoint artifact.");
    }
    return { status: "advanced", state: result.state, checkpoint: nextCheckpoint };
  }

  private requireSources(checkpoint: GrantWebResumableCheckpoint) {
    if (!checkpoint.search?.sources.length) throw new Error("Grant web phase requires saved search results.");
    return checkpoint.search.sources;
  }

  private deliverySources(checkpoint: GrantWebResumableCheckpoint, allowAll: boolean): GrantWebSourceRecord[] {
    const sources = this.requireSources(checkpoint);
    if (allowAll || !checkpoint.assessment) return sources;
    const recommended = new Set(checkpoint.assessment.assessments
      .filter((item) => item.disposition === "recommended").map((item) => item.sourceId));
    const selected = sources.filter((source) => recommended.has(source.sourceId));
    if (selected.length === 0) throw new Error("No recommended Grant web sources are available.");
    return selected;
  }

  private researchQueries(baseQuery: string): string[] {
    const normalized = baseQuery.trim().replace(/\s+/gu, " ");
    return [
      `${normalized} recent review advances`,
      `${normalized} mechanism solvation interface`,
      `${normalized} quantitative electrochemical performance`,
      `${normalized} dynamic interface electric field`,
      `${normalized} application limitations research gap`,
    ].map((query) => query.slice(0, 160));
  }

  private createId() { return (this.dependencies.createId ?? randomUUID)(); }
  private now() { return (this.dependencies.now ?? (() => new Date().toISOString()))(); }
}
