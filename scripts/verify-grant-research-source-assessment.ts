import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createGrantAcademicSourceRecord } from "../lib/grants/web-sources/academic-source-record.ts";
import { composeGrantResearchSources } from "../lib/grants/web-sources/research-source-acquisition.ts";
import { validateGrantResearchSourceAssessments } from "../lib/grants/web-sources/research-source-assessment.ts";

const sourceId = randomUUID();
const academic = createGrantAcademicSourceRecord({ sourceId, retrievedAt: "2026-09-11T12:00:00.000Z", result: {
  providerId: "openalex", providerRecordId: "W1234567890", url: "https://openalex.org/W1234567890",
  title: "Dynamic zinc interface", publicationYear: 2026, publicationDate: "2026-04-01",
  doi: "https://doi.org/10.1000/zinc", venue: "Example Journal", authors: ["A. Researcher"], retracted: false,
  abstract: "The electrolyte delivered 99.9% coulombic efficiency and stable cycling for 1000 h under an applied field.",
} });
const [group] = composeGrantResearchSources({ academicSources: [academic], generalWebSources: [], createId: randomUUID });

const valid = validateGrantResearchSourceAssessments({ sourceGroups: [group!], proposal: {
  schemaVersion: 2,
  assessments: [{
    sourceGroupId: group!.groupId,
    disposition: "recommended",
    reason: "Directly relevant to dynamic interface regulation.",
    mechanismSummary: "An applied field reorganizes the electrolyte at the zinc interface.",
    quantitativeFindings: [{ statement: "The reported coulombic efficiency was 99.9% over 1000 h.", sourceIds: [sourceId] }],
    applicationRelation: "This can test whether the proposed ion bridge remains stable under polarization.",
    evidenceLimitations: ["The abstract does not report full-cell loading."],
  }],
} });
assert.equal(valid[0]?.publicationYear, 2026, "publication year must come from program metadata");
assert.equal(valid[0]?.doi, "https://doi.org/10.1000/zinc", "DOI must come from program metadata");
assert.equal(valid[0]?.primarySourceId, sourceId);

assert.throws(() => validateGrantResearchSourceAssessments({ sourceGroups: [group!], proposal: {
  schemaVersion: 2,
  assessments: [{
    sourceGroupId: group!.groupId, disposition: "recommended", reason: "Relevant",
    mechanismSummary: "Dynamic interface regulation.",
    quantitativeFindings: [{ statement: "The efficiency was 99.99% over 8000 h.", sourceIds: [sourceId] }],
    applicationRelation: "Tests the proposed mechanism.", evidenceLimitations: [],
  }],
} }), /unsupported values/u, "numbers absent from admitted evidence must be rejected");

assert.throws(() => validateGrantResearchSourceAssessments({ sourceGroups: [group!], proposal: {
  schemaVersion: 2,
  assessments: [{ sourceGroupId: group!.groupId, disposition: "recommended", reason: "Relevant",
    mechanismSummary: null, quantitativeFindings: [], applicationRelation: null, evidenceLimitations: [] }],
} }), /requires a mechanism summary/u);

assert.throws(() => validateGrantResearchSourceAssessments({ sourceGroups: [group!], proposal: {
  schemaVersion: 2,
  assessments: [{ sourceGroupId: group!.groupId, disposition: "excluded", reason: "Not relevant",
    mechanismSummary: null, quantitativeFindings: [{ statement: "Reported 99.9% efficiency.", sourceIds: [randomUUID()] }],
    applicationRelation: null, evidenceLimitations: [] }],
} }), /outside its research-source group/u);

console.log("Research-source assessment V2 and quantitative evidence validation verified offline.");

