# Grant Platform Domain Contracts

These contracts define the minimum invariants shared by the future editor,
diagnostics, AI patching, evidence, revision, recheck, and export systems.

## Canonical Document

Imported document structure is classified once at the DOCX import boundary.
After canonicalization, `parentSectionId` and sibling `order` are authoritative;
navigation and editor surfaces must not re-infer hierarchy from visible titles.

The platform structured document is the canonical working representation. All
components use the same document, section, and node identities. DOCX import and
export are adapters, not competing sources of truth.

Minimum entities:

```ts
type GrantDocument = {
  documentId: string;
  projectId: string;
  currentRevisionId: string;
  templateProfileId: string;
};

type GrantSection = {
  sectionId: string;
  semanticRole: string;
  title: string;
  parentSectionId?: string;
  order: number;
  nodeIds: string[];
};

type GrantNode = {
  nodeId: string;
  nodeType:
    | "heading"
    | "paragraph"
    | "list"
    | "table"
    | "figure"
    | "citation"
    | "formula";
  content: unknown;
  semanticRole?: string;
  sourceImportId?: string;
};
```

Programs own IDs, revisions, ordering, authorization, numbering, storage, and
rendering rules. AI may propose semantic text only within an authorized scope.

## Imported Figure Assets

An image embedded in an imported DOCX is not free text and is not an Evidence
Card. The DOCX Import Adapter extracts it once, preserves its source order and
OOXML relationship, and creates a program-owned asset record. The canonical
`figure` node continues to refer to the asset by `assetId`; no second document
or figure model is introduced.

The target contracts are implemented in
`lib/grants/domain/figure-assets.ts`:

```ts
type GrantImportedFigureAsset = {
  assetId: string;
  documentId: string;
  sourceDocumentChecksum: string;
  contentHash: string;
  mediaType: string;
  byteSize: number;
  widthPx: number | null;
  heightPx: number | null;
  storage: { bucket: string; path: string };
  anchor: {
    sourceOrdinal: number;
    relationshipId: string;
    partName: string;
    anchorKind: "inline" | "floating";
    sectionLocalKey: string | null;
    precedingBlockLocalKey: string | null;
    followingBlockLocalKey: string | null;
    caption: {
      text: string | null;
      source: "word_caption" | "adjacent_paragraph" | "none";
    };
  };
  createdAt: string;
};
```

Figure identity, checksum, source ordinal, relationship, caption source and
storage key are program data. The model may not create or overwrite them.
Caption detection is deterministic import metadata; later user edits to a
canonical caption still require the normal revision compare-and-swap path.

Image transmission to a model is independently authorized and denied by
default:

```ts
type GrantFigureModelAuthorization = {
  authorizationId: string;
  documentId: string;
  sourceRevisionId: string;
  authorizationRevision: number;
  allowedAssetIds: string[];
  permissions: {
    sendImageToModel: boolean;
    useForSemanticDiagnosis: boolean;
  };
  expiresAt: string | null;
  revokedAt: string | null;
  updatedBy: string;
  updatedAt: string;
};
```

`useForSemanticDiagnosis` requires `sendImageToModel`. Before every call, Grant
Model Data Gateway must query the current authorization, confirm the requested
asset belongs to the frozen source revision, and apply provider/data policy.
Queued work and cached multimodal context cannot outlive revocation, expiry or
a revision change. Providers receive an execution-local atomic location
reference and the authorized image payload; durable storage paths and canonical
UUID pairs are never provider-generated location data.

Workspace display is a read-only projection of the canonical figure node and
its matching immutable asset record. It may expose only an execution-limited
read URL, browser-safe media type and dimensions; durable bucket/path metadata
never enters the client projection. PNG, JPEG, GIF and WebP are displayable.
Unsupported formats retain their canonical position and caption with an
explicit fallback instead of being silently omitted.

Workspace ownership is not model authorization. Displaying an owner-scoped
asset does not change the default-deny model permissions, authorize semantic
diagnosis, alter the canonical Revision or create a second figure model.

## Revision and Concurrency

All formal writes use optimistic concurrency:

