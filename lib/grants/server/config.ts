import { selectGrantHierarchicalDiagnosticRollout } from "../diagnostics/hierarchical-rollout.ts";
import { selectGrantSemanticReviewV6Rollout } from "../diagnostics/semantic-review-v6-rollout.ts";

export type GrantSemanticDiagnosticRuntime = "v2" | "v3" | "hierarchical" | "v6";

export function isGrantWorkspaceEnabled(): boolean {
  return process.env.GRANT_WORKSPACE_ENABLED?.trim().toLowerCase() === "true";
}

export function isGrantAiPatchEnabled(): boolean {
  return process.env.GRANT_AI_PATCH_ENABLED?.trim().toLowerCase() === "true";
}

export function isGrantAiEditSessionEnabled(): boolean {
  return process.env.GRANT_AI_EDIT_SESSION_ENABLED?.trim().toLowerCase() === "true"
    && process.env.GRANT_AI_EDIT_SESSION_DATABASE_SCHEMA?.trim() === "053";
}

export function isGrantLocalEvidenceEnabled(): boolean {
  return process.env.GRANT_LOCAL_EVIDENCE_ENABLED?.trim().toLowerCase() === "true";
}

export function isGrantEvidencePatchEnabled(): boolean {
  return process.env.GRANT_EVIDENCE_PATCH_ENABLED?.trim().toLowerCase() === "true";
}

export function isGrantRecheckEnabled(): boolean {
  return process.env.GRANT_RECHECK_ENABLED?.trim().toLowerCase() === "true";
}

export function isGrantDocxExportEnabled(): boolean {
  return process.env.GRANT_DOCX_EXPORT_ENABLED?.trim().toLowerCase() === "true";
}

export function isGrantSemanticDiagnosticV3Enabled(): boolean {
  return process.env.GRANT_SEMANTIC_DIAGNOSTIC_V3_ENABLED?.trim().toLowerCase() === "true";
}

export function isGrantHierarchicalDiagnosticSelected(ownerId: string): boolean {
  const modeValue = process.env.GRANT_HIERARCHICAL_DIAGNOSTIC_MODE?.trim().toLowerCase();
  const mode = modeValue === "canary" || modeValue === "on" ? modeValue : "off";
  const databaseSchemaVersion = process.env.GRANT_HIERARCHICAL_DIAGNOSTIC_DATABASE_SCHEMA?.trim() === "047"
    ? "047" as const
    : "not_ready" as const;
  const canaryOwnerIds = (process.env.GRANT_HIERARCHICAL_DIAGNOSTIC_CANARY_OWNER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  try {
    return selectGrantHierarchicalDiagnosticRollout({
      ownerId,
      policy: { mode, databaseSchemaVersion, canaryOwnerIds },
    }).selected;
  } catch {
    return false;
  }
}

function isGrantSemanticReviewV6Selected(ownerId: string): boolean {
  const modeValue = process.env.GRANT_SEMANTIC_REVIEW_V6_MODE?.trim().toLowerCase();
  const mode = modeValue === "canary" || modeValue === "on" ? modeValue : "off";
  const databaseSchemaVersion = process.env.GRANT_SEMANTIC_REVIEW_V6_DATABASE_SCHEMA?.trim() === "051"
    ? "051" as const
    : "not_ready" as const;
  const canaryOwnerIds = (process.env.GRANT_SEMANTIC_REVIEW_V6_CANARY_OWNER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  try {
    return selectGrantSemanticReviewV6Rollout({
      ownerId,
      policy: { mode, databaseSchemaVersion, canaryOwnerIds },
    }).selected;
  } catch {
    return false;
  }
}

/** Sole semantic-diagnostic runtime authority. V6 has precedence only when its
 * independent DB/cohort contract selects the owner; otherwise the established
 * V5/V3/V2 decision remains unchanged. */
export function selectGrantSemanticDiagnosticRuntime(ownerId: string): GrantSemanticDiagnosticRuntime {
  if (isGrantSemanticReviewV6Selected(ownerId)) return "v6";
  if (isGrantHierarchicalDiagnosticSelected(ownerId)) return "hierarchical";
  return isGrantSemanticDiagnosticV3Enabled() ? "v3" : "v2";
}
