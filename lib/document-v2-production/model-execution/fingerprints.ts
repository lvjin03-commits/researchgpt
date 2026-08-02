import type { DocumentTextExecutionProfile } from "@/lib/document-v2/runtime/contracts";
import { sha256Canonical } from "@/lib/document-v2/runtime/canonical-hash";

export function createContentFingerprint(input: {
  operation: string;
  componentKey?: string;
  schemaName: string;
  systemInstruction: string;
  userInstruction: string;
}): string {
  return sha256Canonical(input);
}

export function createLegacyExecutionFingerprint(input: {
  profile: DocumentTextExecutionProfile;
  operation: string;
  componentKey?: string;
  schemaName: string;
  systemInstruction: string;
  userInstruction: string;
  maxOutputTokens: number;
}): string {
  return sha256Canonical(input);
}