```text
expected base revision == current revision
  -> create immutable revision
  -> atomically advance current revision

otherwise
  -> revision_conflict
  -> no write and no silent merge
```

Patch Commit Service validates content. Revision Service atomically decides
whether the validated patch can become current. No API, UI component, checker,
or model adapter may bypass Revision Service.

Ordinary editor changes remain page-local drafts until the user explicitly
selects Save. Only that explicit action may submit the current snapshot through
Revision Service and create a new immutable revision. Diagnostics, AI Patch and
DOCX export operate on the latest committed revision, never on an unsaved page
draft. Leaving with unsaved changes must be disclosed to the user; the editor
must not silently persist them as canonical content.

Document deletion is a recoverable lifecycle transition owned by Revision
Service. It requires the caller's expected current revision and owner identity.
The canonical revisions and audit history are retained, while archived
documents are excluded from normal list and read projections. Hard purge of
content, evidence, objects and backups is a separate retention operation and
must not be inferred from the user-facing delete action.

## Patch Contract

Allowed operations are deterministic and hash-guarded:

```ts
type PatchOperation =
  | {
      type: "replace_text";
      nodeId: string;
      expectedTextHash: string;
      oldText: string;
      newText: string;
    }
  | {
      type: "insert_before" | "insert_after";
      anchorNodeId: string;
      newNodes: unknown[];
    }
  | {
      type: "delete_node";
      nodeId: string;
      expectedNodeHash: string;
    }
  | {
      type: "update_table_cell";
      nodeId: string;
      row: number;
      column: number;
      oldValueHash: string;
      newValue: string;
    };
```

Before commit, the program recomputes and verifies:

- target and anchor nodes are user-authorized;
- expected hashes still match;
- no operation touches system fields or out-of-scope nodes;
- preserved constraints remain unchanged;
- evidence authorization is current;
- actual impacts are derived from operations, not trusted from model output.

AI never writes canonical content directly. User acceptance authorizes a commit
attempt; it does not override deterministic checks or revision conflicts.

## Untrusted Input

Uploaded applications, literature, local files, extracted text, and model
output are untrusted inputs.

Model context must separate system policy, user instruction, authorized
constraints, untrusted document content, and evidence excerpts. Instructions
inside uploaded content are data and must not be executed.

Prompt wording is not a security boundary. Target-node, evidence, hash, and
revision checks are mandatory after generation.

## Findings

The platform does not assign high, medium, or low severity. It may record
orthogonal facts:

```ts
type FindingAssessment = {
  scope: "cross_section" | "section" | "paragraph" | "sentence" | "term_or_citation";
  confidence: number;
  actionability:
    | "directly_actionable"
    | "requires_evidence"
    | "requires_expert_judgment";
};
```

The default deterministic checker pack owns only reproducible observations:

- missing, placeholder, or objectively thin section content;
- literature-attribution sentences without a visible citation marker;
- highly repeated paragraph or list content;
- one acronym explicitly defined as different terms.

These checks do not decide scientific importance, novelty, feasibility, or
review severity. Every Finding must identify its source location where
possible, state the observable problem, and provide a concrete next action.
Semantic or disciplinary judgments remain user or expert decisions.

The user-facing `AI诊断` action may combine deterministic checkers with one
bounded semantic checker. The semantic checker may identify gaps in scientific
question clarity, argument chains, innovation articulation, objective-method
alignment, evidence support and cross-section consistency. It must not assign
severity, predict funding outcomes, invent evidence, or return IDs not supplied
by the program. A model failure is an incomplete diagnostic execution, not an
empty or successful semantic result.

### Semantic Diagnostic V3 Target Contract

V3 version ownership is explicit and must not be inferred from similar-looking
strings:

- `contractVersion = grant-semantic-diagnostic-v4` is the active durable Diagnostic
  Run contract accepted by PostgreSQL.
- `schemaVersion = grant-semantic-diagnostic-v4` is the provider-output schema.
  These two versions intentionally advance together and share one
  authoritative constant.
- `promptVersion = grant-semantic-review-v4` versions model instructions only;
  it must never be persisted as the run contract.
