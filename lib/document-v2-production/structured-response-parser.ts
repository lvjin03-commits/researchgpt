import { createHash } from "node:crypto";
import { z, type ZodType } from "zod";

export const DOCUMENT_RESPONSE_PARSER_VERSION = "document-json-parser-v2";
export const DOCUMENT_RESPONSE_REPAIR_VERSION = "document-json-repair-v1";

export type StructuredResponseFailureCategory =
  | "no_json_object"
  | "truncated_json"
  | "json_syntax_error"
  | "ambiguous_json"
  | "schema_validation_failed";

export type StructuredResponseRepairStep =
  | "bom_removed"
  | "markdown_fence_removed"
  | "surrounding_text_removed"
  | "trailing_comma_removed";

export type StructuredResponseCandidateDiagnostic = {
  candidateIndex: number;
  contentHashInput: string;
  startOffset: number;
  endOffset: number;
  parseStatus: "valid" | "invalid";
  parseErrorMessage?: string;
  parseErrorPosition?: number;
  schemaStatus?: "valid" | "invalid";
  schemaIssueCount?: number;
  schemaIssuePaths?: string[];
  repairSteps: StructuredResponseRepairStep[];
};

export type StructuredResponseParseResult<T> =
  | {
      ok: true;
      value: T;
      parsedResponse: unknown;
      repairSteps: StructuredResponseRepairStep[];
      candidateDiagnostics: StructuredResponseCandidateDiagnostic[];
    }
  | {
      ok: false;
      failureCategory: StructuredResponseFailureCategory;
      message: string;
      parseErrorMessage?: string;
      parseErrorPosition?: number;
      repairSteps: StructuredResponseRepairStep[];
      candidateDiagnostics: StructuredResponseCandidateDiagnostic[];
    };

type Candidate = { text: string; startOffset: number; endOffset: number };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseErrorPosition(message: string) {
  const match = message.match(/position\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function safeParseErrorMessage(error: unknown) {
  const message = errorMessage(error);
  const position = parseErrorPosition(message);
  const suffix = position === undefined ? "" : ` at position ${position}`;
  if (/unterminated string/i.test(message)) return `Unterminated JSON string${suffix}`;
  if (/unexpected end/i.test(message)) return `Unexpected end of JSON input${suffix}`;
  if (/expected .* after property/i.test(message)) {
    return `Invalid JSON property separator${suffix}`;
  }
  if (/unexpected token/i.test(message) || /not valid json/i.test(message)) {
    return `Unexpected JSON token${suffix}`;
  }
  return `JSON.parse failed${suffix}`;
}

function diagnosticHashInput(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeOuterText(text: string) {
  let normalized = text;
  const repairSteps: StructuredResponseRepairStep[] = [];
  if (normalized.charCodeAt(0) === 0xfeff) {
    normalized = normalized.slice(1);
    repairSteps.push("bom_removed");
  }
  const trimmed = normalized.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) {
    normalized = fence[1];
    repairSteps.push("markdown_fence_removed");
  }
  return { normalized, repairSteps };
}

function scanJsonObjectCandidates(text: string) {
  const candidates: Candidate[] = [];
  const starts: number[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") starts.push(index);
    else if (char === "}" && starts.length > 0) {
      const start = starts.pop();
      if (start !== undefined) {
        candidates.push({
          text: text.slice(start, index + 1),
          startOffset: start,
          endOffset: index + 1,
        });
      }
    }
  }
  candidates.sort(
    (left, right) =>
      left.startOffset - right.startOffset || right.endOffset - left.endOffset,
  );
  return { candidates, hasUnclosedCandidate: starts.length > 0 };
}

function removeTrailingCommas(text: string) {
  let output = "";
  let changed = false;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ",") {
      let lookahead = index + 1;
      while (/\s/.test(text[lookahead] ?? "")) lookahead += 1;
      if (text[lookahead] === "}" || text[lookahead] === "]") {
        changed = true;
        continue;
      }
    }
    output += char;
  }
  return { text: output, changed };
}

function schemaIssuePaths(error: z.ZodError) {
  return [...new Set(error.issues.map((issue) => issue.path.join(".")))]
    .filter(Boolean)
    .slice(0, 20);
}

