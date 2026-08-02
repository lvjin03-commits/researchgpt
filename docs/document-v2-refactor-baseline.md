# Document V2 Refactor Baseline

Document V2 is refactored under three constraints: preserve observable behavior,
keep one authoritative owner for every decision, and move code incrementally.

## Authoritative boundaries

| Boundary | Owner |
| --- | --- |
| HTTP parsing and streaming | Next.js route |
| Chat versus document action | chat action resolver |
| Explicit document commands | document command gateway |
| Job, lease, revision, outbox, global stage | runtime |
| Work acquisition | production worker |
| Current-stage component progression | orchestrator |
| Provider calls and response evidence | model executor |
| Citation, reference, layout and final-spec projection | assembly |
| DOCX formatting | renderer |
| Recorded-fact projection | diagnostics |

No downstream module may reinterpret a decision already frozen upstream.

## Reliability rules

1. A worker does not recursively dispatch itself.
2. Runtime is the only owner of durable global stage transitions.
3. A provider attempt is recorded before the external call.
4. Raw provider evidence is saved before parsing or repair.
5. Unknown provider outcomes are not automatically regenerated.
6. Assembly is deterministic and cannot call a model.
7. Renderers cannot query the database or generate missing content.
8. Diagnostics read structured failures and never drive execution.

## Compatibility retirement

Compatibility code may read historical data, but new jobs must not write a
legacy format. Each compatibility path needs a usage signal, a retention period,
and a deletion condition before removal.

| Compatibility path | New writes | Removal condition |
| --- | --- | --- |
| paragraph-level legacy citations | forbidden | no active historical jobs |
| legacy figure/table placement | forbidden | mature contract covers production |
| legacy execution fingerprint | forbidden | retained executions expire |
| model-generated reference list | forbidden | deterministic manifest is verified |

## Refactor acceptance

Each structural change must preserve routing, stage transitions, event order,
provider selection, model-call count, component keys, recovery position, user
failure code, and the semantic structure of the generated DOCX. DOCX comparison
uses document XML, object counts, styles, relationships, and rendered pages rather
than the ZIP binary hash.

## Research capability extension

STORM or another research system may later implement a planning-stage exploration
adapter. It may return proposed perspectives, questions, searches, sources, and
outlines. Existing reference verification and planning remain authoritative; an
adapter cannot publish evidence, mutate jobs, or render documents.