- durable Finding content uses the separate
  `schemaVersion = grant-semantic-finding-v3`.
- `policyVersion = grant-ai-policy-v3.2` versions execution, deterministic
  normalization and retry policy.

Provider-facing document locations use one atomic execution-local reference per
canonical node (`N1`, `N2`, ...). A reference is indivisible and maps to exactly
one program-owned `(sectionId, nodeId)` pair. The provider never emits or
combines canonical section/node IDs. Grant Model Data Gateway freezes the map
once per execution; retries reuse the same prepared input. Programs resolve the
reference before program validation and persistence, while durable Finding V3
locations remain canonical UUID pairs.

Unknown primary references discard only their Finding. Unknown related
references are removed; a `cross_section_inconsistency` Finding with no
surviving related location is discarded. Invalid Evidence Card references also
discard only their Finding. If a non-empty provider response leaves no usable
Finding, the semantic execution fails as `semantic_reference_invalid`.

Production code and PostgreSQL integration fixtures must obtain these values
from the same production constants/checker instance. Tests may assert literal
database expectations, but must not inject handwritten "correct" values in
place of the production object under test.

Version linkage is governed by the changed authority, not by convenience:

| Change | Versions that must advance |
| --- | --- |
| Provider output fields or meanings | `schemaVersion` and `contractVersion` |
| Durable Finding fields or meanings | Finding `schemaVersion` |
| Model instructions only | `promptVersion` |
| Retry, capacity, normalization or failure classification | `policyVersion` |
| Checker logic that changes reported Findings | `checkerVersion` |

More than one row may apply to one change. Observability-only additions that do
not change decisions retain existing semantic versions. Migration 046 provides
the bounded V3/V4 rollback window through the existing save RPC. V3 acceptance
is compatibility only and may be removed after the observation period recorded
in Impact Analysis 0016.

Validation telemetry must never persist application prose. It may retain the
issue path, Zod code, a whitelisted rule, field class, expected/received value
types and numeric bounds. It must not retain received values or free-form Zod
messages for content fields.

Diagnostic execution has one explicit aggregate status:

- `complete`: every configured checker succeeded;
- `partial`: at least one checker succeeded and at least one did not;
- `failed`: no configured checker succeeded.

Before any execution exists, the read projection uses `null`; it must not label
an unstarted diagnostic as failed.

The diagnostics POST endpoint returns HTTP `201`, `207`, or `502` respectively.
A partial response must never be represented as a complete AI diagnosis.

The following contract is accepted for the next semantic-checker version but is
not the active production schema until its staged rollout is verified:

```ts
type GrantSemanticFindingContentV3 = {
  category:
    | "scientific_question_gap"
    | "argument_chain_gap"
    | "innovation_gap"
    | "feasibility_support_gap"
    | "objective_content_route_gap"
    | "research_design_gap"
    | "evidence_support_gap"
    | "cross_section_inconsistency";
  title: string;
  diagnosticFact: string;
  reason: string;
  recommendation: string;
  possibleConsequence: string | null;
  assessment: FindingAssessment;
  primaryLocation: {
    sectionId: string;
    nodeId: string;
  };
  relatedLocations: Array<{
    sectionId: string;
    nodeId: string;
    role:
      | "supporting_location"
      | "conflicting_location"
      | "upstream_dependency"
      | "downstream_dependency"
      | "comparison_location"
      | "missing_expected_location";
    quote: string | null;
  }>;
  usedEvidenceCardIds: string[];
};
```

This is diagnostic content, not a replacement for the durable Finding
envelope. `findingId`, run/document/revision identity, checker and contract
versions, fingerprint, lifecycle status and timestamps remain program-owned.
The model never creates or changes them.

The provider-facing strict schema has no optional properties.
`possibleConsequence` is required and nullable. `relatedLocations` and
`usedEvidenceCardIds` are required arrays and use `[]` when empty.

Category ownership is fixed:

- `scientific_question_gap` concerns whether the question itself identifies a
  bounded object, relationship, hypothesis or testable criterion. A clear
  question that is not connected to later work belongs elsewhere.
