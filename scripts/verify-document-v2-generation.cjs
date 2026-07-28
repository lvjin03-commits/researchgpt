const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const swc = require("next/dist/build/swc");
const sharp = require("sharp");

const projectRoot = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveResearchGptAlias(
  request,
  parent,
  isMain,
  options,
) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(projectRoot, request.slice(2))
    : request;
  return originalResolveFilename.call(
    this,
    resolvedRequest,
    parent,
    isMain,
    options,
  );
};

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = swc.transformSync(source, {
    filename,
    jsc: {
      parser: { syntax: "typescript" },
      target: "es2022",
    },
    module: { type: "commonjs" },
  });
  module._compile(output.code, filename);
};

const {
  ModelDocumentComponentGenerator,
} = require("../lib/document-v2/generation/model-component-generator.ts");
const {
  FigureAssetQualityError,
  ValidatedFigureAssetPipeline,
} = require("../lib/document-v2/assets/figure-pipeline.ts");
const {
  MatureDocumentComponentValidator,
} = require("../lib/document-v2/generation/mature-content-validator.ts");
const {
  createDocumentOrchestrationState,
  runDocumentOrchestration,
} = require("../lib/document-v2/orchestration/orchestrator.ts");
const {
  DocumentPlanningError,
  createDocumentPlanFromTemplate,
} = require("../lib/document-v2/planning/planner.ts");
const {
  renderFinalDocumentSpecToDocx,
} = require("../lib/document-v2/renderers/docx.ts");
const {
  resolveDocumentTemplate,
} = require("../lib/document-v2/templates/resolver.ts");
const JSZip = require("jszip");

const request = {
  requestId: "005de79d-4de0-4ea1-8c25-d248088c16b4",
  schemaVersion: 1,
  action: "generate",
  source: { kind: "attachments", sourceIds: ["source-1"] },
  outputFormat: "docx",
  language: "en",
  templateIntent: "sci_review",
  userRequirements: {
    topic: "Physical gel preparation",
    targetLength: 2_000,
  },
};

const verifiedReferences = [
  {
    id: "ref-2",
    title: "Supplementary verified source",
    authors: ["B. Scientist"],
    year: 2024,
    venue: "Polymer Science",
    verifiedBy: "literature_service",
    sourceId: "source-1",
  },
  {
    id: "ref-1",
    title: "Verified physical gel review",
    authors: ["A. Researcher"],
    year: 2025,
    venue: "Materials Review",
    verifiedBy: "user_material",
    sourceId: "source-1",
  },
];

async function resolveTemplate() {
  return resolveDocumentTemplate({
    request,
    matcher: {
      async match() {
        return {
          templateId: "sci-review",
          confidence: 0.99,
          rationale: "The user requests an SCI review Word document.",
        };
      },
    },
  });
}

async function createPlan(template) {
  return createDocumentPlanFromTemplate({
    request,
    template,
    availableEvidenceIds: ["ref-1"],
    outlinePlanner: {
      async propose({ minimumSections, maximumSections }) {
        assert.equal(minimumSections, 1);
        assert.equal(maximumSections, 8);
        return {
          sections: [
            {
              heading: "1 Introduction",
              purpose:
                "Define physical gels and explain why preparation controls structure.",
              relativeWeight: 1,
              requiredEvidenceIds: ["ref-1"],
            },
            {
              heading: "2 Preparation Routes",
              purpose:
                "Compare representative routes and their structural consequences.",
              relativeWeight: 3,
              requiredEvidenceIds: ["ref-1"],
            },
          ],
          conclusionHeading: "3 Conclusion",
        };
      },
    },
  });
}

