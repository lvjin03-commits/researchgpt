import { z } from "zod";

export type GrantDiagnosticValidationIssue = {
  path: string;
  code: string;
  rule: string;
  fieldClass: "structural" | "content" | "unknown";
  expectedType?: string;
  receivedType?: string;
  limit?: number;
};

const STRUCTURAL_FIELDS = new Set([
  "sectionId",
  "nodeId",
  "role",
  "usedEvidenceCardIds",
  "primaryLocation",
  "relatedLocations",
  "category",
  "scope",
  "confidence",
  "actionability",
  "modules",
  "relations",
  "sourceLocationRefs",
  "fromRole",
  "toRole",
  "presence",
  "affectedArgumentRoles",
  "occurrences",
  "evidenceBasis",
]);

const CONTENT_FIELDS = new Set([
  "title",
  "diagnosticFact",
  "reason",
  "recommendation",
  "possibleConsequence",
  "quote",
]);

function valueType(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function fieldClass(path: PropertyKey[]): GrantDiagnosticValidationIssue["fieldClass"] {
  const field = [...path].reverse().find((part): part is string => typeof part === "string");
  if (field && STRUCTURAL_FIELDS.has(field)) return "structural";
  if (field && CONTENT_FIELDS.has(field)) return "content";
  return "unknown";
}

function safeRule(issue: Record<string, unknown>): string {
  const code = typeof issue.code === "string" ? issue.code : "unknown";
  if (code === "invalid_format") {
    const format = typeof issue.format === "string" ? issue.format : "unknown";
    return `invalid_format:${format}`;
  }
  if (code === "too_small" || code === "too_big") {
    const origin = typeof issue.origin === "string" ? issue.origin : "value";
    return `${code}:${origin}`;
  }
  if (code === "invalid_type") return "invalid_type";
  if (code === "invalid_value") return "invalid_value";
  if (code === "unrecognized_keys") return "unrecognized_keys";
  if (code === "custom" && issue.message === "Related locations must be unique by section, node and role.") {
    return "related_location_duplicate";
  }
  return code === "custom" ? "custom_validation" : code;
}

/**
 * Converts Zod issues to durable diagnostic evidence without persisting grant
 * prose. Structural rules and value types are retained; received values and
 * free-form messages are deliberately excluded.
 */
export function safeGrantDiagnosticValidationIssues(error: z.ZodError): GrantDiagnosticValidationIssue[] {
  return error.issues.map((issue) => {
    const raw = issue as unknown as Record<string, unknown>;
    const path = issue.path.length > 0 ? issue.path.join(".") : "$";
    const minimum = typeof raw.minimum === "number" ? raw.minimum : undefined;
    const maximum = typeof raw.maximum === "number" ? raw.maximum : undefined;
    const expectedType = typeof raw.expected === "string" ? raw.expected : undefined;
    const receivedType = valueType(raw.input);
    const limit = minimum ?? maximum;
    return {
      path,
      code: issue.code,
      rule: safeRule(raw),
      fieldClass: fieldClass(issue.path),
      ...(expectedType ? { expectedType } : {}),
      ...(receivedType ? { receivedType } : {}),
      ...(limit !== undefined ? { limit } : {}),
    };
  });
}

export function isGrantStructuralReferenceFailure(issues: GrantDiagnosticValidationIssue[]): boolean {
  return issues.length > 0 && issues.every((issue) => {
    const referencePath = /(?:primaryLocation|relatedLocations|usedEvidenceCardIds)(?:\.|$)/.test(issue.path);
    const referenceRule = issue.rule === "invalid_format:uuid"
      || issue.rule === "invalid_type"
      || issue.rule === "related_location_duplicate";
    return issue.fieldClass === "structural" && referencePath && referenceRule;
  });
}
