const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const swc = require("next/dist/build/swc");
const sharp = require("sharp");
const { z } = require("zod");

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
  OpenAIStructuredComponentModel,
} = require("../lib/document-v2-production/openai-adapters.ts");
const {
  ModelHierarchicalOutlinePlanner,
} = require("../lib/document-v2-production/planning.ts");
const {
  FigureAssetQualityError,
  ValidatedFigureAssetPipeline,
} = require("../lib/document-v2/assets/figure-pipeline.ts");
const {
  MatureDocumentComponentValidator,
} = require("../lib/document-v2/generation/mature-content-validator.ts");
const {
  createDocumentOrchestrationState,
  invalidateDocumentComponent,
  runDocumentOrchestration,
} = require("../lib/document-v2/orchestration/orchestrator.ts");
const {
  DocumentPlanningError,
  OutlineLanguageMismatchError,
  assertSectionIndexLanguageRepairInvariant,
  assembleSemanticOutline,
  createValidatedSectionIndex,
  createDocumentPlanFromTemplate,
  findSectionIndexLanguageViolations,
  materializeDocumentStructure,
  materializeFigureIntents,
  materializeDocumentSkeleton,
  materializeSectionPlan,
  validateSectionIndexForPublication,
} = require("../lib/document-v2/planning/planner.ts");
const {
  createDocumentPlanningLanguageContract,
  headingUsesDocumentLanguage,
} = require("../lib/document-v2/planning/language-contract.ts");
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
          figures: [
            {
              sectionIndex: 1,
              figureType: "process_flow",
              purpose:
                "Explain how preparation routes create different network structures.",
              requiredEvidenceIds: ["ref-1"],
            },
          ],
        };
      },
    },
  });
}

