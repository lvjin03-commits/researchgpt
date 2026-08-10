import { selectGrantHierarchicalDiagnosticRollout } from "../diagnostics/hierarchical-rollout.ts";

export function isGrantWorkspaceEnabled(): boolean {
  return process.env.GRANT_WORKSPACE_ENABLED?.trim().toLowerCase() === "true";
}

export function isGrantAiPatchEnabled(): boolean {
  return process.env.GRANT_AI_PATCH_ENABLED?.trim().toLowerCase() === "true";
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
