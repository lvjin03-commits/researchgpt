/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const swc = require("next/dist/build/swc");

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

const JSZip = require("jszip");
const {
  renderFinalDocumentSpecToDocx,
} = require("../lib/document-v2/renderers/docx.ts");
const {
  FinalDocumentSpecSchema,
} = require("../lib/document-v2/contracts.ts");
const {
  assembleDocumentManifest,
} = require("../lib/document-v2/assembly/manifest.ts");
const {
  auditRenderedDocument,
} = require("../lib/document-v2/renderers/quality.ts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
};

function fixture(language) {
  const chinese = language === "zh";
  return {
    requestId: chinese
      ? "1c8fa956-f61b-47ca-b9fd-e16ff00c45f5"
      : "0e648edd-50dd-4713-9dda-38dcf201a598",
    schemaVersion: 1,
    templateSnapshot,
    metadata: {
      title: chinese
        ? "物理凝胶制备与结构调控：从非共价组装到性能设计"
        : "Physical Gel Preparation and Structural Control",
      language,
      documentType: "sci_review",
      referencesStatus: "verified",
    },
    blocks: [
      {
        id: "abstract",
        type: "paragraph",
        role: "abstract",
        text: chinese
          ? "本文综述物理凝胶的非共价组装机制、典型制备路径及结构与性能之间的联系，并讨论可重复制造面临的关键问题。"
          : "This review examines non-covalent assembly mechanisms, representative preparation routes, and structure-property relationships in physical gels.",
        citationIds: ["ref-1"],
      },
      {
        id: "keywords",
        type: "keywords",
        values: chinese
          ? ["物理凝胶", "非共价作用", "制备方法", "结构性能关系"]
          : [
              "physical gels",
              "non-covalent interactions",
              "preparation",
              "structure-property relationships",
            ],
      },
      {
        id: "introduction",
        type: "heading",
        level: 1,
        text: chinese ? "1 引言" : "1 Introduction",
      },
      {
        id: "intro-body",
        type: "paragraph",
        role: "body",
        text: chinese
          ? "物理凝胶依赖氢键、疏水作用、离子作用或结晶微区形成可逆网络。制备历史会改变网络拓扑，因此方法选择必须与目标性能共同设计。"
          : "Physical gels form reversible networks through hydrogen bonding, hydrophobic association, ionic interactions, or crystalline domains. Processing history therefore needs to be designed together with target performance.",
        citationIds: ["ref-1"],
      },
      {
        id: "preparation",
        type: "heading",
        level: 2,
        text: chinese ? "1.1 典型制备路径" : "1.1 Representative routes",
      },
      {
        id: "mechanism",
        type: "heading",
        level: 3,
        text: chinese ? "1.1.1 路径与机制的对应" : "1.1.1 Route-mechanism mapping",
      },
      {
        id: "route-table",
        type: "table",
        caption: chinese
          ? "典型物理凝胶制备路径及主要结构效应"
          : "Representative preparation routes and structural effects",
        columns: chinese
          ? ["制备路径", "主导过程", "主要结构效应"]
          : ["Route", "Dominant process", "Structural effect"],
        rows: chinese
          ? [
              ["冷冻-融化", "结晶与相分离", "形成物理交联微区"],
              ["溶剂交换", "溶解度突变", "诱导链聚集与网络固化"],
            ]
          : [
              [
                "Freeze-thaw",
                "Crystallization and phase separation",
                "Physical crosslink domains",
              ],
              [
                "Solvent exchange",
                "Abrupt solubility change",
                "Chain aggregation and network fixation",
              ],
            ],
      },
      {
        id: "conclusion-heading",
        type: "heading",
        level: 1,
        text: chinese ? "2 结论" : "2 Conclusion",
      },
      {
        id: "conclusion",
        type: "paragraph",
        role: "conclusion",
        text: chinese
          ? "后续研究应建立制备参数、网络结构与宏观性能之间可验证的定量关系。"
          : "Future work should establish verifiable quantitative relationships among processing parameters, network structure, and macroscopic performance.",
        citationIds: [],
      },
    ],
    references: [
      {
        id: "ref-1",
        title: "User-provided review source",
        authors: ["A. Researcher", "B. Scientist"],
        year: 2025,
        venue: "Materials Review",
        doi: "10.1000/example",
        verifiedBy: "user_material",
        sourceId: "attachment-1",
      },
    ],
  };
}

async function inspectDocx(buffer, expectedTitle, language) {
  assert(Buffer.isBuffer(buffer), "Renderer must return a Buffer.");
  assert(buffer.length > 10_000, "DOCX output is unexpectedly small.");
  const archive = await JSZip.loadAsync(buffer);
  const documentXml = await archive.file("word/document.xml").async("string");
  const stylesXml = await archive.file("word/styles.xml").async("string");
  const footerXml = await archive.file("word/footer1.xml").async("string");

  assert(documentXml.includes(expectedTitle), "Document title is missing.");
  assert(
    documentXml.includes(language === "zh" ? "表 1 |" : "Table 1 |"),
    "Localized table caption was not rendered.",
  );
  assert(documentXml.includes("[1]"), "Citation marker was not rendered.");
  assert(
    /<w:pgMar[^>]*w:top="1134"[^>]*w:right="1247"[^>]*w:bottom="1134"[^>]*w:left="1247"/.test(
      documentXml,
    ),
    "SCI v1 page margins are missing.",
  );
  assert(
    !/visualSpecs|evidenceType|aistructure|Figure placeholder/i.test(documentXml),
    "Internal fields or placeholders leaked into the DOCX.",
  );
  assert(stylesXml.includes('w:styleId="DocumentTitle"'), "Title style missing.");
  assert(stylesXml.includes('w:styleId="Heading3"'), "Heading 3 style missing.");
  assert(stylesXml.includes('w:styleId="Reference"'), "Reference style missing.");
  assert(
    /w:left w:val="none"/.test(documentXml) &&
      /w:right w:val="none"/.test(documentXml),
    "Table vertical borders are not disabled.",
  );
  assert(footerXml.includes("PAGE"), "Centered page-number field is missing.");
}

