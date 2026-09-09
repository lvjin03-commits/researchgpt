import { createHash } from "node:crypto";
import { GrantWebSourceRecordSchema, type GrantWebSourceRecord } from "./contracts.ts";
import { classifyGrantWebSource } from "./trust-registry.ts";

export interface CreateGrantWebSourceRecordInput {
  sourceId: string;
  providerId: GrantWebSourceRecord["providerId"];
  providerRecordId?: string | null;
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string | null;
  retrievedAt: string;
}

export function createGrantWebSourceRecord(input: CreateGrantWebSourceRecordInput): GrantWebSourceRecord {
  const parsedUrl = new URL(input.url);
  if (!/^https?:$/u.test(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new Error("Only credential-free HTTP(S) source URLs can become source records.");
  }
  parsedUrl.hash = "";
  const canonicalUrl = parsedUrl.toString();
  const classification = classifyGrantWebSource(canonicalUrl);
  if (classification.reason === "invalid_url") throw new Error("Invalid web source URL.");
  // Titles are display metadata and may vary across providers. Public-source
  // reuse identity follows the accepted URL + bounded-summary rule.
  const normalizedText = `${canonicalUrl}\n${input.snippet.trim()}`;
  return GrantWebSourceRecordSchema.parse({
    schemaVersion: 1,
    sourceId: input.sourceId,
    providerId: input.providerId,
    providerRecordId: input.providerRecordId ?? null,
    canonicalUrl,
    title: input.title,
    snippet: input.snippet,
    publishedAt: input.publishedAt ?? null,
    retrievedAt: input.retrievedAt,
    contentFingerprint: createHash("sha256").update(normalizedText, "utf8").digest("hex"),
    classification: {
      qualityTier: classification.qualityTier,
      registryVersion: classification.registryVersion,
      ruleId: classification.ruleId,
      reason: classification.reason,
    },
  });
}
