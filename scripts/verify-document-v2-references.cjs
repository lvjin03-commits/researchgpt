/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const swc = require("next/dist/build/swc");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = swc.transformSync(source, {
    filename,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  });
  module._compile(output.code, filename);
};

const {
  createReferenceExecutionProfile,
} = require("../lib/document-v2/references/contracts.ts");
const {
  acquireDocumentReferences,
  createReferencePipelineFallback,
} = require("../lib/document-v2/references/acquisition.ts");

async function main() {
  const disabledProfile = createReferenceExecutionProfile({
    requirement: "optional",
    policy: "user_sources_plus_web",
    hasUserReferences: false,
  });
  assert.equal(disabledProfile.enabled, false);
  let disabledCalls = 0;
  const disabledResult = await acquireDocumentReferences({
    profile: disabledProfile,
    topic: "physical gels",
    existingReferences: [],
    existingEvidence: [],
    fetcher: async () => {
      disabledCalls += 1;
      throw new Error("Disabled pipeline must not call a provider.");
    },
  });
  assert.equal(disabledCalls, 0);
  assert.equal(disabledResult.status, "disabled");

  const requiredProfile = createReferenceExecutionProfile({
    requirement: "required",
    policy: "web_search_only",
    hasUserReferences: false,
  });
  const fetchedUrls = [];
  const fetcher = async (input) => {
    const url = new URL(String(input));
    fetchedUrls.push(url.hostname);
    if (url.hostname === "api.crossref.org") {
      return new Response(JSON.stringify({
        message: {
          items: [{
            DOI: "10.1000/physical-gel",
            title: ["Reversible physical gel networks"],
            author: [{ given: "Ada", family: "Researcher" }],
            issued: { "date-parts": [[2024]] },
            "container-title": ["Journal of Reliable Gels"],
            abstract:
              "This study reports reversible network formation and relaxation in a physical gel under controlled thermal conditions.",
          }, {
            DOI: "10.1000/unrelated-ferrite",
            title: ["Ferrite additives for reinforced concrete construction"],
            author: [{ given: "B", family: "Builder" }],
            issued: { "date-parts": [[2023]] },
            "container-title": ["Construction Materials"],
            abstract:
              "This construction study evaluates ferrite additives, compressive strength, aggregate grading, curing schedules, and structural durability in reinforced concrete systems.",
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      results: [{
        id: "https://openalex.org/W123",
        doi: "https://doi.org/10.1000/physical-gel",
        title: "Reversible physical gel networks",
        publication_year: 2024,
        authorships: [{ author: { display_name: "Ada Researcher" } }],
        primary_location: {
          source: { display_name: "Journal of Reliable Gels" },
        },
        abstract_inverted_index: {
          This: [0], study: [1], reports: [2], reversible: [3], network: [4],
          formation: [5], and: [6], relaxation: [7], in: [8], a: [9],
          physical: [10], gel: [11], under: [12], controlled: [13],
          thermal: [14], conditions: [15], with: [16], reproducible: [17],
          measurements: [18], across: [19], samples: [20], and2: [21],
          protocols: [22], for: [23], comparison: [24], purposes: [25],
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await acquireDocumentReferences({
    profile: requiredProfile,
    topic: "physical gels",
    existingReferences: [],
    existingEvidence: [],
    fetcher,
  });
  assert.deepEqual(fetchedUrls.sort(), ["api.crossref.org", "api.openalex.org"]);
  assert.equal(result.outcome, "partial");
  assert.equal(result.candidateCount, 2);
  assert.equal(result.relevanceRejectedCount, 1);
  assert.equal(result.verifiedReferences.length, 1);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].evidenceId, result.verifiedReferences[0].id);
  assert.equal(
    result.warnings.some((warning) => warning.code === "references_off_topic_filtered"),
    true,
  );

  const unavailable = await acquireDocumentReferences({
    profile: requiredProfile,
    topic: "physical gels",
    existingReferences: [],
    existingEvidence: [],
    fetcher: async () => {
      throw new Error("provider down");
    },
  });
  assert.equal(unavailable.outcome, "unavailable");
  assert.equal(unavailable.verifiedReferences.length, 0);

  const fallback = createReferencePipelineFallback({
    existingReferences: [],
    existingEvidence: [],
  });
  assert.equal(fallback.status, "failed");
  assert.equal(fallback.outcome, "unavailable");

  console.log("Document v2 reference pipeline tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
