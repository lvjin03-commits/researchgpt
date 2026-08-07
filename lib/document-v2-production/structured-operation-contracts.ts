import {
  DocumentFigureIntentsDraftSchema,
  DocumentSectionIndexDraftSchema,
  DocumentThesisDraftSchema,
  SectionPlanDraftSchema,
  normalizeFigureIntentCandidate,
  normalizeSectionIndexCandidate,
} from "@/lib/document-v2/planning/contracts";
import type { ZodType } from "zod";
import type {
  StructuredOperationRecoveryPolicy,
} from "./text-executor";
import type { StructuredResponseCandidateNormalization } from "./structured-response-parser";

const PLANNING_RECOVERY_POLICY = Object.freeze({
  onNoJsonObject: "regenerate_once",
  onTruncatedJson: "regenerate_once",
  onJsonSyntaxError: "regenerate_once",
  onSchemaValidationFailed: "repair_once",
  onInvariantFailure: "pause",
} satisfies StructuredOperationRecoveryPolicy);

const COMPONENT_RECOVERY_POLICY = Object.freeze({
  onNoJsonObject: "regenerate_once",
  onTruncatedJson: "regenerate_once",
  onJsonSyntaxError: "regenerate_once",
  onSchemaValidationFailed: "repair_once",
  onInvariantFailure: "pause",
} satisfies StructuredOperationRecoveryPolicy);

/**
 * Component-specific structured-output recovery. This contract repairs only
 * provider output shape; semantic/business validation remains authoritative in
 * the orchestrator and shares the same component provider-call budget.
 */
export function createComponentGenerationRecoveryContract() {
  return COMPONENT_RECOVERY_POLICY;
}

type PlanningContractInput<T> = {
  operation: string;
  budgetKey:
    | "request.understand"
    | "template.match"
    | "outline.thesis"
    | "outline.section_index"
    | "outline.figure_intents"
    | "outline.section_plan";
  componentKey?: string;
  schemaName: string;
  schema: ZodType<T>;
  validateCandidate?: (value: T) => void;
  normalizeCandidate?: (
    value: unknown,
  ) => StructuredResponseCandidateNormalization;
};

function planningContract<T>(input: PlanningContractInput<T>) {
  return Object.freeze({
    ...input,
    recoveryPolicy: PLANNING_RECOVERY_POLICY,
  });
}

export function createRequestUnderstandOperationContract<T>(input: {
  schema: ZodType<T>;
}) {
  return planningContract({
    operation: "request.understand",
    budgetKey: "request.understand",
    schemaName: "document_request_v1",
    schema: input.schema,
  });
}

export function createTemplateMatchOperationContract<T>(input: {
  schema: ZodType<T>;
}) {
  return planningContract({
    operation: "template.match",
    budgetKey: "template.match",
    schemaName: "template_match_v1",
    schema: input.schema,
  });
}

export function createThesisOperationContract() {
  return planningContract({
    operation: "outline.thesis",
    budgetKey: "outline.thesis",
    componentKey: "document-thesis",
    schemaName: "document_thesis_v1",
    schema: DocumentThesisDraftSchema,
  });
}

/**
 * Operation-owned structured-output rules. The executor owns the lifecycle;
 * this contract owns only the schema and deterministic recovery whitelist.
 */
export function createSectionIndexOperationContract(input: {
  minimumSections: number;
  maximumSections: number;
}) {
  return planningContract({
    operation: "outline.section_index",
    budgetKey: "outline.section_index" as const,
    componentKey: "document-section-index",
    schemaName: "document_section_index_v1",
    schema: DocumentSectionIndexDraftSchema.refine(
      (value) =>
        value.sections.length >= input.minimumSections &&
        value.sections.length <= input.maximumSections,
      "Section count is outside the template limits.",
    ),
    normalizeCandidate: normalizeSectionIndexCandidate,
  });
}


export function createFigureIntentsOperationContract() {
  return planningContract({
    operation: "outline.figure_intents",
    budgetKey: "outline.figure_intents",
    componentKey: "document-figure-intents",
    schemaName: "document_figure_intents_v1",
    schema: DocumentFigureIntentsDraftSchema,
    normalizeCandidate: normalizeFigureIntentCandidate,
  });
}

export function createSectionPlanOperationContract(input: {
  componentKey: string;
  availableEvidenceIds: ReadonlyArray<string>;
}) {
  const available = new Set(input.availableEvidenceIds);
  return planningContract({
    operation: "outline.section_plan",
    budgetKey: "outline.section_plan",
    componentKey: input.componentKey,
    schemaName: "document_section_plan_v1",
    schema: SectionPlanDraftSchema,
    validateCandidate: (candidate) => {
      for (const id of candidate.requiredEvidenceIds) {
        if (!available.has(id)) {
          throw new Error(`Unavailable evidence ID: ${id}`);
        }
      }
    },
  });
}
