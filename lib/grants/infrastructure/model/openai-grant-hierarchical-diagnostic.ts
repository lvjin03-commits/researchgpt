import OpenAI from "openai";
import {
  GrantArgumentMapV1Schema,
  GrantHierarchicalDiagnosticStageStateSchema,
  type GrantArgumentMapV1,
  type GrantHierarchicalDiagnosticStageState,
  type GrantRootDiagnosticResultV1,
} from "../../diagnostics/hierarchical-semantic-contracts.ts";
import {
  buildGrantRootDiagnosticModelInputV1,
  type GrantHierarchicalDiagnosticPreparedInputV1,
} from "../../diagnostics/hierarchical-semantic-input.ts";
import {
  GrantArgumentMapExecutionError,
  executeGrantArgumentMapV1,
} from "./openai-grant-argument-map.ts";
import {
  GrantRootDiagnosticExecutionError,
  executeGrantRootDiagnosticV1,
  type GrantRootDiagnosticExecutionFailureCode,
} from "./openai-grant-root-diagnostic.ts";
import {
  textOnlyGrantDiagnosticImageAdmission,
  type GrantDiagnosticImageAdmissionProvider,
  type GrantDiagnosticImageCoverage,
} from "../../diagnostics/multimodal-diagnostic-input.ts";

export const GRANT_HIERARCHICAL_DIAGNOSTIC_CALL_BUDGET_V1 = {
  argumentMapMaxCalls: 1,
  rootDiagnosisMaxCalls: 2,
  totalMaxCalls: 3,
} as const;

type Usage = { inputTokens: number; outputTokens: number; reasoningTokens: number };

export type GrantHierarchicalDiagnosticExecutionResultV1 = {
  argumentMap: GrantArgumentMapV1;
  rootDiagnosis: GrantRootDiagnosticResultV1;
  stages: GrantHierarchicalDiagnosticStageState[];
  providerCallCount: number;
  usage: Usage;
  resumedFromArgumentMap: boolean;
  imageCoverage: GrantDiagnosticImageCoverage;
};

export class GrantHierarchicalDiagnosticExecutionError extends Error {
  readonly failureCode: string;
  readonly stages: GrantHierarchicalDiagnosticStageState[];
  readonly providerCallCount: number;
  readonly usage: Usage;
  readonly argumentMapCheckpoint?: GrantArgumentMapV1;
  readonly imageCoverage: GrantDiagnosticImageCoverage;

  constructor(input: {
    failureCode: string;
    message: string;
    stages: GrantHierarchicalDiagnosticStageState[];
    providerCallCount: number;
    usage: Usage;
    argumentMapCheckpoint?: GrantArgumentMapV1;
    imageCoverage: GrantDiagnosticImageCoverage;
  }) {
    super(input.message);
    this.name = "GrantHierarchicalDiagnosticExecutionError";
    this.failureCode = input.failureCode;
    this.stages = input.stages;
    this.providerCallCount = input.providerCallCount;
    this.usage = input.usage;
    this.argumentMapCheckpoint = input.argumentMapCheckpoint;
    this.imageCoverage = input.imageCoverage;
  }
}

function stage(input: GrantHierarchicalDiagnosticStageState): GrantHierarchicalDiagnosticStageState {
  return GrantHierarchicalDiagnosticStageStateSchema.parse(input);
}

function addUsage(target: Usage, source: Usage): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningTokens += source.reasoningTokens;
}

function rootRetry(error: GrantRootDiagnosticExecutionError): {
  purpose: "capacity_retry" | "schema_repair" | "transient_retry";
  repairInstruction?: string;
  maxCompletionTokens?: number;
} | null {
  if (error.code === "root_diagnosis_output_truncated") {
    return { purpose: "capacity_retry", maxCompletionTokens: 14000 };
  }
  if (error.code === "root_diagnosis_structured_output_invalid") {
    const paths = (error.metadata.validationIssues ?? []).map((issue) => issue.path);
    return {
      purpose: "schema_repair",
      repairInstruction: `Correct only the prior structured-output contract failure. Return a complete result using only supplied atomic location references and Evidence Card IDs. Invalid paths: ${paths.length > 0 ? paths.join(", ") : "$"}.`,
    };
  }
  if (error.code === "root_diagnosis_provider_failure" && error.metadata.retryableProviderFailure === true) {
    return { purpose: "transient_retry" };
  }
  return null;
}

/**
 * Unified call-budget owner for the two target operations. Persistence and UI
 * projection remain later steps; a successful ArgumentMap is exposed as a safe
 * checkpoint so recovery can skip the already-paid first stage.
 */
