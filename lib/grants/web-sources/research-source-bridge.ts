import { createHash } from "node:crypto";
import type { GrantAcademicSourceRecord } from "./academic-source-contracts.ts";
import { normalizeGrantResearchDoi, normalizeGrantResearchTitle } from "./academic-source-record.ts";
import { composeGrantResearchSources } from "./research-source-acquisition.ts";
import type { GrantWebSourceRecord } from "./contracts.ts";

/** Rehydrates the structured OpenAlex abstract that the legacy checkpoint format
 * stored as a bounded web-source record. General web excerpts are never promoted
 * to academic abstracts. */
function academicRecord(source: GrantWebSourceRecord): GrantAcademicSourceRecord | null {
  if (source.providerId !== "openalex" || !source.providerRecordId?.match(/^W\d+$/u)) return null;
  const publicationYear = source.publishedAt ? new Date(source.publishedAt).getUTCFullYear() : null;
  const canonicalDoi = normalizeGrantResearchDoi(source.canonicalUrl);
  const abstractHash = createHash("sha256").update(source.snippet, "utf8").digest("hex");
  return {
    schemaVersion: 2,
    sourceId: source.sourceId,
    providerId: "openalex",
    providerRecordId: source.providerRecordId,
    canonicalUrl: `https://openalex.org/${source.providerRecordId}`,
    title: source.title,
    identity: {
      canonicalDoi,
      openAlexId: source.providerRecordId,
      normalizedTitle: normalizeGrantResearchTitle(source.title),
      publicationVersion: "version_of_record",
    },
    evidence: { kind: "abstract", origin: "structured_abstract", text: source.snippet,
      spans: [{ origin: "structured_abstract", section: "abstract", page: null, paragraph: null,
        excerpt: source.snippet, excerptHash: abstractHash }] },
    publication: { publicationYear, publicationDate: source.publishedAt?.slice(0, 10) ?? null,
      doi: canonicalDoi ? `https://doi.org/${canonicalDoi}` : null, venue: null, authors: [] },
    retracted: false,
    retrievedAt: source.retrievedAt,
    contentFingerprint: source.contentFingerprint,
    classification: { qualityTier: "academic_database", registryVersion: source.classification.registryVersion,
      ruleId: "openalex-domain", reason: "domain_rule" },
  };
}

export function bridgeGrantWebSourcesToResearchGroups(input: {
  sources: readonly GrantWebSourceRecord[];
  createId: () => string;
}) {
  const academicSources = input.sources.flatMap((source) => {
    const record = academicRecord(source);
    return record ? [record] : [];
  });
  const academicIds = new Set(academicSources.map((source) => source.sourceId));
  return composeGrantResearchSources({ academicSources,
    generalWebSources: input.sources.filter((source) => !academicIds.has(source.sourceId)),
    createId: input.createId });
}
