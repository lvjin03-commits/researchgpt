import { createHash } from "node:crypto";

const SENSITIVE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\bpostgres(?:ql)?:\/\/\S+/gi,
  /\b[A-Z]:\\(?:[^\\\s]+\\)+[^\\\s]*/gi,
  /\/(?:home|Users)\/[^\s]+/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];
const SENSITIVE_QUERY_VALUE =
  /([?&](?:token|key|secret|signature|code)=)[^&\s]+/gi;

export function sanitizeDiagnosticError(message: string | null | undefined) {
  if (!message) return null;
  let sanitized = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  sanitized = sanitized.replace(
    SENSITIVE_QUERY_VALUE,
    (_match, prefix: string) => `${prefix}[REDACTED]`,
  );
  return sanitized.slice(0, 1_000);
}

export function diagnosticFingerprint(value: string | null | undefined) {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

export function maskIdentifier(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 10) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