export async function executeGrantHierarchicalDiagnosticV1(input: {
  client: OpenAI;
  modelId: string;
  prepared: GrantHierarchicalDiagnosticPreparedInputV1;
  argumentMapCheckpoint?: GrantArgumentMapV1;
  imageAdmission?: GrantDiagnosticImageAdmissionProvider;
}): Promise<GrantHierarchicalDiagnosticExecutionResultV1> {
  const usage: Usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  let providerCallCount = 0;
  let argumentMap: GrantArgumentMapV1;
  let imageCoverage = textOnlyGrantDiagnosticImageAdmission({
    candidateCount: input.prepared.figureLocationRefByAssetId.size,
    reasons: input.prepared.figureLocationRefByAssetId.size === 0 ? ["no_figures_in_scope"] : ["not_authorized"],
  }).coverage;
  const resumedFromArgumentMap = input.argumentMapCheckpoint !== undefined;

  if (input.argumentMapCheckpoint) {
    argumentMap = GrantArgumentMapV1Schema.parse(input.argumentMapCheckpoint);
    if (argumentMap.sourceRevisionId !== input.prepared.sourceRevisionId) {
      throw new Error("ArgumentMap checkpoint belongs to a different grant revision.");
    }
  } else {
    try {
      providerCallCount += 1;
      const mapped = await executeGrantArgumentMapV1({ client: input.client, modelId: input.modelId, prepared: input.prepared });
      addUsage(usage, mapped.usage);
      argumentMap = mapped.argumentMap;
    } catch (error) {
      if (error instanceof GrantArgumentMapExecutionError) addUsage(usage, error.metadata);
      const failureCode = error instanceof GrantArgumentMapExecutionError ? error.code : "argument_map_provider_failure";
      throw new GrantHierarchicalDiagnosticExecutionError({
        failureCode,
        message: error instanceof Error ? error.message : "Argument mapping failed.",
        providerCallCount,
        usage,
        stages: [
          stage({ stage: "argument_mapping", status: "failed", sourceRevisionId: input.prepared.sourceRevisionId, failureCode }),
          stage({ stage: "root_diagnosis", status: "skipped", sourceRevisionId: input.prepared.sourceRevisionId, failureCode: null }),
          stage({ stage: "assembly", status: "not_started", sourceRevisionId: input.prepared.sourceRevisionId, failureCode: null }),
        ],
        imageCoverage,
      });
    }
  }

  try {
    buildGrantRootDiagnosticModelInputV1({ prepared: input.prepared, argumentMap });
  } catch (error) {
    throw new GrantHierarchicalDiagnosticExecutionError({
      failureCode: "root_diagnosis_reference_invalid",
      message: error instanceof Error ? error.message : "ArgumentMap checkpoint is outside the frozen diagnostic scope.",
      providerCallCount,
      usage,
      stages: [
        stage({ stage: "argument_mapping", status: "succeeded", sourceRevisionId: input.prepared.sourceRevisionId, failureCode: null }),
        stage({ stage: "root_diagnosis", status: "failed", sourceRevisionId: input.prepared.sourceRevisionId, failureCode: "root_diagnosis_reference_invalid" }),
        stage({ stage: "assembly", status: "not_started", sourceRevisionId: input.prepared.sourceRevisionId, failureCode: null }),
      ],
      imageCoverage,
    });
  }

  let lastRootError: GrantRootDiagnosticExecutionError | undefined;
  for (let rootAttempt = 1; rootAttempt <= GRANT_HIERARCHICAL_DIAGNOSTIC_CALL_BUDGET_V1.rootDiagnosisMaxCalls; rootAttempt += 1) {
    const retry = lastRootError ? rootRetry(lastRootError) : null;
    if (rootAttempt > 1 && !retry) break;
    if (providerCallCount >= GRANT_HIERARCHICAL_DIAGNOSTIC_CALL_BUDGET_V1.totalMaxCalls) break;
    try {
      providerCallCount += 1;
      const diagnosed = await executeGrantRootDiagnosticV1({
        client: input.client,
        modelId: input.modelId,
        prepared: input.prepared,
        argumentMap,
        attempt: {
          number: rootAttempt,
          purpose: retry?.purpose ?? "initial",
          recoveredFrom: lastRootError?.code,
          repairInstruction: retry?.repairInstruction,
          maxCompletionTokens: retry?.maxCompletionTokens,
        },
        imageAdmission: input.imageAdmission,
      });
      addUsage(usage, diagnosed.usage);
      imageCoverage = diagnosed.execution.imageCoverage;
      return {
        argumentMap,
        rootDiagnosis: diagnosed.result,
        providerCallCount,
        usage,
        resumedFromArgumentMap,
        imageCoverage,
        stages: [
          stage({ stage: "argument_mapping", status: "succeeded", sourceRevisionId: input.prepared.sourceRevisionId, failureCode: null }),
          stage({ stage: "root_diagnosis", status: "succeeded", sourceRevisionId: input.prepared.sourceRevisionId, failureCode: null }),
          stage({ stage: "assembly", status: "not_started", sourceRevisionId: input.prepared.sourceRevisionId, failureCode: null }),
        ],
      };
    } catch (error) {
      if (!(error instanceof GrantRootDiagnosticExecutionError)) throw error;
      addUsage(usage, error.metadata);
      imageCoverage = error.metadata.imageCoverage;
      lastRootError = error;
      if (!rootRetry(error)) break;
    }
  }

  const failureCode: GrantRootDiagnosticExecutionFailureCode = lastRootError?.code ?? "root_diagnosis_provider_failure";
  throw new GrantHierarchicalDiagnosticExecutionError({
    failureCode,
    message: lastRootError?.message ?? "Root diagnosis stopped without a usable result.",
    providerCallCount,
    usage,
    argumentMapCheckpoint: argumentMap,
    imageCoverage,
    stages: [
      stage({ stage: "argument_mapping", status: "succeeded", sourceRevisionId: input.prepared.sourceRevisionId, failureCode: null }),
      stage({ stage: "root_diagnosis", status: "failed", sourceRevisionId: input.prepared.sourceRevisionId, failureCode }),
      stage({ stage: "assembly", status: "not_started", sourceRevisionId: input.prepared.sourceRevisionId, failureCode: null }),
    ],
  });
}
