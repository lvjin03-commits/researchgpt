# Grant Platform Domain Contracts

These contracts define the minimum invariants shared by the future editor,
diagnostics, AI patching, evidence, revision, recheck, and export systems.

## Canonical Document

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
