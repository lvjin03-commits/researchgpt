import assert from "node:assert/strict";
import {
  DocumentPlanSchema,
  DocumentRequestSchema,
  FinalDocumentSpecSchema,
  ResolvedTemplateSnapshotSchema,
} from "../lib/document-v2/contracts.ts";

const requestId = "4f914a30-65bb-4a87-a3fb-bb18f7779f84";
const templateSnapshot = {
  templateId: "sci-review",
  templateVersion: "1",
  checksum: "a".repeat(64),
  origin: { kind: "system" },
  renderingProfile: "sci_word_v1",
  contentProfile: "sci_review_v1",
  typography: {
    titleStyle: "DocumentTitle",
    heading1Style: "Heading1",
    heading2Style: "Heading2",
    heading3Style: "Heading3",
    bodyStyle: "Body",
    captionStyle: "Caption",
    referenceStyle: "Reference",
  },
  layout: {
    pageSize: "A4",
    orientation: "portrait",
    columns: 1,
  },
  rules: {
    headingDepth: 3,
    figureCaptionPosition: "below",
    tableCaptionPosition: "above",
  },
} as const;

assert.equal(ResolvedTemplateSnapshotSchema.safeParse(templateSnapshot).success, true);

const request = DocumentRequestSchema.parse({
  requestId,
  schemaVersion: 1,
  action: "generate",
  source: { kind: "prompt", sourceIds: [] },
  outputFormat: "docx",
  language: "zh",
  templateIntent: "sci_review",
  userRequirements: { topic: "物理凝胶制备方法综述", targetLength: 5000 },
});
assert.equal(request.source.kind, "prompt");

assert.equal(
  DocumentRequestSchema.safeParse({
    ...request,
    source: { kind: "attachments", sourceIds: [] },
  }).success,
  false,
);

const plan = DocumentPlanSchema.parse({
  requestId,
  schemaVersion: 1,
  templateSnapshot,
  components: [
    {
      componentKey: "title",
      type: "title",
      purpose: "Produce the final document title.",
    },
    {
      componentKey: "abstract",
      type: "abstract",
      purpose: "Summarize the completed review.",
      targetLength: 250,
    },
  ],
  evidenceRequirements: [],
});
assert.equal(plan.components.length, 2);

assert.equal(
  DocumentPlanSchema.safeParse({
    ...plan,
    components: [plan.components[0], plan.components[0]],
  }).success,
  false,
);

const spec = FinalDocumentSpecSchema.parse({
  requestId,
  schemaVersion: 1,
  templateSnapshot,
  metadata: {
    title: "物理凝胶制备方法",
    language: "zh",
    documentType: "sci_review",
    referencesStatus: "verified",
  },
  blocks: [
    {
      id: "abstract",
      type: "paragraph",
      role: "abstract",
      text: "本文系统总结物理凝胶制备方法。",
      citationIds: ["ref-1"],
    },
    {
      id: "keywords",
      type: "keywords",
      values: ["物理凝胶", "制备方法", "非共价作用"],
    },
    {
      id: "introduction",
      type: "heading",
      level: 1,
      text: "Introduction",
    },
  ],
  references: [
    {
      id: "ref-1",
      title: "Verified source",
      authors: ["Example Author"],
      verifiedBy: "user_material",
      sourceId: "attachment-1",
    },
  ],
});
assert.equal(spec.blocks[0].id, "abstract");

assert.equal(
  FinalDocumentSpecSchema.safeParse({
    ...spec,
    blocks: [
      {
        id: "body",
        type: "paragraph",
        role: "body",
        text: "Unsupported citation.",
        citationIds: ["missing-reference"],
      },
    ],
  }).success,
  false,
);

const segmentSpec = FinalDocumentSpecSchema.parse({
  ...spec,
  blocks: [
    {
      id: "body-segmented",
      type: "paragraph",
      role: "body",
      text: "First supported claim. Second supported claim.",
      citationIds: ["ref-1"],
      citationGranularity: "segment",
      segments: [
        {
          segmentId: "citation-segment-first",
          order: 0,
          text: "First supported claim.",
          citationIds: ["ref-1"],
        },
        {
          segmentId: "citation-segment-second",
          order: 1,
          text: "Second supported claim.",
          citationIds: [],
        },
      ],
    },
  ],
});
assert.equal(segmentSpec.blocks[0].type, "paragraph");

assert.equal(
  FinalDocumentSpecSchema.safeParse({
    ...segmentSpec,
    blocks: [
      {
        ...segmentSpec.blocks[0],
        text: "First claim [citation:ref-1].",
        segments: [
          {
            segmentId: "citation-segment-leak",
            order: 0,
            text: "First claim [citation:ref-1].",
            citationIds: ["ref-1"],
          },
        ],
      },
    ],
  }).success,
  false,
);

console.log("Document v2 contract tests passed.");
