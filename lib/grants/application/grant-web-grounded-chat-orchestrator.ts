import { randomUUID } from "node:crypto";
import { sha256Canonical } from "../domain/canonical-json.ts";
import {
  GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION,
  GRANT_WEB_QUERY_REWRITE_OPERATION,
  GRANT_WEB_SOURCE_ASSESS_OPERATION,
  resolveGrantModelOperationPolicy,
  type GrantModelFailureCategory,
} from "../model-execution/operation-registry.ts";
import { GrantWebModelError, type GrantWebGroundingModel } from "../ports/grant-web-grounding-model.ts";
import type { GrantWebGroundingRepository } from "../ports/grant-web-grounding-repository.ts";
import { GrantWebQueryRewriteProposalSchema, validateGrantWebSourceAssessments } from "../web-sources/contracts.ts";
import { assembleGrantWebGroundedAnswer, GrantWebGroundingError } from "../web-sources/grounded-answer-assembler.ts";
import type { GrantWebGroundingAdmittedContext } from "./grant-model-data-gateway.ts";
import { GrantModelExecutionError, GrantModelExecutor } from "./grant-model-executor.ts";
import { GrantGeneralWebSearchService } from "./grant-general-web-search-service.ts";
import type { StandardizedBillableUsage } from "../../ai/billable-usage.ts";

export type GrantWebGroundedChatFallbackReason =
  | "query_rewrite_failed" | "egress_blocked" | "search_failed" | "no_results"
  | "assessment_failed" | "no_relevant_sources" | "synthesis_failed";

export type GrantWebGroundedChatResult =
  | { status: "fallback_required"; reason: GrantWebGroundedChatFallbackReason }
  | { status: "completed"; answer: ReturnType<typeof assembleGrantWebGroundedAnswer>["answer"];
      searchedCount: number; recommendedCount: number; excludedCount: number; usedSourceIds: string[];
      billingUsage: {
        queryRewrite: StandardizedBillableUsage[];
        search: StandardizedBillableUsage[];
        assessment: StandardizedBillableUsage[];
        answer: StandardizedBillableUsage[];
      };
      billingOperationIds: {
        queryRewrite: string; search: string; assessment: string; answer: string;
      } };

function modelTokenUsage(usage: { inputTokens: number; outputTokens: number; reasoningTokens: number }): StandardizedBillableUsage {
  return { kind: "tokens", inputTokens: usage.inputTokens, cachedInputTokens: 0,
    outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens };
}

function classifyModelFailure(error: unknown): GrantModelFailureCategory {
  if (error instanceof GrantWebModelError) return error.category;
  if (error instanceof GrantWebGroundingError) {
    return error.category === "assessment_invalid" || error.category === "grounded_answer_empty"
      ? "structured_output_invalid" : "structured_reference_invalid";
  }
  if (error && typeof error === "object" && "name" in error && error.name === "ZodError") return "structured_output_invalid";
  return "unknown_provider_failure";
}

export class GrantWebGroundedChatOrchestrator {
  private readonly dependencies: {
    model: GrantWebGroundingModel;
    modelExecutor: GrantModelExecutor;
    searchService: GrantGeneralWebSearchService;
    sourceRepository: GrantWebGroundingRepository;
    configuredGrantModelId: string;
    createId?: () => string;
    now?: () => string;
  };

  constructor(dependencies: GrantWebGroundedChatOrchestrator["dependencies"]) {
    this.dependencies = dependencies;
  }