function maturePayload(component, repairFeedback) {
  switch (component.type) {
    case "title":
      return {
        title: "Physical Gel Preparation and Structural Control",
      };
    case "abstract":
      return {
        paragraphs: [
          {
            text: "This review examines preparation-dependent structure formation in physical gels.",
            citationIds: ["ref-1"],
          },
        ],
      };
    case "keywords":
      return {
        keywords: ["physical gels", "preparation", "network structure"],
      };
    case "section":
      if (
        component.heading === "2 Preparation Routes" &&
        !repairFeedback
      ) {
        return {
          paragraphs: [
            {
              text: "TODO: insert raw evidenceType=aistructure here.",
              citationIds: ["ref-1"],
              figureReferenceIds: ["figure-slot-01"],
            },
          ],
          tables: [],
          figureRequests: [
            {
              slotId: "figure-slot-01",
              title: "Preparation route to network structure",
              caption:
                "Preparation routes create distinct physical junction domains",
              altText:
                "Flow diagram connecting preparation routes to gel network structures.",
              contentBrief:
                "Show preparation routes converging on distinct junction-domain structures.",
              placementAfterParagraphIndex: 0,
            },
          ],
        };
      }
      return {
        paragraphs: [
          {
            text:
              component.heading === "1 Introduction"
                ? "Physical gels rely on reversible junctions whose topology depends on processing history."
                : "Freeze-thaw cycling and solvent exchange create distinct junction domains and network morphologies.",
            citationIds:
              component.heading === "1 Introduction" ? ["ref-1"] : ["ref-2"],
            figureReferenceIds:
              component.heading === "2 Preparation Routes"
                ? ["figure-slot-01"]
                : [],
          },
        ],
        tables:
          component.heading === "2 Preparation Routes"
            ? [
                {
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
                  placementAfterParagraphIndex: 0,
                },
              ]
            : [],
        figureRequests:
          component.heading === "2 Preparation Routes"
            ? [
                {
                  slotId: "figure-slot-01",
                  title: "Preparation route to network structure",
                  caption:
                    "Preparation routes create distinct physical junction domains",
                  altText:
                    "Flow diagram connecting freeze-thaw and solvent exchange routes to different physical gel network structures.",
                  contentBrief:
                    "Draw two preparation routes converging on distinct junction-domain structures; use publication-ready labels and no raw data.",
                  placementAfterParagraphIndex: 0,
                },
              ]
            : [],
      };
    case "conclusion":
      return {
        paragraphs: [
          {
            text: "Future studies should quantify links among processing, topology, and performance.",
            citationIds: [],
          },
        ],
      };
    case "reference_list":
      return { referenceIds: ["ref-2", "ref-1"] };
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
  const generationOrder = [];
  let abstractApprovedContext = [];
  let conclusionInstruction = "";
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
    async generate({ schemaName, schema, systemInstruction, componentInstruction }) {
      assert.match(schemaName, /^document_.+_v2$/);
      assert.match(systemInstruction, /publication-ready/);
      const instruction = JSON.parse(componentInstruction);
      assert.equal(instruction.componentContract.contractVersion, 2);
      assert.equal(
        instruction.componentContract.modelOwnedFields.includes("kind"),
        false,
        "Internal discriminators must not remain part of the model contract.",
      );
      const heading = instruction.component.heading ?? instruction.component.type;
      generationOrder.push(instruction.component.type === "section"
        ? instruction.component.heading
        : instruction.component.type);
      if (instruction.component.type === "abstract") {
        abstractApprovedContext = instruction.approvedComponents.map(
          (approved) => approved.componentKey,
        );
      }
      if (instruction.component.type === "conclusion") {
        conclusionInstruction = componentInstruction;
      }
      modelCalls[heading] = (modelCalls[heading] ?? 0) + 1;
      return schema.parse(
        maturePayload(
          instruction.component,
          instruction.repairFeedback,
        ),
      );
    },
  });
  const state = createDocumentOrchestrationState({
    jobId: "c725c33d-ebcf-46ae-893c-cb9031a1f146",
    request,
    plan,
    verifiedReferences,
  });
  const orchestrationOptions = {
    generator,
    validator: new MatureDocumentComponentValidator(),
    figureAssetMaterializer,
    maxAttemptsPerComponent: 2,
    maxComponentsPerRun: 1,
  };
  let completed = state;
  for (let index = 0; index < plan.components.length; index += 1) {
    completed = await runDocumentOrchestration(
      completed,
      orchestrationOptions,
    );
    assert.equal(completed.status, "paused");
  }
  assert.equal(
    completed.components.filter((component) => component.status === "approved")
      .length,
    plan.components.length,
    "all mature text components must be checkpointed before asset generation",
  );
  assert.equal(figureGeneratorCalls, 0);
  assert.equal(completed.figures.length, 1);
  assert.equal(completed.figures[0].status, "pending");

  completed = await runDocumentOrchestration(
    completed,
    orchestrationOptions,
  );
  assert.equal(completed.status, "paused");
  assert.equal(figureGeneratorCalls, 2);
  assert.equal(completed.figures[0].status, "approved");
  assert.deepEqual(
    completed.figures[0].request.sourceEvidenceIds,
    ["ref-1"],
    "Figure evidence bindings must come from the frozen Figure Plan.",
  );

  while (completed.status === "paused") {
    completed = await runDocumentOrchestration(
      completed,
      orchestrationOptions,
    );
  }

  assert.equal(completed.status, "completed");
  const invalidated = invalidateDocumentComponent(completed, "section-02");
  assert.equal(
    invalidated.components.find((item) => item.componentKey === "section-02").status,
    "pending",
  );
  for (const dependentKey of [
    "conclusion",
    "abstract",
    "keywords",
    "title",
    "references",
  ]) {
    assert.equal(
      invalidated.components.find((item) => item.componentKey === dependentKey).status,
      "stale",
      `${dependentKey} must become stale after an upstream section revision.`,
    );
  }
  assert.deepEqual(
    generationOrder.filter((value, index, values) => index === 0 || value !== values[index - 1]),
    [
      "1 Introduction",
      "2 Preparation Routes",
      "conclusion",
      "abstract",
      "keywords",
      "title",
      "reference_list",
    ],
    "Generation must follow semantic dependencies, not Word display order.",
  );
  assert.deepEqual(
    abstractApprovedContext,
    ["section-01", "section-02", "conclusion"],
    "The abstract must receive the approved body and conclusion.",
  );
  assert(
    conclusionInstruction.length < 60_000,
    "Approved dependency context must stay within a bounded prompt budget.",
  );
  assert.doesNotMatch(
    conclusionInstruction,
    /dataBase64|fallbackPngBase64|PHN2Zy/,
    "Generated image bytes must never be copied into later model prompts.",
  );
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
  assert.match(documentXml, /\(see Fig\. 1\)/);
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