function maturePayload(component, repairFeedback) {
  switch (component.type) {
    case "title":
      return {
        kind: "title",
        title: "Physical Gel Preparation and Structural Control",
      };
    case "abstract":
      return {
        kind: "blocks",
        blocks: [
          {
            type: "paragraph",
            role: "abstract",
            text: "This review examines preparation-dependent structure formation in physical gels.",
            citationIds: ["ref-1"],
          },
        ],
      };
    case "keywords":
      return {
        kind: "blocks",
        blocks: [
          {
            type: "keywords",
            values: ["physical gels", "preparation", "network structure"],
          },
        ],
      };
    case "section":
      if (
        component.heading === "2 Preparation Routes" &&
        !repairFeedback
      ) {
        return {
          kind: "blocks",
          blocks: [
            { type: "heading", level: 1, text: component.heading },
            {
              type: "paragraph",
              role: "body",
              text: "TODO: insert raw evidenceType=aistructure here.",
              citationIds: ["ref-1"],
            },
          ],
        };
      }
      return {
        kind: "blocks",
        blocks: [
          { type: "heading", level: 1, text: component.heading },
          {
            type: "paragraph",
            role: "body",
            text:
              component.heading === "1 Introduction"
                ? "Physical gels rely on reversible junctions whose topology depends on processing history."
                : "Freeze-thaw cycling and solvent exchange create distinct junction domains and network morphologies.",
            citationIds:
              component.heading === "1 Introduction" ? ["ref-1"] : ["ref-2"],
            figureRequestIndexes:
              component.heading === "2 Preparation Routes" ? [0] : [],
          },
          ...(component.heading === "2 Preparation Routes"
            ? [
                {
                  type: "table",
                  caption:
                    "Representative routes and their structural consequences",
                  columns: ["Route", "Dominant process", "Network outcome"],
                  rows: [
                    [
                      "Freeze-thaw",
                      "Crystallization",
                      "Physical junction domains",
                    ],
                    [
                      "Solvent exchange",
                      "Solubility transition",
                      "Aggregated network",
                    ],
                  ],
                },
              ]
            : []),
        ],
        figureRequests:
          component.heading === "2 Preparation Routes"
            ? [
                {
                  figureType: "process_flow",
                  title: "Preparation route to network structure",
                  caption:
                    "Preparation routes create distinct physical junction domains",
                  altText:
                    "Flow diagram connecting freeze-thaw and solvent exchange routes to different physical gel network structures.",
                  contentBrief:
                    "Draw two preparation routes converging on distinct junction-domain structures; use publication-ready labels and no raw data.",
                  placementAfterBlockIndex: 2,
                  sourceEvidenceIds: ["ref-1"],
                },
              ]
            : [],
      };
    case "conclusion":
      return {
        kind: "blocks",
        blocks: [
          { type: "heading", level: 1, text: component.heading },
          {
            type: "paragraph",
            role: "conclusion",
            text: "Future studies should quantify links among processing, topology, and performance.",
            citationIds: [],
          },
        ],
      };
    case "reference_list":
      return { kind: "references", referenceIds: ["ref-2", "ref-1"] };
    default:
      throw new Error(`Unsupported component type ${component.type}`);
  }
}

