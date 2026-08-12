# Grant Platform Architecture

This document is the authoritative architecture baseline for the NSFC grant
collaboration platform. It defines ownership and dependency direction before
feature implementation begins.

## Status

- Governance baseline: active.
- Product code: PR1 through PR6 are implemented and verified in production.
  PR7 evidence-backed AI Patch is implemented behind its own capability flag;
  migration 041 is applied and its guarded-acceptance RPC is remotely probed.
- Feature exposure: workspace, evidence-free AI Patch and local evidence are
  enabled in production. PR7 production rollout is authorized; signed-in
  user-path verification remains required after deployment.
- Existing chat and Document V2 behavior: out of scope and must remain unchanged.

## Product Boundary

The grant platform is a bounded context for continuously editing, diagnosing,
and revising a grant application with explicit human approval.

It is not:

- a chat-export compatibility path;
- a Document V2 generation job;
- a one-click grant generator;
- an automatic submission client;
- an unrestricted local-file crawler;
- an authority for inventing evidence, references, results, or project history.

The intended source relationship is:

```text
Canonical structured grant document
  -> editor, diagnostics, patching, revision, recheck
  -> DOCX export adapter

DOCX
  -> import representation
  -> delivery representation
```

Arbitrary DOCX round-trip fidelity is not assumed. Each import must eventually
produce an explicit fidelity report.

## Bounded Context and Dependencies

Planned locations:

```text
app/grants/                 product routes
app/api/grants/             authenticated HTTP boundary
components/grants/          presentation only
lib/grants/domain/          entities and invariants
lib/grants/application/     use cases
lib/grants/ports/           external capability interfaces
lib/grants/infrastructure/  repositories and provider adapters
lib/grants/revisions/       revision and concurrency policy
lib/grants/diagnostics/     checker execution and Finding assembly
lib/grants/patching/        patch validation and commit
lib/grants/evidence/        evidence cards and authorization
lib/grants/templates/       template profiles and length policy
lib/grants/export/          export port and adapters
```

Allowed dependency direction:

```text
UI / API -> Application -> Domain / Ports <- Infrastructure
```

Forbidden dependencies:

- Grant code must not import `app/api/chat/route.ts`.
- Grant code must not import Document V2 orchestration, production workers, or
  runtime repositories.
- Domain code must not import Next.js, React, database clients, model clients,
  file storage, or infrastructure.
- UI and API routes must not write grant database tables directly.
- Checkers must not persist state directly.
- Renderers must not call models, reinterpret intent, or generate missing text.
- No grant module may instantiate a model provider outside the grant model-data
  gateway adapter.

Shared authentication, object storage, parsers, model execution, literature
verification, and DOCX rendering may be reused only behind explicit ports.

## Decision Owners

| Decision | Authoritative owner | Rule |
|---|---|---|
| Canonical document and nodes | Grant Document Repository | No other module writes canonical content |
| Current revision | Revision Service | Compare-and-swap is mandatory |
| Concurrency arbitration | Revision Service | Stale writes fail; no silent merge |
| Patch semantic scope | Patch Policy | AI declarations are not trusted |
| Patch deterministic validity | Patch Commit Service | Recomputes affected nodes and hashes |
| Finding conclusion | Owning Checker | Assembler may normalize, not reinterpret |
| Semantic Finding content | Versioned Semantic Checker Contract | Model returns semantic content only; supplied IDs and evidence references are validated |
| Scientific Finding content | Versioned Semantic Checker Contract | Accounts for existing design and evidence tier before reporting a residual scientific gap |
| Scientific Finding reference/evidence assembly | Scientific Review Assembler | Resolves frozen aliases and current Evidence Card scope; never changes the scientific conclusion |
| Narrative Finding content | Versioned Semantic Checker Contract | Describes presentation friction and bounded organization advice; never masquerades as scientific evidence judgment |
| Finding identity and conflicts | Diagnostic Assembler | Conflicts are retained explicitly |
| ArgumentMap interpretation | Versioned Semantic Checker Contract | Descriptive, revision-bound scaffold only; never durable identity |
| Semantic object recognition | Versioned Semantic Checker Contract | Revision-bound interpretation only; never creates canonical document nodes |
| Frozen semantic-review input | Grant Model Data Gateway | Reuses one admitted revision, evidence set, figure set and atomic-location scope; no checker rebuilds aliases |
| Fact Map identity and anchor assembly | Fact Map Assembler | Assigns execution-local semantic refs and resolves canonical anchors/hashes; model never mints IDs |
| Semantic-object review disposition | Versioned Semantic Checker Contract | Explicit residual-gap, verified-no-gap, or unable-to-verify judgment; no severity |
| Fact Map coverage completeness | Fact Map Coverage Assembler | Validates the frozen semantic-object and Finding sets; never infers completeness from prose |
| Semantic object cross-run calibration | Diagnostic Assembler | Uses canonical physical anchors and calibrated similarity; never trusts execution-local semantic references |
| Finding occurrence/root continuity | Diagnostic Assembler | Uses canonical nodes and anchors; never ArgumentMap numbering or model prose |
| User disposition | Feedback Service | Does not rewrite system conclusions |
| Evidence read/use/citation permission | Evidence Authorization Service | Current authorization is authoritative |
| Imported figure extraction and source anchoring | Grant DOCX Import Adapter | Extracts once from OOXML; downstream code cannot infer image order or captions |
| Imported figure asset identity and storage metadata | Grant Figure Asset Repository | IDs, hashes, object paths and source anchors are program-owned |
| Model use of imported figures | Grant Figure Model Authorization Service | Default deny; current revision-bound authorization is authoritative |
| Model access to sensitive data | Grant Model Data Gateway | Must enforce provider policy per call |
| Citation mapping | Citation Assembler | Model cannot create internal IDs or numbering |
| Template and length rules | Grant Template Profile | One frozen version per revision/export |
| Recheck scope | Impact Analyzer | Derived from actual committed operations |
| Diagnostic default ordering | Canonical Grant Document order | UI may filter/group, but must not infer severity or priority from actionability |
| DOCX typography and pagination | Export Renderer | Formats approved content only |

When Patch Commit Service and Revision Service disagree, Revision Service owns
the final write decision. Patch validation success never overrides a stale base
revision.

## No Parallel Authority

A new route, document model, revision mechanism, patch application path,
authorization check, citation numbering system, model gateway, or DOCX export
path is forbidden unless it replaces an existing owner or includes a documented
migration and deletion condition.

Compatibility code must identify:

- the old and new owner;
- traffic scope;
- removal condition;
- expiry date;
- rollback path.

## Delivery Gates

Every grant change must pass:

1. Contract tests for the changed domain rule.
2. Automated architecture-boundary checks.
3. Regression checks for chat, Document V2, uploads, literature, and auth when
   shared infrastructure changes.
4. Effect-first verification through the actual user path.
5. Feature-flag and rollback verification before exposure.

Passing TypeScript or build alone is not user-path verification.

## Change Governance

Changes that move authority, modify core models, add a cross-module dependency,
or introduce a compatibility path require an impact analysis and ADR.

An urgent deviation requires an approved, expiring engineering exception under
`docs/grants/EXCEPTIONS/`. Data authorization, human confirmation, revision
concurrency, auditability, and non-fabrication rules are never exemptible.
