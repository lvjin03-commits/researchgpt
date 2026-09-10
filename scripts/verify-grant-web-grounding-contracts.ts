import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantWebSourceAssessmentSchema, GrantWebSourceRecordSchema, validateGrantWebSynthesisProposal } from "../lib/grants/web-sources/contracts.ts";
import { createGrantWebSourceRecord } from "../lib/grants/web-sources/source-record.ts";

const sourceId = randomUUID();
const otherSourceId = randomUUID();
const record = createGrantWebSourceRecord({
  sourceId,
  providerId: "openai_web_search",
  providerRecordId: "google-result-1",
  url: "https://lab.example.edu/paper#abstract",
  title: "  Interface study  ",
  snippet: " A bounded search snippet. ",
  retrievedAt: "2026-09-08T12:00:00.000Z",
});
assert.equal(record.canonicalUrl, "https://lab.example.edu/paper");
assert.equal(record.classification.qualityTier, "university_research");
assert.equal(record.classification.registryVersion, "1");
assert.match(record.contentFingerprint, /^[a-f0-9]{64}$/u);

const repeated = createGrantWebSourceRecord({
  sourceId: otherSourceId, providerId: "openai_web_search", providerRecordId: "another-id",
  url: "https://lab.example.edu/paper", title: "A different display title", snippet: "A bounded search snippet.",
  retrievedAt: "2026-09-08T13:00:00.000Z",
});
assert.equal(record.contentFingerprint, repeated.contentFingerprint, "public content fingerprint must be reusable without document identity");

const claimId = randomUUID();
const proposal = validateGrantWebSynthesisProposal({
  currentSourceIds: [sourceId],
  proposal: {
    assessments: [{ sourceId, disposition: "recommended", reason: "Relevant to the user's question." }],
    claims: [{ claimId, statement: "The source reports a relevant interface result.", sourceIds: [sourceId] }],
  },
});
assert.equal(proposal.claims[0]?.sourceIds[0], sourceId);

assert.throws(() => validateGrantWebSynthesisProposal({
  currentSourceIds: [sourceId],
  proposal: { assessments: [], claims: [{ claimId, statement: "Invented binding", sourceIds: [otherSourceId] }] },
}), /outside the current search/u);
assert.throws(() => validateGrantWebSynthesisProposal({
  currentSourceIds: [sourceId],
  proposal: { assessments: [{ sourceId, disposition: "recommended", reason: "one" }, { sourceId, disposition: "excluded", reason: "two" }], claims: [] },
}), /assessed only once/u);
assert.throws(() => GrantWebSourceAssessmentSchema.parse({ sourceId, disposition: "recommended", reason: "relevant", qualityTier: "academic_database" }));
assert.throws(() => GrantWebSourceRecordSchema.parse({ ...record, unexpected: true }));
assert.throws(() => createGrantWebSourceRecord({ sourceId, providerId: "openalex", url: "https://user:secret@openalex.org", title: "x", snippet: "x", retrievedAt: "2026-09-08T12:00:00.000Z" }));

console.log("Grant web grounding source and model-proposal contracts verified offline.");