function visibleDocumentText(documentXml) {
  return [...documentXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) =>
      match[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">"),
    )
    .join("");
}

async function main() {
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "researchgpt-document-v2-"),
  );

  for (const language of ["zh", "en"]) {
    const spec = fixture(language);
    const parsedSpec = FinalDocumentSpecSchema.parse(spec);
    const assembly = assembleDocumentManifest(parsedSpec);
    assert(assembly.captions.length === 1, "Assembly must derive one table caption.");
    assert(
      assembly.captions[0].label === (language === "zh" ? "表 1" : "Table 1"),
      "Caption numbering must be derived by the assembly layer.",
    );
    assert(
      new Set(assembly.layout.find((item) => item.blockId === "route-table").tableColumnWidthsDxa).size > 1,
      "Table geometry should reflect content instead of forcing equal columns.",
    );
    const buffer = await renderFinalDocumentSpecToDocx(parsedSpec);
    const quality = await auditRenderedDocument({ buffer, spec: parsedSpec, assembly });
    assert(quality.passed, JSON.stringify(quality.issues));
    assert(quality.metrics.tableCount === 1, "Render QA must count the table.");
    await inspectDocx(buffer, spec.metadata.title, language);
    const outputPath = path.join(outputDir, `sci-review-${language}.docx`);
    fs.writeFileSync(outputPath, buffer);
    console.log(outputPath);
  }

  const segmentSpec = fixture("en");
  segmentSpec.templateSnapshot = {
    ...segmentSpec.templateSnapshot,
    templateVersion: "2",
    citationPolicy: {
      policyVersion: "sci-citation-v1",
      placement: "before_terminal_punctuation",
      display: "bracketed",
      includeAbstract: false,
      includeFigureCaptions: false,
      includeTableCaptions: false,
      includeAppendices: true,
    },
  };
  segmentSpec.blocks[0].citationIds = [];
  const body = segmentSpec.blocks.find((block) => block.id === "intro-body");
  body.text =
    "Processing history controls topology. A second claim describes performance.";
  body.citationIds = ["ref-1", "ref-2"];
  body.citationGranularity = "segment";
  body.segments = [
    {
      segmentId: "citation-segment-one",
      order: 0,
      text: "Processing history controls topology.",
      citationIds: ["ref-1"],
    },
    {
      segmentId: "citation-segment-two",
      order: 1,
      text: "A second claim describes performance.",
      citationIds: ["ref-2"],
    },
  ];
  segmentSpec.references.push({
    id: "ref-2",
    title: "Second verified source",
    authors: ["C. Researcher"],
    year: 2024,
    venue: "Polymer Science",
    verifiedBy: "literature_service",
    sourceId: "source-2",
  });
  const segmentBuffer = await renderFinalDocumentSpecToDocx(segmentSpec);
  const segmentArchive = await JSZip.loadAsync(segmentBuffer);
  const segmentXml = await segmentArchive
    .file("word/document.xml")
    .async("string");
  const segmentText = visibleDocumentText(segmentXml);
  assert(
    segmentText.includes(
      "Processing history controls topology [1]. A second claim describes performance [2].",
    ),
    "Segment citations must render at their supported claim boundaries.",
  );
  assert(
    !segmentText.includes("citation:ref-") &&
      !segmentText.includes("evidence:ref-"),
    "Internal reference markers must never enter visible DOCX text.",
  );
  const leakedArchive = await JSZip.loadAsync(segmentBuffer);
  leakedArchive.file(
    "word/document.xml",
    segmentXml.replace(
      "Processing history controls topology",
      "Processing history controls topology citation-deadbeef",
    ),
  );
  const leakedBuffer = await leakedArchive.generateAsync({ type: "nodebuffer" });
  const leakedQuality = await auditRenderedDocument({ buffer: leakedBuffer });
  assert(
    leakedQuality.issues.some(
      (issue) => issue.code === "visible_internal_token_detected",
    ),
    "Render QA must reject internal IDs in visible text.",
  );
  const segmentOutputPath = path.join(outputDir, "sci-review-segment-citations.docx");
  fs.writeFileSync(segmentOutputPath, segmentBuffer);
  console.log(segmentOutputPath);

  const figureSpec = fixture("en");
  figureSpec.blocks.push({
    id: "figure-1",
    type: "figure",
    caption: "Unsupported figure",
    assetId: "asset-1",
  });
  assert(
    !FinalDocumentSpecSchema.safeParse(figureSpec).success,
    "A figure block without a mature asset must fail the final contract.",
  );
  console.log("Document v2 DOCX renderer tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
