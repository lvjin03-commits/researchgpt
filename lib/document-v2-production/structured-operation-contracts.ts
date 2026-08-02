import {
  DocumentSectionIndexDraftSchema,
  normalizeSectionIndexCandidate,
} from "@/lib/document-v2/planning/contracts";

/**
 * Operation-owned structured-output rules. The executor owns the lifecycle;
 * this contract owns only the schema and deterministic recovery whitelist.
 */
export function createSectionIndexOperationContract(input: {
  minimumSections: number;
  maximumSections: number;
}) {
  return Object.freeze({
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
    recoveryPolicy: Object.freeze({
      regenerateOnNoJsonObject: true,
    }),
  });
}