- `argument_chain_gap` concerns a missing inference between background,
  knowledge gap, scientific question, hypothesis or expected contribution.
- `feasibility_support_gap` concerns the applicant's own preparation, people,
  facilities, methods and schedule.
- `evidence_support_gap` concerns support for a scientific assertion, mechanism,
  causal claim or novelty statement.
- `objective_content_route_gap` covers objective-to-content and
  content-to-technical-route correspondence.

Positive and negative category examples are required prompt fixtures and
contract tests before activation. Missing information about the same semantic
subject in one section is merged into one Finding rather than emitted as a list
of low-value omissions.

Evidence use is bounded. A `verified` Evidence Card may support only claims
inside its declared supported scope. A `metadata_only` card establishes only
that a source record exists and cannot support its methods, results or
conclusions. Every returned Evidence Card ID must have been supplied and remain
currently authorized.

Stable V3 identity is derived by Diagnostic Assembler from checker/version,
category, primary node, normalized related locations and normalized diagnostic
fact. Recommendation wording and possible consequence are excluded so wording
variation does not create a new issue.

`actionability` is workflow metadata, not severity or priority. It may be used
for explicit filtering or grouping. Default UI order remains canonical section
order, source-node order and occurrence order; it must not sort by
actionability, confidence or model return order.

V2 findings remain immutable audit data. Deployment does not automatically
rerun them. After a successful user-requested V3 run covers a scope, V3 becomes
the active projection for that scope and corresponding V2 findings are marked
superseded. Repository/projection code exposes one normalized view; UI code
must not become a second V2/V3 interpretation authority.

All Grant semantic diagnosis and AI Patch calls use the same server-owned GPT
configuration and enter through Grant Model Data Gateway. Downstream modules
may select an operation and its reasoning effort, but may not select a provider
or silently fall back to another model.

Semantic diagnostic output uses a versioned strict structured-output contract.
Its single execution policy owns a maximum of two provider attempts and keeps
truncation, filtering, refusal, schema invalidity, out-of-scope references and
provider failures as separate outcomes. Only explicitly recoverable outcomes
may consume the second attempt. Failed-run telemetry is content-free and must
not copy application text or raw model responses into diagnostic projections.

Lifecycle, user disposition, and recheck outcome are separate:

```ts
type FindingLifecycleStatus = "open" | "closed" | "superseded";
type UserDisposition =
  | "none"
  | "prioritized"
  | "deferred"
  | "ignored"
  | "reported_false_positive";
type RecheckStatus =
  | "not_rechecked"
  | "resolved"
  | "partially_resolved"
  | "still_present"
  | "unable_to_match"
  | "new_related_issue"
  | "human_review_required";
```

The user-facing convergence projection is derived separately from immutable
checker outcomes:

```ts
type RecheckConvergence =
  | "not_run"
  | "resolved"
  | "stable"
  | "improving"
  | "regressed"
  | "changed";
```

`stable`, `improving` and `regressed` compare stable checker subject keys across
durable executions. They are workflow guidance, not severity or expert review
judgments.

A user report does not convert a Finding into a confirmed false positive.
Checker disagreements are separate `DiagnosticConflict` records and are never
silently resolved by selecting the higher-confidence output.

### Hierarchical Semantic Diagnostic Target Contract

The next semantic-checker contract may perform two internal model operations
behind the existing `AI诊断` action and semantic-checker authority:

```text
canonical revision + current authorized evidence
  -> descriptive ArgumentMap
  -> root diagnosis with one or more canonical occurrences
  -> existing Diagnostic Assembler and normalized projection
```

ArgumentMap is revision-bound diagnostic scaffolding, not a second document
model and not cross-run identity. Its fixed roles cover research context,
domain bottleneck, knowledge gap, scientific question, central hypothesis,
objectives, content, technical route, feasibility basis, innovation claim and
expected contribution. Step A may state whether a role is explicit, implicit or
missing and identify the source locations and relations stated by the
application. It must not diagnose quality, recommend changes, assign severity,
prioritize or predict funding outcomes. The user-facing structure overview is a
program projection that combines this description with Step B Findings.