export function parseStructuredResponse<T>(input: {
  content: string;
  schema: ZodType<T>;
  validateCandidate?: (value: T) => void;
}): StructuredResponseParseResult<T> {
  const directText = input.content.trim();
  try {
    const direct = JSON.parse(directText) as unknown;
    const validation = input.schema.safeParse(direct);
    if (validation.success) {
      input.validateCandidate?.(validation.data);
      return {
        ok: true,
        value: validation.data,
        parsedResponse: direct,
        repairSteps: [],
        candidateDiagnostics: [],
      };
    }
  } catch {
    // The recovery path below records bounded diagnostics.
  }

  const normalized = normalizeOuterText(input.content);
  const scanned = scanJsonObjectCandidates(normalized.normalized);
  const diagnostics: StructuredResponseCandidateDiagnostic[] = [];
  const schemaValid: Array<{
    value: T;
    parsedResponse: unknown;
    repairSteps: StructuredResponseRepairStep[];
  }> = [];
  let jsonValidCount = 0;

  scanned.candidates.forEach((candidate, candidateIndex) => {
    const candidateRepairs: StructuredResponseRepairStep[] = [];
    if (
      candidate.startOffset > 0 ||
      candidate.endOffset < normalized.normalized.length
    ) {
      candidateRepairs.push("surrounding_text_removed");
    }
    let candidateText = candidate.text;
    let parsed: unknown;
    let parseFailure: string | undefined;
    try {
      parsed = JSON.parse(candidateText) as unknown;
    } catch (error) {
      parseFailure = safeParseErrorMessage(error);
      const repaired = removeTrailingCommas(candidateText);
      if (repaired.changed) {
        candidateText = repaired.text;
        candidateRepairs.push("trailing_comma_removed");
        try {
          parsed = JSON.parse(candidateText) as unknown;
          parseFailure = undefined;
        } catch (repairError) {
          parseFailure = safeParseErrorMessage(repairError);
        }
      }
    }
    if (parseFailure) {
      diagnostics.push({
        candidateIndex,
        contentHashInput: diagnosticHashInput(candidate.text),
        startOffset: candidate.startOffset,
        endOffset: candidate.endOffset,
        parseStatus: "invalid",
        parseErrorMessage: parseFailure.slice(0, 500),
        parseErrorPosition: parseErrorPosition(parseFailure),
        repairSteps: candidateRepairs,
      });
      return;
    }
    jsonValidCount += 1;
    const validation = input.schema.safeParse(parsed);
    let invariantError: unknown;
    if (validation.success && input.validateCandidate) {
      try {
        input.validateCandidate(validation.data);
      } catch (error) {
        invariantError = error;
      }
    }
    const candidateIsValid = validation.success && invariantError === undefined;
    diagnostics.push({
      candidateIndex,
      contentHashInput: diagnosticHashInput(candidate.text),
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset,
      parseStatus: "valid",
      schemaStatus: candidateIsValid ? "valid" : "invalid",
      schemaIssueCount: candidateIsValid
        ? 0
        : validation.success
          ? 1
          : validation.error.issues.length,
      schemaIssuePaths: candidateIsValid
        ? []
        : validation.success
          ? ["$invariant"]
          : schemaIssuePaths(validation.error),
      repairSteps: candidateRepairs,
    });
    if (candidateIsValid && validation.success) {
      schemaValid.push({
        value: validation.data,
        parsedResponse: parsed,
        repairSteps: candidateRepairs,
      });
    }
  });

  const baseRepairs = normalized.repairSteps;
  if (schemaValid.length === 1) {
    return {
      ok: true,
      value: schemaValid[0].value,
      parsedResponse: schemaValid[0].parsedResponse,
      repairSteps: [...baseRepairs, ...schemaValid[0].repairSteps],
      candidateDiagnostics: diagnostics,
    };
  }
  if (schemaValid.length > 1) {
    return {
      ok: false,
      failureCategory: "ambiguous_json",
      message: "The model returned multiple schema-valid JSON objects.",
      repairSteps: baseRepairs,
      candidateDiagnostics: diagnostics,
    };
  }
  if (scanned.candidates.length === 0) {
    const failureCategory = scanned.hasUnclosedCandidate
      ? "truncated_json"
      : "no_json_object";
    return {
      ok: false,
      failureCategory,
      message:
        failureCategory === "truncated_json"
          ? "The model returned an unclosed JSON object."
          : "The model returned no JSON object.",
      repairSteps: baseRepairs,
      candidateDiagnostics: diagnostics,
    };
  }
  if (jsonValidCount > 0) {
    return {
      ok: false,
      failureCategory: "schema_validation_failed",
      message: "The model returned JSON that does not match the required schema.",
      repairSteps: baseRepairs,
      candidateDiagnostics: diagnostics,
    };
  }
  const firstError = diagnostics.find((item) => item.parseErrorMessage);
  return {
    ok: false,
    failureCategory: "json_syntax_error",
    message: "The model returned syntactically invalid JSON.",
    parseErrorMessage: firstError?.parseErrorMessage,
    parseErrorPosition: firstError?.parseErrorPosition,
    repairSteps: baseRepairs,
    candidateDiagnostics: diagnostics,
  };
}
