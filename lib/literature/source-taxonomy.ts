export type LiteratureDisciplineId =
  | "ai"
  | "biology"
  | "medicine"
  | "computer-science"
  | "robotics"
  | "materials"
  | "chemistry"
  | "physics"
  | "mathematics"
  | "energy"
  | "environment"
  | "agriculture"
  | "economics"
  | "finance"
  | "management"
  | "law"
  | "education"
  | "psychology"
  | "social-sciences"
  | "humanities"
  | "earth-sciences"
  | "astronomy"
  | "patents"
  | "funding"
  | "industry";

export type LiteratureSourceKind =
  | "database"
  | "journal"
  | "conference"
  | "code"
  | "platform"
  | "funding"
  | "industry";

export type LiteratureSourceStatus = "available" | "coming_soon";

export type LiteratureSourceProvider =
  | "arxiv"
  | "pubmed"
  | "semantic_scholar"
  | "openreview"
  | "openalex"
  | "europe_pmc"
  | "ieee_xplore"
  | "dblp"
  | "inspire_hep"
  | "nasa_ads"
  | "ssrn"
  | "jstor";

export type TaxonomySource = {
  id: string;
  name: string;
  kind: LiteratureSourceKind;
  status: LiteratureSourceStatus;
  provider?: LiteratureSourceProvider;
};

export type DisciplineDefinition = {
  id: LiteratureDisciplineId;
  label: string;
  sources: TaxonomySource[];
};

export const AVAILABLE_LITERATURE_SOURCE_IDS = ["arxiv"] as const;

export type AvailableLiteratureSourceId =
  (typeof AVAILABLE_LITERATURE_SOURCE_IDS)[number];

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function item(
  name: string,
  kind: LiteratureSourceKind,
  options?: {
    status?: LiteratureSourceStatus;
    provider?: LiteratureSourceProvider;
    id?: string;
  },
): TaxonomySource {
  const source: TaxonomySource = {
    id: options?.id ?? slug(name),
    name,
    kind,
    status: options?.status ?? "coming_soon",
  };

  if (options?.provider) {
    source.provider = options.provider;
  }

  return source;
}

function arxiv(): TaxonomySource {
  return {
    id: "arxiv",
    name: "arXiv",
    kind: "platform",
    status: "available",
    provider: "arxiv",
  };
}

function conference(name: string): TaxonomySource {
  return item(name, "conference");
}

function journal(name: string): TaxonomySource {
  return item(name, "journal");
}

function database(name: string): TaxonomySource {
  return item(name, "database");
}

function platform(
  name: string,
  provider?: LiteratureSourceProvider,
): TaxonomySource {
  return item(name, "platform", { provider });
}

function code(name: string): TaxonomySource {
  return item(name, "code");
}

function funding(name: string): TaxonomySource {
  return item(name, "funding");
}

function industry(name: string): TaxonomySource {
  return item(name, "industry");
}

