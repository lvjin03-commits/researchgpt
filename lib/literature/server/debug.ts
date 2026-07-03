// Server-only module.

export function isLiteratureDebugEnabled(): boolean {
  return process.env.DEBUG_LITERATURE === "true";
}
