import type { StructuredResponseCandidateDiagnostic } from "../structured-response-parser";

export type StructuredRecoveryAction =
  | "regenerate_once"
  | "repair_once"
  | "pause";

export type StructuredRecoveryPolicy = Readonly<{
  onNoJsonObject?: StructuredRecoveryAction;
  onTruncatedJson?: StructuredRecoveryAction;
  onJsonSyntaxError?: StructuredRecoveryAction;
  onSchemaValidationFailed?: StructuredRecoveryAction;
  onInvariantFailure?: StructuredRecoveryAction;
}>;

export function schemaIssuePaths(
  diagnostics: ReadonlyArray<StructuredResponseCandidateDiagnostic>,
): string[] {
  const widestCandidate = [...diagnostics]
    .filter((candidate) => candidate.parseStatus === "valid")
    .sort(
      (left, right) =>
        right.endOffset -
        right.startOffset -
        (left.endOffset - left.startOffset),
    )[0];
  return [...new Set(widestCandidate?.schemaIssuePaths ?? [])].slice(0, 20);
}

export function selectStructuredRecoveryAction(input: {
  failureCategory: string;
  diagnostics: ReadonlyArray<StructuredResponseCandidateDiagnostic>;
  policy?: StructuredRecoveryPolicy;
}): StructuredRecoveryAction {
  const { policy } = input;
  if (!policy) return "pause";
  if (input.failureCategory === "no_json_object") {
    return policy.onNoJsonObject ?? "pause";
  }
  if (input.failureCategory === "truncated_json") {
    return policy.onTruncatedJson ?? "pause";
  }
  if (input.failureCategory === "json_syntax_error") {
    return policy.onJsonSyntaxError ?? "pause";
  }
  if (input.failureCategory === "schema_validation_failed") {
    const paths = schemaIssuePaths(input.diagnostics);
    return paths.includes("$invariant")
      ? (policy.onInvariantFailure ?? "pause")
      : (policy.onSchemaValidationFailed ?? "pause");
  }
  return "pause";
}

export function buildStructuredRecoveryInstruction(input: {
  attemptPurpose: "initial" | "regenerate" | "repair" | "capacity_escalation";
  recoveryContext?: Readonly<{
    failureCategory: string;
    providerContent: string;
    schemaIssuePaths: ReadonlyArray<string>;
  }>;
}): string | undefined {
  if (input.attemptPurpose !== "repair" || !input.recoveryContext) {
    return undefined;
  }
  return [
    "Repair the previous structured response and return one complete replacement JSON object.",
    "Preserve valid semantic content and ordering. Change only fields required to satisfy the schema.",
    "Do not omit required fields, introduce program-owned fields, or return a patch/diff.",
    `Failure category: ${input.recoveryContext.failureCategory}.`,
    `Invalid schema paths: ${input.recoveryContext.schemaIssuePaths.join(", ") || "unknown"}.`,
    `Previous response:\n${input.recoveryContext.providerContent.slice(0, 50_000)}`,
  ].join("\n\n");
}