Provider-facing locations remain execution-local atomic references. Programs
resolve them to canonical `(sectionId, nodeId)` pairs before program validation,
assembly or persistence. ArgumentMap ordering, role-instance numbering,
statements and location references do not participate in recheck continuity.
The existing atomic-location input builder is the only owner of this mapping.
Argument mapping and root diagnosis receive views derived from one prepared
input and one revision-scoped location fingerprint; neither stage may rebuild
aliases, canonical pairs or evidence authorization independently.

Occurrence continuity is owned by Diagnostic Assembler and is derived from:

```text
checker identity/version
+ category
+ canonical primary node
+ normalized canonical related nodes and roles
```

Root continuity is derived from:

```text
checker identity/version
+ category
+ affected ArgumentMap roles
+ stable occurrence fingerprints
```

Recommendation wording, possible consequence, diagnostic wording, provider
return order and execution-local references are excluded. When a node changes
between revisions, the existing source-anchor relocation policy resolves the
canonical occurrence before continuity is evaluated.

The accepted target versions are `grant-argument-map-v1`, provider/run contract
`grant-semantic-diagnostic-v5`, prompt `grant-semantic-review-v5.1`, durable root
Finding content `grant-semantic-finding-v4`, policy `grant-ai-policy-v4` and
checker `5.1.0`. The provider schema remains stable; the prompt/checker advance
records authorized-image interpretation and its coverage behavior. Active V4 production
selection remains available outside the existing hierarchical rollout cohort;
the same runtime owner and database contract are reused in both cases.

Stage states for argument mapping, root diagnosis and assembly explain progress,
failure, skip and stale-revision outcomes. They do not replace the existing
aggregate `complete | partial | failed` diagnostic status.

### Semantic Review V6 Dual-node Target Contract

The next diagnostic-quality phase distinguishes deterministic physical document
nodes from model-recognized semantic objects. This is an identity boundary, not
a second document model.

Physical diagnostic anchors are read-only projections of the existing canonical
`GrantNode.nodeId`, section, order and revision. Sections, headings, paragraphs,
lists, tables, figures, citations and formulas retain their existing program-
owned identity. No diagnostic component may mint another canonical node ID.

Scientific questions, innovation claims, objectives, research content,
technical routes, mechanism claims, expected metrics, preliminary evidence and
expected contributions are semantic objects. Their boundaries require model
interpretation and may vary between runs. They therefore use an execution-local
`semanticObjectRef` plus bounded ranges anchored to canonical nodes. They are
revision-bound scaffolding and never canonical document identity.

Cross-run semantic calibration excludes `semanticObjectRef`, model summaries
and free prose. Diagnostic Assembler will later compare semantic object type,
normalized facet, canonical physical-node overlap and anchored-text similarity.
Its match state is `same | likely_same | ambiguous | different`; `ambiguous`
must not be silently converted to either continuity or a new issue.

The target-only contracts are implemented in
`lib/grants/diagnostics/semantic-review-v6-contracts.ts`. They reserve provider
contract/schema `grant-semantic-diagnostic-v6`, semantic object
`grant-semantic-object-v1`, scientific Finding `grant-scientific-finding-v1`,
narrative Finding `grant-narrative-finding-v1`, prompt
`grant-semantic-review-v6`, policy `grant-ai-policy-v5` and checker `6.0.0`.
These values are not active production selection. Semantic V5 runtime,
persistence, canary admission and user-visible behavior remain unchanged in
this contract-only step.

#### Fact Map coverage target

Every semantic object in one frozen review run must receive exactly one
machine-checkable disposition:

```text
residual_gap_found
verified_no_residual_gap
unable_to_verify
```

`residual_gap_found` must bind at least one valid execution-local Finding
reference. `verified_no_residual_gap` and `unable_to_verify` must bind none;
the latter also requires a bounded reason such as unavailable authorization or
insufficient document content. A candidate that was fully covered is therefore
discarded explicitly rather than becoming a weak Finding, while an object that
could not be checked is never misreported as resolved.

