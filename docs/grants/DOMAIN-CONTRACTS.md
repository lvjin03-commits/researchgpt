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

- `contractVersion = grant-semantic-diagnostic-v3` is the durable Diagnostic
  Run contract accepted by PostgreSQL.
- `schemaVersion = grant-semantic-diagnostic-v3` is the provider-output schema.
  In V3 these two versions intentionally advance together and share one
  authoritative constant.
- `promptVersion = grant-semantic-review-v3` versions model instructions only;
  it must never be persisted as the run contract.
- durable Finding content uses the separate
  `schemaVersion = grant-semantic-finding-v3`.
- `policyVersion = grant-ai-policy-v3.1` versions execution, deterministic
  normalization and retry policy.

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
not change decisions retain existing semantic versions. Provider-facing long
IDs remain the active V3 contract; replacing them with short references
requires measured failure evidence and an explicit schema/contract migration.

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
