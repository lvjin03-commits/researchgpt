import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createGrantAcademicSourceRecord } from "../lib/grants/web-sources/academic-source-record.ts";
import { composeGrantResearchSources } from "../lib/grants/web-sources/research-source-acquisition.ts";
import { createGrantWebSourceRecord } from "../lib/grants/web-sources/source-record.ts";

const now = "2026-09-11T12:00:00.000Z";
const academic = createGrantAcademicSourceRecord({ sourceId: randomUUID(), retrievedAt: now, result: {
  providerId: "openalex", providerRecordId: "W1234567890", url: "https://openalex.org/W1234567890",
  title: "Dynamic Solvation at Zinc Interfaces", abstract: "A structured abstract about dynamic zinc solvation.",
  publicationYear: 2026, publicationDate: "2026-04-01", doi: "https://doi.org/10.1000/ZINC.1",
  venue: "Example Journal", authors: ["A. Researcher"], retracted: false,
} });
const duplicateDoiWeb = createGrantWebSourceRecord({ sourceId: randomUUID(), providerId: "openai_web_search",
  providerRecordId: "resp:1", url: "https://doi.org/10.1000/zinc.1?utm_source=search",
  title: "Dynamic solvation at zinc interfaces", snippet: "Generated citation context, not an abstract.",
  publishedAt: "2026-04-01T00:00:00.000Z", retrievedAt: now });
const official = createGrantWebSourceRecord({ sourceId: randomUUID(), providerId: "openai_web_search",
  providerRecordId: "resp:2", url: "https://energy.gov/zinc-program?utm_campaign=test",
  title: "Zinc research program", snippet: "Official program information.", retrievedAt: now });

let idCounter = 0;
const groups = composeGrantResearchSources({ academicSources: [academic], generalWebSources: [duplicateDoiWeb, official],
  createId: () => ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"][idCounter++]! });
assert.equal(groups.length, 2, "DOI duplicates must collapse into one source group");
const paperGroup = groups.find((group) => group.members.length === 2)!;
assert.equal(paperGroup.deduplicationKey, "doi:10.1000/zinc.1");
assert.equal(paperGroup.primarySourceId, academic.sourceId, "structured abstract must outrank generated citation context");
assert.deepEqual(paperGroup.members.map((member) => member.evidenceKind), ["abstract", "citation_context"]);
assert.equal(paperGroup.members[1]?.record.contentFingerprint, duplicateDoiWeb.contentFingerprint,
  "deduplication must preserve the original provenance record");
assert.equal(groups[0]?.primarySourceId, academic.sourceId, "newer academic work should sort first");

assert.throws(() => composeGrantResearchSources({ academicSources: [academic],
  generalWebSources: [{ ...official, sourceId: academic.sourceId }], createId: randomUUID }), /must be unique/u);

console.log("Grant research-source composition and provenance-preserving deduplication verified offline.");