async function verifyPlannerRepairsTemplateComponentLeakage() {
  const template = await resolveTemplate();
  let calls = 0;
  let receivedRepairFeedback;
  const plan = await createDocumentPlanFromTemplate({
    request,
    template,
    availableEvidenceIds: ["ref-1"],
    outlinePlanner: {
      async propose(input) {
        calls += 1;
        receivedRepairFeedback = input.repairFeedback ?? receivedRepairFeedback;
        if (calls === 1) {
          return {
            sections: [
              {
                heading: "Generate the review title",
                purpose:
                  "Write the final title, abstract, and keywords requested by the user.",
                relativeWeight: 1,
                requiredEvidenceIds: [],
              },
            ],
            conclusionHeading: "Conclusion",
          };
        }
        return {
          sections: [
            {
              heading: "Preparation mechanisms",
              purpose:
                "Explain how processing routes establish reversible physical junctions.",
              relativeWeight: 1,
              requiredEvidenceIds: ["ref-1"],
            },
          ],
          conclusionHeading: "Conclusion",
        };
      },
    },
  });

  assert.equal(calls, 2, "An invalid body outline must be repaired once.");
  assert.match(receivedRepairFeedback, /body section/i);
  assert.deepEqual(
    plan.components.map((component) => component.type),
    [
      "title",
      "abstract",
      "keywords",
      "section",
      "conclusion",
      "reference_list",
    ],
    "Template-owned components must remain distinct from AI-planned body sections.",
  );
  assert.equal(
    plan.components.find((component) => component.type === "section").heading,
    "Preparation mechanisms",
  );
}

async function verifyPlannerRejectsOverloadedSection() {
  const template = await resolveTemplate();
  let calls = 0;
  await assert.rejects(
    createDocumentPlanFromTemplate({
      request,
      template,
      availableEvidenceIds: [],
      outlinePlanner: {
        async propose() {
          calls += 1;
          return {
            sections: [
              {
                heading: "Physical crosslinking mechanisms",
                purpose:
                  "Cover all mechanisms. Figure 1: mechanism overview. Table 1: six-column comparison. Subsections 2.1 Hydrogen bonding 2.2 Hydrophobic association 2.3 Ionic coordination 2.4 Crystallization 2.5 Host-guest chemistry 2.6 Topological constraints.",
                relativeWeight: 1,
                requiredEvidenceIds: [],
              },
            ],
            conclusionHeading: "Conclusion",
          };
        },
      },
    }),
    DocumentPlanningError,
  );
  assert.equal(calls, 2, "An overloaded outline receives one bounded repair attempt.");
}