Fact Map Coverage Assembler validates that the provider covers every frozen
semantic object exactly once, preserves the object type, references only the
current run's Finding set and leaves no orphan Finding. It derives completeness
from those sets, never from `residualGap` or other model prose. Coverage remains
revision-bound scaffolding and does not replace durable Finding continuity.

The target-only schema is `grant-fact-map-coverage-v1` in
`semantic-review-v6-contracts.ts`. It is not an active provider output,
persistence or UI contract in this step.

#### Frozen V6 input and descriptive Fact Map

Semantic Review V6 adapts the already-authorized hierarchical prepared input;
it does not parse the canonical document, query Evidence authorization or build
`N*` aliases again. One input fingerprint binds source revision, location-scope
fingerprint, admitted text, Evidence Cards and prior-Finding references.

Fact Map provider output contains semantic object type, a normalized facet and
one or more supplied atomic `N*` locations. It contains no canonical IDs, `S*`
identity, Findings, diagnostic conclusion, severity, recommendation or review
outcome. Fact Map Assembler validates every `N*`, assigns `S1...Sn`, resolves
canonical section/node IDs and derives full-node anchor offsets and hashes from
the frozen node text. The mature target is `grant-fact-map-v1`; it remains
revision- and location-scope-bound scaffolding, not durable identity.

#### Scientific and narrative Finding targets

Semantic Review V6 has two content families, not one permissive Finding object.

Scientific Findings retain the established scientific categories and contain:

```text
semantic objects reviewed
observable diagnostic fact
existing design with source location and evidence tier
residual gap after deducting that design
why the existing design remains insufficient
bounded recommendation and optional reviewer question
canonical locations and authorized Evidence Card provenance
```

Evidence tiers are `description_only`, `performance_improvement`,
`structural_evidence`, `mechanistic_evidence`, or `causal_evidence`. They prevent
performance improvement from being silently presented as mechanism or causal
proof. A Scientific Finding may cite at most four existing-design locations in
the mature program contract; later capacity policy must prevent oversized
provider output before assembly.

Narrative Findings use a separate category set:

```text
narrative_flow
emphasis_balance
opening_persuasion
abstract_independent_readability
language_register
visual_communication
```

They contain observed presentation, reader friction and a suggested
organization. They do not contain `existingDesign`, `residualGap` or scientific
evidence-tier fields. Visual communication requires at least one resolved,
currently authorized figure asset; other narrative categories cannot claim
figure use.

Neither family contains severity, priority or a funding prediction. Execution-
local Finding references are unique across both families, but never become
durable identity. The target schemas are `grant-scientific-finding-v1` and
`grant-narrative-finding-v1`; they are not active provider, persistence or UI
contracts in this step.

#### Scientific Review V6 execution

Scientific Review consumes the frozen document/evidence base and mature Fact
Map. One strict response contains candidate Scientific Findings and coverage
dispositions for all Fact Map objects. A fully covered object produces
`verified_no_residual_gap` and no Finding; review uncertainty produces
`unable_to_verify`, not a fabricated problem.

The model may choose only supplied `S*`, `N*` and Evidence Card aliases. The
program resolves canonical locations, rejects invalid primary or existing-
design references, drops only invalid related locations and enforces current
evidence scope. `authorized_evidence` requires a `verified` card within its
supported scope; `metadata_only` establishes record existence only. The
coverage assembler then checks the complete semantic-object and successfully
assembled Finding sets. The OpenAI adapter performs one attempt and receives a
completion budget from its future aggregate owner; it owns no retry policy.

#### Narrative Review V6 execution

Narrative Review consumes the same frozen revision, document ordering and `N*`
location scope as the other V6 stages. It reports only presentation friction:
flow, emphasis, opening persuasion, abstract independent readability, language
register and visual communication. It does not judge scientific novelty,
correctness, feasibility or evidence sufficiency and does not consume
Scientific Findings as a second source of truth.

Application images enter only through the existing current-authorization image
admission. Text-only coverage forbids `visual_communication`. In multimodal
coverage, the model may select only actually supplied `I*` aliases; the
Narrative Review Assembler resolves them to program-owned figure asset IDs.
Invalid primary or image aliases reject the candidate result, while invalid
related locations are deterministically removed. The adapter performs one
provider attempt with a caller-supplied completion budget and owns no retry.

