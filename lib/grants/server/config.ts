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
