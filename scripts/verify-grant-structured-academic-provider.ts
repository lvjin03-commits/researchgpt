import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OpenAlexStructuredAcademicProvider } from "../lib/grants/infrastructure/web/openalex-structured-academic-provider.ts";
import { createGrantAcademicSourceRecord } from "../lib/grants/web-sources/academic-source-record.ts";
import { assessGrantWebSearchEgress } from "../lib/grants/web-sources/query-egress-policy.ts";

const decision = assessGrantWebSearchEgress({
  candidateQuery: "aqueous zinc battery secondary solvation sheath",
  documentText: "private application text",
  sensitiveTerms: [],
});
if (!decision.allowed) throw new Error("Fixture query should pass egress policy.");

let requestedUrl = "";
const provider = new OpenAlexStructuredAcademicProvider(async (input) => {
  requestedUrl = String(input);
  return new Response(JSON.stringify({ results: [
    {
      id: "https://openalex.org/W1234567890",
      display_name: "Anion-bridged secondary solvation sheaths",
      publication_year: 2026,
      publication_date: "2026-04-01",
      doi: "https://doi.org/10.1000/example",
      is_retracted: false,
      abstract_inverted_index: { Secondary: [0], solvation: [1], controls: [2], zinc: [3], deposition: [4] },
      authorships: [{ author: { display_name: "Ada Researcher" } }],
      primary_location: { source: { display_name: "Nature Nanotechnology" } },
    },
    {
      id: "https://openalex.org/W2222222222",
      display_name: "Metadata-only zinc study",
      publication_year: 2025,
      publication_date: null,
      doi: "10.1000/metadata",
      is_retracted: false,
      abstract_inverted_index: null,
      authorships: [],
      primary_location: null,
    },
    {
      id: "https://openalex.org/W3333333333",
      display_name: "Retracted study",
      is_retracted: true,
    },
  ] }), { status: 200, headers: { "content-type": "application/json" } });
});

const response = await provider.search({ approvedQuery: decision, maximumResults: 10 });
assert.equal(response.results.length, 2, "retracted records must be excluded deterministically");
assert.equal(response.usage.requestCount, 1);
assert.match(requestedUrl, /^https:\/\/api\.openalex\.org\/works\?/u);
assert.match(requestedUrl, /abstract_inverted_index/u);
assert.equal(response.results[0]?.abstract, "Secondary solvation controls zinc deposition");
assert.equal(response.results[0]?.publicationDate, "2026-04-01");
assert.equal(response.results[0]?.venue, "Nature Nanotechnology");

const record = createGrantAcademicSourceRecord({
  sourceId: randomUUID(), result: response.results[0]!, retrievedAt: "2026-09-11T12:00:00.000Z",
});
assert.equal(record.schemaVersion, 2);
assert.equal(record.evidence.kind, "abstract");
assert.equal(record.publication.doi, "https://doi.org/10.1000/example");
assert.equal(record.classification.qualityTier, "academic_database");

const metadataOnly = createGrantAcademicSourceRecord({
  sourceId: randomUUID(), result: response.results[1]!, retrievedAt: "2026-09-11T12:00:00.000Z",
});
assert.deepEqual(metadataOnly.evidence, { kind: "metadata_only", text: null });
assert.equal(metadataOnly.publication.publicationDate, null);
assert.equal(metadataOnly.publication.doi, "https://doi.org/10.1000/metadata");

assert.throws(() => createGrantAcademicSourceRecord({ sourceId: randomUUID(),
  result: { ...response.results[0]!, retracted: true }, retrievedAt: "2026-09-11T12:00:00.000Z" }), /Retracted/u);

console.log("Structured OpenAlex academic source contract verified offline without a network or paid model call.");