async function verifyCompleteGenerationFlow() {
  const template = await resolveTemplate();
  const plan = await createPlan(template);
  assert.deepEqual(
    plan.components.map((component) => component.componentKey),
    [
      "title",
      "abstract",
      "keywords",
      "section-01",
      "section-02",
      "conclusion",
      "references",
    ],
  );
  assert.deepEqual(
    plan.components
      .filter((component) => component.type === "section")
      .map((component) => component.targetLength),
    [400, 1_200],
  );
  assert.equal(
    plan.components.reduce(
      (sum, component) => sum + (component.targetLength ?? 0),
      0,
    ),
    2_000,
    "Planner must allocate the complete requested length budget.",
  );

  const modelCalls = {};
  let figureGeneratorCalls = 0;
  const lowResolutionPng = await sharp({
    create: {
      width: 300,
      height: 200,
      channels: 4,
      background: "#ffffff",
    },
  })
    .png()
    .withMetadata({ density: 72 })
    .toBuffer();
  const figureSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="2100" height="1000" viewBox="0 0 2100 1000">
      <rect width="2100" height="1000" fill="#ffffff"/>
      <rect x="120" y="180" width="520" height="180" rx="24" fill="#f2f2f2" stroke="#222222" stroke-width="8"/>
      <text x="380" y="290" text-anchor="middle" font-family="Arial" font-size="62">Freeze-thaw</text>
      <rect x="120" y="640" width="520" height="180" rx="24" fill="#f2f2f2" stroke="#222222" stroke-width="8"/>
      <text x="380" y="750" text-anchor="middle" font-family="Arial" font-size="62">Solvent exchange</text>
      <path d="M660 270 H1040" stroke="#222222" stroke-width="12"/>
      <path d="M660 730 H1040" stroke="#222222" stroke-width="12"/>
      <path d="M1010 240 L1080 270 L1010 300 Z" fill="#222222"/>
      <path d="M1010 700 L1080 730 L1010 760 Z" fill="#222222"/>
      <rect x="1100" y="180" width="850" height="640" rx="30" fill="#ffffff" stroke="#222222" stroke-width="8"/>
      <text x="1525" y="340" text-anchor="middle" font-family="Arial" font-size="58">Distinct junction domains</text>
      <circle cx="1370" cy="520" r="70" fill="#d9d9d9" stroke="#222222" stroke-width="6"/>
      <circle cx="1680" cy="520" r="70" fill="#d9d9d9" stroke="#222222" stroke-width="6"/>
      <path d="M1440 520 H1610" stroke="#222222" stroke-width="10"/>
      <text x="1525" y="700" text-anchor="middle" font-family="Arial" font-size="54">Network structure</text>
    </svg>`,
    "utf8",
  );
  const fallbackPng = await sharp(figureSvg, { density: 300 })
    .png()
    .withMetadata({ density: 300 })
    .toBuffer();
  const figureAssetMaterializer = new ValidatedFigureAssetPipeline({
    async generate() {
      figureGeneratorCalls += 1;
      if (figureGeneratorCalls === 1) {
        return { format: "png", data: lowResolutionPng };
      }
      return {
        format: "svg",
        data: figureSvg,
        fallbackPng,
      };
    },
  });
  const generator = new ModelDocumentComponentGenerator({
    async generate({ schemaName, systemInstruction, componentInstruction }) {
      assert.equal(schemaName, "document_component_payload_v1");
      assert.match(systemInstruction, /publication-ready/);
      const instruction = JSON.parse(componentInstruction);
      const heading = instruction.component.heading ?? instruction.component.type;
      modelCalls[heading] = (modelCalls[heading] ?? 0) + 1;
      return maturePayload(
        instruction.component,
        instruction.repairFeedback,
      );
    },
  });
  const state = createDocumentOrchestrationState({
    jobId: "c725c33d-ebcf-46ae-893c-cb9031a1f146",
    request,
    plan,
    verifiedReferences,
  });
  const completed = await runDocumentOrchestration(state, {
    generator,
    validator: new MatureDocumentComponentValidator(),
    figureAssetMaterializer,
    maxAttemptsPerComponent: 2,
  });

  assert.equal(completed.status, "completed");
  assert.equal(modelCalls.title, 1);
  assert.equal(modelCalls["1 Introduction"], 1);
  assert.equal(
    modelCalls["2 Preparation Routes"],
    2,
    "Only the component leaking internal content should be regenerated.",
  );
  assert.equal(
    figureGeneratorCalls,
    2,
    "Low-quality image output should retry only the image generator.",
  );
  assert.equal(completed.finalSpec.assets.length, 1);
  assert.deepEqual(
    completed.finalSpec.references.map((reference) => reference.id),
    ["ref-1", "ref-2"],
    "References must follow first citation order rather than pool or selection order.",
  );
  assert.equal(
    completed.finalSpec.blocks.filter((block) => block.type === "figure")
      .length,
    1,
  );
  assert.equal(
    completed.events.find(
      (event) =>
        event.type === "component_rejected" &&
        event.componentKey === "section-02",
    ).code,
    "internal_content_leak",
  );
  assert.equal(
    completed.finalSpec.blocks.some((block) =>
      "text" in block ? /TODO|evidenceType/i.test(block.text) : false,
    ),
    false,
  );
  const buffer = await renderFinalDocumentSpecToDocx(completed.finalSpec);
  assert.equal(Buffer.isBuffer(buffer), true);
  assert(buffer.length > 10_000);
  const archive = await JSZip.loadAsync(buffer);
  const documentXml = await archive.file("word/document.xml").async("string");
  assert.match(documentXml, /Physical Gel Preparation and Structural Control/);
  assert.match(documentXml, /2 Preparation Routes/);
  assert.match(documentXml, /Table 1 \|/);
  assert.match(documentXml, /Fig\. 1 \|/);
  assert.match(documentXml, /\[Fig\. 1\]/);
  assert.doesNotMatch(documentXml, /TODO|evidenceType|aistructure/i);
  assert.doesNotMatch(documentXml, /Draw two preparation routes/i);
  const mediaFiles = Object.keys(archive.files).filter((entry) =>
    /^word\/media\//.test(entry),
  );
  assert(
    mediaFiles.some((entry) => entry.endsWith(".svg")) &&
      mediaFiles.some((entry) => entry.endsWith(".png")),
    "DOCX must contain the final SVG and its PNG fallback.",
  );
  const outputDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "researchgpt-document-v2-generation-"),
  );
  const outputPath = path.join(outputDirectory, "mature-generation.docx");
  fs.writeFileSync(outputPath, buffer);
  console.log(outputPath);
}

async function verifyPlannerRejectsInvalidOutline() {
  const template = await resolveTemplate();
  await assert.rejects(
    createDocumentPlanFromTemplate({
      request,
      template,
      availableEvidenceIds: ["ref-1"],
      outlinePlanner: {
        async propose() {
          return {
            sections: Array.from({ length: 9 }, (_, index) => ({
              heading: `${index + 1} Section`,
              purpose: "Exceeds template section limit.",
              relativeWeight: 1,
              requiredEvidenceIds: [],
            })),
            conclusionHeading: "Conclusion",
          };
        },
      },
    }),
    DocumentPlanningError,
  );
}

async function verifyUnsafeSvgIsRejected() {
  const fallbackPng = await sharp({
    create: {
      width: 1_200,
      height: 600,
      channels: 4,
      background: "#ffffff",
    },
  })
    .png()
    .withMetadata({ density: 300 })
    .toBuffer();
  const pipeline = new ValidatedFigureAssetPipeline(
    {
      async generate() {
        return {
          format: "svg",
          data: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
          ),
          fallbackPng,
        };
      },
    },
    1,
  );
  await assert.rejects(
    pipeline.materialize({
      requestId: "figure-security-check",
      componentKey: "section-01",
      figureType: "mechanism_diagram",
      title: "Security check",
      caption: "Security check diagram",
      altText: "A security-check diagram.",
      contentBrief: "Create a safe static diagram.",
      placementAfterBlockIndex: 0,
      sourceEvidenceIds: [],
    }),
    FigureAssetQualityError,
  );
}

async function main() {
  await verifyCompleteGenerationFlow();
  await verifyPlannerRejectsInvalidOutline();
  await verifyUnsafeSvgIsRejected();
  console.log("Document v2 mature generation tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
