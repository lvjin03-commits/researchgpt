export function isGrantWorkspaceEnabled(): boolean {
  return process.env.GRANT_WORKSPACE_ENABLED?.trim().toLowerCase() === "true";
}
