export function isGrantWorkspaceEnabled(): boolean {
  return process.env.GRANT_WORKSPACE_ENABLED?.trim().toLowerCase() === "true";
}

export function isGrantAiPatchEnabled(): boolean {
  return process.env.GRANT_AI_PATCH_ENABLED?.trim().toLowerCase() === "true";
}