async function verifyPlannerRepairsUnsupportedDataPlotBeforeGeneration() {
  const template = await resolveTemplate();
  let calls = 0;
  let receivedRepairFeedback = "";
  const plan = await createDocumentPlanFromTemplate({
    request,
    template,
    availableEvidenceIds: ["ref-1"],
    outlinePlanner: {
      async propose(input) {
        calls += 1;
        receivedRepairFeedback =
          input.repairFeedback ?? receivedRepairFeedback;
        const base = {
          sections: [
            {
              heading: "Quantitative interpretation",
              purpose:
                "Explain what verified evidence can and cannot establish about preparation outcomes.",
              relativeWeight: 1,
              requiredEvidenceIds: ["ref-1"],
            },
          ],
          conclusionHeading: "Conclusion",
        };
        if (calls === 1) {
          return {
            ...base,
            figures: [
              {
                sectionIndex: 0,
                figureType: "data_plot",
                purpose: "Plot a quantitative preparation trend.",
                requiredEvidenceIds: ["ref-1"],
              },
            ],
          };
        }
        return {
          ...base,
          figures: [
            {
              sectionIndex: 0,
              figureType: "conceptual_framework",
              purpose:
                "Summarize the evidence boundaries without asserting quantitative values.",
              requiredEvidenceIds: ["ref-1"],
            },
          ],
        };
      },
    },
  });

  assert.equal(calls, 2, "An unsupported data plot receives one plan repair.");
  assert.match(receivedRepairFeedback, /no verified dataset asset/i);
  assert.equal(plan.figureSlots[0].figureType, "conceptual_framework");
  assert.deepEqual(plan.figureSlots[0].requiredEvidenceIds, ["ref-1"]);
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

async function verifyOpenAiComponentSchemaHasObjectRoot() {
  const adapter = new OpenAIStructuredComponentModel({
    async generate(input) {
      return input.schema.parse({
        payload: {
          title: "Validated object-root schema",
        },
      });
    },
  });
  const result = await adapter.generate({
    schemaName: "document_title_v2",
    schema: z.object({ title: z.string() }).strict(),
    systemInstruction: "test",
    componentInstruction: "test",
  });
  assert.equal(result.title, "Validated object-root schema");
}

async function verifyOutlineSchemaUsesTemplateBounds() {
  let call = 0;
  const planner = new ModelHierarchicalOutlinePlanner({
    profile: { maxOutputTokens: 3200 },
    async generate(input) {
      call += 1;
      const planningInput = JSON.parse(input.userInstruction);
      assert.equal(planningInput.planningContext.documentLanguage, "en");
      assert.equal(
        planningInput.planningContext.documentLanguageName,
        "English",
      );
      assert.equal(planningInput.planningContext.requestRevision, 3);
      if (call === 1) {
        assert.equal(input.operation, "outline.thesis");
        assert.equal(input.budgetKey, "outline.thesis");
        return {
          reviewThesis:
            "Processing history controls the network state of physical gels.",
          scopeBoundary:
            "Focus on reversible physical junctions and their preparation.",
          reviewQuestions: [
            "How does processing history determine network structure?",
          ],
          conclusionHeading: "Conclusion",
        };
      }
      assert.equal(input.operation, "outline.section_index");
      assert.equal(input.budgetKey, "outline.section_index");
      assert.equal(
        input.schema.safeParse({
          sections: [],
        }).success,
        false,
      );
      return {
        sections: [
          {
            heading: "Mechanism",
            question: "How are reversible junctions formed?",
            purpose: "Explain the mechanism.",
            owns: ["Reversible junction formation"],
            excludes: ["Covalent gels"],
            relativeWeight: 1,
          },
        ],
      };
    },
  });
  const template = await resolveTemplate();
  const base = {
    request,
    template,
    planningRevision: 3,
  };
  const thesis = await planner.createThesis(base);
  const proposal = await planner.createSectionIndex({
    ...base,
    thesis,
    minimumSections: 1,
    maximumSections: 2,
  });
  assert.equal(proposal.sections.length, 1);
  assert.match(thesis.reviewThesis, /Processing history/);
}

async function verifyFigureIntentPlanningUsesSectionOrder() {
  const structure = materializeDocumentStructure({
    thesis: {
      reviewThesis: "Processing controls structure.",
      scopeBoundary: "Physical gels.",
      reviewQuestions: ["How does processing control structure?"],
      conclusionHeading: "Conclusion",
    },
    sectionIndex: {
      sections: [
        {
          heading: "Mechanisms",
          question: "Which mechanisms dominate?",
          purpose: "Compare mechanisms.",
          owns: ["Reversible junctions"],
          excludes: ["Covalent gels"],
          relativeWeight: 1,
        },
      ],
    },
  });
  const completed = materializeFigureIntents({
    skeleton: structure,
    draft: {
      figures: [
        {
          sectionOrder: 1,
          figureType: "mechanism_diagram",
          purpose: "Explain reversible junctions.",
          questionAnswered: "How do junctions form?",
          claimsRepresented: ["Junctions are reversible."],
          evidenceRequired: false,
        },
      ],
    },
  });
  assert.equal(completed.figures[0].sectionIndex, 0);
  assert.equal(completed.figures[0].figureIntentId, "figure-intent-01");
}

async function verifySectionIndexLanguageContractAndBoundedRepair() {
  const template = await resolveTemplate();
  const zhRequest = {
    ...request,
    language: "zh",
    userRequirements: {
      ...request.userRequirements,
      topic: "大语言模型",
    },
  };
  const thesis = {
    reviewThesis: "大语言模型的发展取决于架构、数据与评估体系的协同演进。",
    scopeBoundary: "聚焦通用大语言模型的技术演进与科研应用。",
    reviewQuestions: ["大语言模型的能力如何形成并被可靠评估？"],
    conclusionHeading: "结论",
  };
  const operations = [];
  const modelInputs = [];
  const planner = new ModelHierarchicalOutlinePlanner({
    profile: { maxOutputTokens: 3200 },
    async generate(input) {
      operations.push(input.operation);
      const payload = JSON.parse(input.userInstruction);
      modelInputs.push(payload);
      assert.equal(payload.planningContext.documentLanguage, "zh");
      assert.equal(
        payload.planningContext.documentLanguageName,
        "Simplified Chinese",
      );
      assert.match(
        payload.planningContext.documentLanguageInstruction,
        /Simplified Chinese/,
      );
      if (payload.mode === "repair_language") {
        assert.equal(payload.sourceRevision, 4);
        assert.deepEqual(
          payload.violations.map((item) => item.sectionOrder),
          [1, 2],
        );
        return {
          sections: payload.sourceSectionIndex.sections.map(
            (section, index) => ({
              ...section,
              heading:
                index === 0
                  ? "大语言模型的基础架构"
                  : "训练方法与能力形成",
            }),
          ),
        };
      }
      return {
        sections: [
          {
            heading: "Large Language Model Architectures",
            question: "模型架构如何影响能力？",
            purpose: "比较主要架构及其能力边界。",
            owns: ["模型架构"],
            excludes: ["应用部署"],
            relativeWeight: 1,
          },
          {
            heading: "Training and Emergent Capabilities",
            question: "训练过程如何形成模型能力？",
            purpose: "分析数据、目标函数与能力形成的关系。",
            owns: ["训练方法"],
            excludes: ["推理部署"],
            relativeWeight: 2,
          },
        ],
      };
    },
  });
  const repaired = await createValidatedSectionIndex({
    planner,
    request: zhRequest,
    template,
    thesis,
    minimumSections: 1,
    maximumSections: 8,
    planningRevision: 4,
  });
  assert.deepEqual(operations, [
    "outline.section_index",
    "outline.section_index",
  ]);
  assert.equal(modelInputs[0].mode, "generate");
  assert.equal(modelInputs[1].mode, "repair_language");
  assert.equal(repaired.sections[0].heading, "大语言模型的基础架构");
  assert.equal(repaired.sections[0].purpose, "比较主要架构及其能力边界。");
  assert.equal(headingUsesDocumentLanguage("PVA物理凝胶", "zh"), true);
  assert.equal(headingUsesDocumentLanguage("SEM表征", "zh"), true);
  assert.equal(headingUsesDocumentLanguage("3D打印应用", "zh"), true);
  assert.equal(
    headingUsesDocumentLanguage("Preparation Methods of Physical Gels", "zh"),
    false,
  );
  assert.throws(
    () =>
      validateSectionIndexForPublication({
        sectionIndex: {
          sections: [
            {
              heading: "Preparation Methods of Physical Gels",
              question: "制备方法有哪些？",
              purpose: "比较不同制备方法。",
              owns: [],
              excludes: [],
              relativeWeight: 1,
            },
          ],
        },
        language: "zh",
        minimumSections: 1,
        maximumSections: 8,
        sourceRevision: 1,
      }),
    OutlineLanguageMismatchError,
  );
  assert.throws(() =>
    assertSectionIndexLanguageRepairInvariant({
      original: repaired,
      repaired: {
        sections: repaired.sections.map((section) => ({
          ...section,
          purpose: `${section.purpose} changed`,
        })),
      },
      violations: findSectionIndexLanguageViolations({
        sectionIndex: {
          sections: repaired.sections.map((section) => ({
            ...section,
            heading: "English Heading",
          })),
        },
        language: "zh",
      }),
    }),
  );
  const zhContract = createDocumentPlanningLanguageContract("zh");
  const enContract = createDocumentPlanningLanguageContract("en");
  assert.notDeepEqual(zhContract, enContract);
}

function verifyHierarchicalOutlineAssembly() {
  const skeleton = materializeDocumentSkeleton({
    reviewThesis: "Preparation history controls gel structure.",
    scopeBoundary: "Reversible physical gels.",
    reviewQuestions: ["How does processing control structure?"],
    sections: [
      { heading: "Pathways", question: "Which routes exist?", purpose: "Compare routes.", relativeWeight: 1 },
      { heading: "Properties", question: "How is function controlled?", purpose: "Connect structure and behavior.", relativeWeight: 2 },
    ],
    conclusionHeading: "Conclusions",
    figures: [],
  });
  assert.deepEqual(skeleton.sections.map((item) => item.sectionId), ["section-01", "section-02"]);
  assert.throws(() => materializeDocumentSkeleton({
    reviewThesis: "x", scopeBoundary: "y", reviewQuestions: ["z"],
    sections: [{ sectionId: "model-id", heading: "h", question: "q", purpose: "p", relativeWeight: 1 }],
    conclusionHeading: "c", figures: [],
  }));
  const sectionPlans = skeleton.sections.map((section) => materializeSectionPlan({
    sectionId: section.sectionId,
    draft: { contributionToThesis: "Advance the thesis.", comparisonDimensions: [], applicableConditions: [], failureModes: [], requiredEvidenceIds: [] },
  }));
  assert.equal(assembleSemanticOutline({ skeleton, sectionPlans }).sections.length, 2);
}

async function verifyManualFigureNumbersAreRejected() {
  const validator = new MatureDocumentComponentValidator();
  const result = await validator.validate({
    request,
    plan: {
      requestId: request.requestId,
      schemaVersion: 1,
      templateSnapshot: (await resolveTemplate()).snapshot,
      components: [
        {
          componentKey: "section-01",
          type: "section",
          heading: "1 Mechanism",
          purpose: "Explain the mechanism.",
          dependsOnComponentKeys: [],
        },
      ],
      figureSlots: [],
      figurePlanningCompleted: true,
      evidenceRequirements: [],
    },
    component: {
      componentKey: "section-01",
      type: "section",
      heading: "1 Mechanism",
      purpose: "Explain the mechanism.",
      dependsOnComponentKeys: [],
    },
    componentIndex: 0,
    attempt: 1,
    payload: {
      kind: "blocks",
      blocks: [
        {
          type: "heading",
          level: 1,
          text: "1 Mechanism",
        },
        {
          type: "paragraph",
          role: "body",
          text: "As shown in Figure 1, the network is reversible.",
          citationIds: [],
          figureRequestIndexes: [],
        },
      ],
      figureRequests: [],
    },
    approvedComponents: [],
    verifiedReferences: [],
  });
  assert.equal(result.accepted, false);
  assert.equal(result.code, "manual_cross_reference");
}

async function main() {
  await verifyOpenAiComponentSchemaHasObjectRoot();
  await verifyOutlineSchemaUsesTemplateBounds();
  await verifySectionIndexLanguageContractAndBoundedRepair();
  await verifyFigureIntentPlanningUsesSectionOrder();
  verifyHierarchicalOutlineAssembly();
  await verifyManualFigureNumbersAreRejected();
  await verifyCompleteGenerationFlow();
  await verifyPlannerRejectsInvalidOutline();
  await verifyPlannerRepairsTemplateComponentLeakage();
  await verifyPlannerRejectsOverloadedSection();
  await verifyPlannerRepairsUnsupportedDataPlotBeforeGeneration();
  await verifyUnsafeSvgIsRejected();
  console.log("Document v2 mature generation tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