export const LITERATURE_DISCIPLINES: DisciplineDefinition[] = [
  {
    id: "ai",
    label: "AI",
    sources: [
      arxiv(),
      platform("OpenReview", "openreview"),
      platform("Semantic Scholar", "semantic_scholar"),
      platform("Papers with Code"),
      code("GitHub"),
      code("Hugging Face"),
      conference("NeurIPS"),
      conference("ICML"),
      conference("ICLR"),
      conference("CVPR"),
      conference("ICCV"),
      conference("ECCV"),
      conference("ACL"),
      conference("EMNLP"),
      conference("KDD"),
    ],
  },
  {
    id: "biology",
    label: "Biology",
    sources: [
      platform("PubMed", "pubmed"),
      platform("Europe PMC", "europe_pmc"),
      platform("OpenAlex", "openalex"),
      platform("Web of Science"),
      platform("Scopus"),
      database("NCBI"),
      database("UniProt"),
      database("KEGG"),
      database("PDB"),
      database("BRENDA"),
      database("Ensembl"),
      database("GEO"),
      database("SRA"),
      database("AlphaFold DB"),
      journal("Nature Biotechnology"),
      journal("Cell"),
      journal("Nature Medicine"),
      journal("Nature Microbiology"),
      journal("Molecular Cell"),
      journal("Cell Systems"),
      conference("ISMB"),
      conference("ASM"),
      conference("SynBioBeta"),
    ],
  },
  {
    id: "medicine",
    label: "Medicine",
    sources: [
      platform("PubMed", "pubmed"),
      platform("ClinicalTrials.gov"),
      platform("Cochrane Library"),
      platform("Embase"),
      platform("Europe PMC", "europe_pmc"),
      database("FDA"),
      database("WHO"),
      database("CDC"),
      journal("NEJM"),
      journal("The Lancet"),
      journal("JAMA"),
      journal("BMJ"),
      journal("Nature Medicine"),
    ],
  },
  {
    id: "computer-science",
    label: "Computer Science",
    sources: [
      platform("ACM Digital Library"),
      platform("IEEE Xplore", "ieee_xplore"),
      platform("DBLP", "dblp"),
      conference("SIGGRAPH"),
      conference("OSDI"),
      conference("SOSP"),
      conference("PLDI"),
      conference("USENIX"),
      conference("NSDI"),
    ],
  },
  {
    id: "robotics",
    label: "Robotics",
    sources: [
      platform("IEEE Xplore", "ieee_xplore"),
      arxiv(),
      conference("ICRA"),
      conference("IROS"),
      conference("RSS"),
      conference("CoRL"),
    ],
  },
  {
    id: "materials",
    label: "Materials",
    sources: [
      database("Materials Project"),
      database("OQMD"),
      database("AFLOW"),
      database("Springer Materials"),
      journal("Advanced Materials"),
      journal("Nature Materials"),
      journal("Nano Letters"),
    ],
  },
  {
    id: "chemistry",
    label: "Chemistry",
    sources: [
      database("SciFinder"),
      database("Reaxys"),
      database("PubChem"),
      database("ChemSpider"),
      journal("JACS"),
      journal("Angewandte Chemie"),
      journal("Nature Chemistry"),
    ],
  },
  {
    id: "physics",
    label: "Physics",
    sources: [
      platform("INSPIRE-HEP", "inspire_hep"),
      arxiv(),
      journal("Physical Review"),
      journal("Nature Physics"),
    ],
  },
  {
    id: "mathematics",
    label: "Mathematics",
    sources: [
      platform("MathSciNet"),
      platform("zbMATH"),
      arxiv(),
    ],
  },
  {
    id: "energy",
    label: "Energy",
    sources: [
      platform("DOE OSTI"),
      journal("Joule"),
      journal("Energy & Environmental Science"),
      journal("Nature Energy"),
    ],
  },
  {
    id: "environment",
    label: "Environment",
    sources: [
      database("EPA"),
      database("UNEP"),
      journal("Nature Sustainability"),
      journal("Environmental Science & Technology"),
    ],
  },
  {
    id: "agriculture",
    label: "Agriculture",
    sources: [
      database("AGRICOLA"),
      database("FAOSTAT"),
      journal("Plant Cell"),
      journal("Nature Plants"),
    ],
  },
  {
    id: "economics",
    label: "Economics",
    sources: [
      platform("RePEc"),
      platform("IDEAS"),
      platform("NBER"),
      journal("AER"),
      journal("Econometrica"),
    ],
  },
  {
    id: "finance",
    label: "Finance",
    sources: [
      platform("SSRN", "ssrn"),
      platform("WRDS"),
      journal("Journal of Finance"),
      journal("Review of Financial Studies"),
    ],
  },
  {
    id: "management",
    label: "Management",
    sources: [
      platform("ABI/INFORM"),
      platform("Business Source"),
      journal("Academy of Management Journal"),
      journal("Strategic Management Journal"),
    ],
  },
  {
    id: "law",
    label: "Law",
    sources: [
      platform("HeinOnline"),
      platform("Westlaw"),
      platform("LexisNexis"),
    ],
  },
  {
    id: "education",
    label: "Education",
    sources: [platform("ERIC")],
  },
  {
    id: "psychology",
    label: "Psychology",
    sources: [
      platform("PsycINFO"),
      journal("Psychological Science"),
      journal("Nature Human Behaviour"),
    ],
  },
  {
    id: "social-sciences",
    label: "Social Sciences",
    sources: [
      platform("JSTOR", "jstor"),
      platform("SSRN", "ssrn"),
      platform("ICPSR"),
    ],
  },
  {
    id: "humanities",
    label: "Humanities",
    sources: [
      platform("JSTOR", "jstor"),
      platform("Project MUSE"),
    ],
  },
  {
    id: "earth-sciences",
    label: "Earth Sciences",
    sources: [database("USGS"), database("OneGeology")],
  },
  {
    id: "astronomy",
    label: "Astronomy",
    sources: [platform("NASA ADS", "nasa_ads")],
  },
  {
    id: "patents",
    label: "Patents",
    sources: [
      platform("Google Patents"),
      platform("WIPO"),
      platform("USPTO"),
      platform("Espacenet"),
      platform("Lens"),
    ],
  },
  {
    id: "funding",
    label: "Funding",
    sources: [
      funding("NIH"),
      funding("NSF"),
      funding("ERC"),
      funding("UKRI"),
      funding("国家自然科学基金委"),
    ],
  },
  {
    id: "industry",
    label: "Industry",
    sources: [
      industry("Crunchbase"),
      industry("PitchBook"),
      industry("CB Insights"),
    ],
  },
];

