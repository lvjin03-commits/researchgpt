import { createHash } from "node:crypto";
import type { GrantStructuredAcademicSearchResult } from "../ports/grant-structured-academic-search-provider.ts";
import { classifyGrantWebSource } from "./trust-registry.ts";
import { GrantAcademicSourceRecordSchema, type GrantAcademicSourceRecord } from "./academic-source-contracts.ts";

export function createGrantAcademicSourceRecord(input: {
  sourceId: string;
  result: GrantStructuredAcademicSearchResult;
  retrievedAt: string;
}): GrantAcademicSourceRecord {
  if (input.result.retracted) throw new Error("Retracted works cannot become admitted academic sources.");
  const parsedUrl = new URL(input.result.url);
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
    throw new Error("Academic source URLs must be credential-free HTTPS URLs.");
  }
  parsedUrl.hash = "";
  const canonicalUrl = parsedUrl.toString();
  const classification = classifyGrantWebSource(canonicalUrl);
  if (classification.qualityTier !== "academic_database" || classification.reason !== "domain_rule" || !classification.ruleId) {
    throw new Error("Structured academic sources must match the deterministic academic trust registry.");
  }
  const abstract = input.result.abstract?.replace(/\s+/gu, " ").trim() || null;
  const identity = JSON.stringify({
    providerId: input.result.providerId,
    providerRecordId: input.result.providerRecordId,
    canonicalUrl,
    title: input.result.title.trim(),
    abstract,
    publicationYear: input.result.publicationYear,
    publicationDate: input.result.publicationDate,
    doi: input.result.doi,
    venue: input.result.venue,
    authors: input.result.authors,
  });
  return GrantAcademicSourceRecordSchema.parse({
    schemaVersion: 2,
    sourceId: input.sourceId,
    providerId: input.result.providerId,
    providerRecordId: input.result.providerRecordId,
    canonicalUrl,
    title: input.result.title,
    evidence: abstract ? { kind: "abstract", text: abstract } : { kind: "metadata_only", text: null },
    publication: {
      publicationYear: input.result.publicationYear,
      publicationDate: input.result.publicationDate,
      doi: input.result.doi,
      venue: input.result.venue,
      authors: input.result.authors,
    },
    retracted: false,
    retrievedAt: input.retrievedAt,
    contentFingerprint: createHash("sha256").update(identity, "utf8").digest("hex"),
    classification: {
      qualityTier: classification.qualityTier,
      registryVersion: classification.registryVersion,
      ruleId: classification.ruleId,
      reason: classification.reason,
    },
  });
}