## Checker Versioning

Every run records checker, checker version, prompt/contract version, input mode,
input block IDs, input hash, raw response reference, parsed output, and status.

Checker changes are classified as:

- implementation-only: historical Findings remain current;
- backward-compatible rule improvement: open Findings may be rechecked;
- semantic or contract change: affected Findings become stale/superseded and a
  new run is required.

The absence of a Finding from a newer run never proves the old issue was fixed.

## Evidence Authorization

Permissions are independent:

```ts
type EvidenceAuthorization = {
  authorizationId: string;
  sourceId: string;
  permissions: {
    read: boolean;
    index: boolean;
    sendRelevantExcerptToModel: boolean;
    useForReasoning: boolean;
    useForCitation: boolean;
  };
  allowedTaskIds?: string[];
  expiresAt?: string;
  revokedAt?: string;
};
```

Every model call must query current authorization, data sensitivity, and
provider policy through the Grant Model Data Gateway. Cached authorization is
never authoritative.

Revocation invalidates queued model work, cached contexts, and unaccepted
patches that depend on the source. Accepted revisions retain audit provenance,
but revoked content must not be sent in future model calls.

## Model Data Policy

Data sensitivity is explicit:

```text
public
project_confidential
unpublished_research
highly_sensitive
```

Provider admission records allowed sensitivity, verified training policy,
retention policy, processing region knowledge, and deletion support. A provider
that does not satisfy policy cannot receive the material; the system must use a
permitted deterministic/local capability or ask the user to choose an eligible
provider.

Deletion policy must cover original files, extracted text, chunks, vectors,
model-context caches, temporary render files, identifiable logs, and documented
backup deletion delay.

## Audit

The durable chain is:

```text
Finding -> Patch Proposal -> User Instructions -> Acceptance/Rejection
        -> Section Revision -> Recheck
```

Audit records identify actor, time, action, source revision, target revision,
evidence IDs, authorization revision, patch ID, and recheck result. AI output,
user instruction, and committed text must remain distinguishable.

## Recheck and Convergence

Recheck runs the applicable owning checker against the new semantic subject; it
does not infer resolution from text disappearance alone.

Automatic assistance stops when:

- two consecutive attempts do not reduce the core gap;
- the same Finding fingerprints cycle A -> B -> A;
- suggestions materially repeat;
- required facts or evidence are absent;
- the proposed change alters the core hypothesis, research object, or scope.

Default cost limits may apply, but a user may explicitly open a new, audited
resolution session.

## Hierarchical Diagnostic Persistence

Hierarchical durable Findings remain attached to the existing `grant_findings`
envelope. One root Finding may own multiple canonical occurrences. Each
occurrence fingerprint is derived only from checker identity, category and
canonical node/role relationships; the root fingerprint is derived from sorted
occurrence fingerprints and affected argument roles. Model wording,
recommendations, ArgumentMap aliases and provider order never participate in
continuity identity.

A successful ArgumentMap may be stored as a recovery checkpoint only when it is
bound to document, source revision, checker version, input fingerprint and
location-scope fingerprint. Successful root-diagnosis persistence consumes the
checkpoint in the same repository transaction. Checkpoints never become
Findings and never cross a revision or scope mismatch.

## Hierarchical Diagnostic Rollout

The hierarchical checker replaces the internals of the existing semantic
checker only after two independent server-side gates succeed:

```text
GRANT_HIERARCHICAL_DIAGNOSTIC_MODE = canary | on
GRANT_HIERARCHICAL_DIAGNOSTIC_DATABASE_SCHEMA = 047
```

`canary` additionally requires the authenticated owner ID in
`GRANT_HIERARCHICAL_DIAGNOSTIC_CANARY_OWNER_IDS`. Invalid configuration fails
closed to the existing semantic implementation. Selection is server-only and
stable by owner; a request or browser cannot override it. Setting mode `off`
is the immediate rollback and preserves canonical content, checkpoints and
historical Findings.