const disciplineById = new Map(
  LITERATURE_DISCIPLINES.map((discipline) => [discipline.id, discipline]),
);

const sourceById = new Map<string, TaxonomySource>();

for (const discipline of LITERATURE_DISCIPLINES) {
  for (const item of discipline.sources) {
    if (!sourceById.has(item.id)) {
      sourceById.set(item.id, item);
    }
  }
}

export function getDiscipline(
  disciplineId: string,
): DisciplineDefinition | undefined {
  return disciplineById.get(disciplineId as LiteratureDisciplineId);
}

export function isValidDisciplineId(
  disciplineId: string,
): disciplineId is LiteratureDisciplineId {
  return disciplineById.has(disciplineId as LiteratureDisciplineId);
}

export function isKnownSourceId(sourceId: string): boolean {
  return sourceById.has(sourceId);
}

export function isSourceAvailable(
  sourceId: string,
): sourceId is AvailableLiteratureSourceId {
  const source = sourceById.get(sourceId);
  return source?.status === "available";
}

/** @deprecated Use isSourceAvailable */
export function isSourceEnabled(sourceId: string): sourceId is AvailableLiteratureSourceId {
  return isSourceAvailable(sourceId);
}

export function getSourceName(sourceId: string): string {
  return sourceById.get(sourceId)?.name ?? sourceId;
}

/** @deprecated Use getSourceName */
export function getSourceLabel(sourceId: string): string {
  return getSourceName(sourceId);
}

export function getDisciplineSources(
  disciplineId: LiteratureDisciplineId,
): TaxonomySource[] {
  return getDiscipline(disciplineId)?.sources ?? [];
}

export function getAvailableSourcesForDiscipline(
  disciplineId: LiteratureDisciplineId,
): TaxonomySource[] {
  return getDisciplineSources(disciplineId).filter(
    (source) => source.status === "available",
  );
}

/** @deprecated Use getAvailableSourcesForDiscipline */
export function getEnabledSourcesForDiscipline(
  disciplineId: LiteratureDisciplineId,
): TaxonomySource[] {
  return getAvailableSourcesForDiscipline(disciplineId);
}

export function getDefaultSelectedSources(
  disciplineId: LiteratureDisciplineId,
): string[] {
  return getAvailableSourcesForDiscipline(disciplineId).map((source) => source.id);
}

export const DEFAULT_LITERATURE_DISCIPLINE: LiteratureDisciplineId = "ai";

export function normalizeSelectedSources(
  disciplineId: LiteratureDisciplineId,
  selectedSources: string[],
): string[] {
  const disciplineSourceIdSet = new Set(
    getDisciplineSources(disciplineId).map((source) => source.id),
  );

  const normalized = selectedSources.filter(
    (sourceId) => disciplineSourceIdSet.has(sourceId) && isSourceAvailable(sourceId),
  );

  return [...new Set(normalized)];
}