  async run(input: {
    documentId: string; sourceRevision: number; actorId: string; assistantSessionId: string;
    turnId: string; question: string; context: GrantWebGroundingAdmittedContext;
    documentTextForEgressCheck: string; sensitiveTerms: readonly string[]; maximumResults?: number;
  }): Promise<GrantWebGroundedChatResult> {
    if (input.context.documentId !== input.documentId) return { status: "fallback_required", reason: "query_rewrite_failed" };
    const createId = this.dependencies.createId ?? randomUUID;
    const now = this.dependencies.now ?? (() => new Date().toISOString());
    const billingOperationIds = {
      queryRewrite: createId(), search: createId(), assessment: createId(), answer: createId(),
    };
    const execute = async <T>(operation: typeof GRANT_WEB_QUERY_REWRITE_OPERATION | typeof GRANT_WEB_SOURCE_ASSESS_OPERATION | typeof GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION,
      invoke: Parameters<GrantModelExecutor["execute"]>[0]["invoke"], inputValue: unknown,
      billingOperationId: string) => this.dependencies.modelExecutor.execute<T>({
        documentId: input.documentId, sessionId: input.assistantSessionId, turnId: input.turnId,
        billingOperationId,
        traceId: createId(), inputHash: sha256Canonical(inputValue),
        policy: resolveGrantModelOperationPolicy({ operation, configuredGrantModelId: this.dependencies.configuredGrantModelId }),
        invoke: invoke as never, classifyFailure: classifyModelFailure,
      });
    let rewritten;
    try {
      rewritten = await execute(GRANT_WEB_QUERY_REWRITE_OPERATION, async ({ attemptPurpose }) => {
        const result = await this.dependencies.model.rewriteQuery({ question: input.question,
          admittedApplicationContext: input.context.applicationContext, attemptPurpose });
        return { ...result, value: GrantWebQueryRewriteProposalSchema.parse(result.value) };
      }, { question: input.question, contextHash: input.context.contextHash }, billingOperationIds.queryRewrite);
    } catch (error) {
      if (error instanceof GrantModelExecutionError) return { status: "fallback_required", reason: "query_rewrite_failed" };
      throw error;
    }
    let search;
    try {
      search = await this.dependencies.searchService.search({
        documentId: input.documentId, sourceRevision: input.sourceRevision, actorId: input.actorId,
        assistantSessionId: input.assistantSessionId, turnId: input.turnId,
        candidateQuery: (rewritten.value as { query: string }).query,
        documentText: input.documentTextForEgressCheck, sensitiveTerms: input.sensitiveTerms,
        maximumResults: input.maximumResults,
        billingOperationId: billingOperationIds.search,
      });
    } catch { return { status: "fallback_required", reason: "search_failed" }; }
    if (search.status === "blocked") return { status: "fallback_required", reason: "egress_blocked" };
    if (search.status === "no_results") return { status: "fallback_required", reason: "no_results" };
    let assessed;
    try {
      assessed = await execute(GRANT_WEB_SOURCE_ASSESS_OPERATION, async ({ attemptPurpose }) => {
        const result = await this.dependencies.model.assess({ question: input.question,
          admittedApplicationContext: input.context.applicationContext, sources: search.sources, attemptPurpose });
        validateGrantWebSourceAssessments({ proposal: result.value, sources: search.sources });
        return result;
      }, { question: input.question, contextHash: input.context.contextHash,
        sourceFingerprints: search.sources.map((source) => source.contentFingerprint) }, billingOperationIds.assessment);
    } catch (error) {
      if (error instanceof GrantModelExecutionError) return { status: "fallback_required", reason: "assessment_failed" };
      throw error;
    }
    const assessments = validateGrantWebSourceAssessments({ proposal: assessed.value, sources: search.sources });
    await this.dependencies.sourceRepository.appendUsageEvents({ documentId: input.documentId, events: assessments.map((assessment) => ({
      usageEventId: createId(), documentId: input.documentId, assistantSessionId: input.assistantSessionId,
      turnId: input.turnId, searchAuditId: search.searchAuditId, sourceId: assessment.sourceId,
      contentFingerprint: search.sources.find((source) => source.sourceId === assessment.sourceId)!.contentFingerprint,
      eventType: assessment.disposition === "recommended" ? "recommended" as const : "excluded" as const, createdAt: now(),
    })) });
    const recommendedSources = search.sources.filter((source) => assessments.some((item) => item.sourceId === source.sourceId && item.disposition === "recommended"));
    if (recommendedSources.length === 0) return { status: "fallback_required", reason: "no_relevant_sources" };
    let assembled;
    let synthesizedUsage: { inputTokens: number; outputTokens: number; reasoningTokens: number } | undefined;
    try {
      const synthesized = await execute(GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION, async ({ attemptPurpose }) => {
        const result = await this.dependencies.model.synthesize({ question: input.question,
          admittedApplicationContext: input.context.applicationContext, sources: recommendedSources, attemptPurpose });
        assembleGrantWebGroundedAnswer({ sources: search.sources, assessmentProposal: assessed.value, answerProposal: result.value });
        return result;
      }, { question: input.question, contextHash: input.context.contextHash,
        recommendedSourceFingerprints: recommendedSources.map((source) => source.contentFingerprint) }, billingOperationIds.answer);
      synthesizedUsage = synthesized.usage;
      assembled = assembleGrantWebGroundedAnswer({ sources: search.sources, assessmentProposal: assessed.value, answerProposal: synthesized.value });
    } catch (error) {
      if (error instanceof GrantModelExecutionError) return { status: "fallback_required", reason: "synthesis_failed" };
      throw error;
    }
    await this.dependencies.sourceRepository.appendUsageEvents({ documentId: input.documentId, events: assembled.usedSourceIds.map((sourceId) => ({
      usageEventId: createId(), documentId: input.documentId, assistantSessionId: input.assistantSessionId,
      turnId: input.turnId, searchAuditId: search.searchAuditId, sourceId,
      contentFingerprint: search.sources.find((source) => source.sourceId === sourceId)!.contentFingerprint,
      eventType: "cited" as const, createdAt: now(),
    })) });
    return { status: "completed", ...assembled, billingUsage: {
      queryRewrite: [modelTokenUsage(rewritten.usage)],
      search: [
        { kind: "tool_call", tool: "openai_web_search", count: search.providerUsage.webSearchCalls },
        { kind: "tokens", inputTokens: search.providerUsage.inputTokens,
          cachedInputTokens: search.providerUsage.cachedInputTokens,
          outputTokens: search.providerUsage.outputTokens,
          reasoningTokens: search.providerUsage.reasoningTokens },
      ],
      assessment: [modelTokenUsage(assessed.usage)],
      answer: [modelTokenUsage(synthesizedUsage!)],
    }, billingOperationIds };
  }
}
