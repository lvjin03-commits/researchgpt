# Impact Analysis 0037: persistent Grant assistant contract

## Intended outcome

Replace the target-scoped AI edit popover with one persistent, collapsible
assistant surface beside the canonical document. Phase A combines ordinary
grant discussion and the existing multi-turn Edit Session experience in one
message timeline. It does not combine their authorities: chat produces an
answer only, while an Edit Session produces a candidate that still requires
the existing Patch Commit Service and Revision Service.

AI image generation and image editing are explicitly outside Phase A. They
require a separate generated-asset model, usage accounting, derivative-use
authorization, impact analysis and ADR before implementation.

## Existing authorities retained

- Revision Service remains the only authority that advances canonical content.
- Patch Commit Service remains the only deterministic validator of an accepted
  AI text proposal.
- `grant.edit_session.turn` remains the only model operation for continuing an
  Edit Session.
- Grant Model Data Gateway remains the only model-context builder and performs
  current evidence and figure authorization checks before every dispatch.
- Evidence Service and the confirmed OpenAlex snapshot path remain the only
  local-source and academic-search admission paths.
- Grant Model Executor remains the only owner of attempt budgets, failure
  classification and `grant_model_calls` telemetry.

No chat route, Document V2 orchestrator, second patch route, second revision
path, general-web provider or generated-figure authority is introduced.

## New decisions and owners

| Decision | Owner | Invariant |
|---|---|---|
| Current composer purpose | Assistant Composer Scope state machine | Exactly one of ordinary chat or one explicit Edit Session target; model prose never selects it |
| Model operation | Operation registry | `chat` resolves to `grant.assistant.chat`; `edit` resolves to the referenced `grant.edit_session.turn` |
| Grounding class | Grant Model Data Gateway | Derived from the effective admitted context, never from user wording or model self-report |
| Grounded claim proposal | `grant.assistant.chat` provider contract | Every substantive context-dependent assertion declares supplied citation aliases |
| Citation and authorization validity | Assistant grounded-answer validator | Program resolves aliases and current authorization; provider cannot mint source IDs |
| Canonical write | Existing Patch Commit and Revision services | Chat has no write capability; candidates require explicit acceptance and current CAS checks |
| Assistant retention class | Assistant retention policy | Downstream impact and grounding determine deletion/audit treatment; UI cannot reinterpret it |

## Composer routing contract

```ts
type GrantAssistantComposerScope =
  | { kind: "chat" }
  | {
      kind: "edit";
      editSessionId: string;
      targetNodeId: string;
      targetLabel: string;
    };
```

The visible composer scope is the sole routing input. Attaching a selection,
typing edit-like language or receiving model prose does not change it.

- Opening the assistant starts in `chat`.
- `Reference in conversation` attaches a revision-bound context card and keeps
  `chat`.
- `Edit this text` creates or selects an Edit Session and switches to `edit`.
- `Continue editing` on a candidate switches to that candidate's Edit Session.
- Selecting another document range alone does not switch the active target.
- `Exit editing` returns to `chat`.
- A stale, deleted or hash-conflicted target fails closed before dispatch; it
  cannot silently route to chat or a neighboring node.

One assistant session may reference many Edit Sessions. An edit result must
carry both `editSessionId` and `candidateId`; the assistant timeline is an
aggregating projection, not a replacement Edit Session owner.

## Grounding and answer safety

Grounding is computed from the effective context actually admitted for the
turn:

```ts
type GrantAssistantGrounding = "general_reasoning" | "evidence_grounded";
```

Any admitted canonical selection, Evidence Card, confirmed academic snapshot
or authorized figure makes the turn `evidence_grounded`. Merely having a card
visible in the UI is insufficient if it was not admitted; conversely, implicit
user phrasing cannot downgrade a turn whose answer used admitted context.

Grounded answers use lightweight structured claims:

```ts
type GrantAssistantGroundedAnswer = {
  content: string;
  claims: Array<{
    claimId: string;
    statement: string;
    citationIds: string[];
  }>;
  citations: Array<{
    citationId: string;
    sourceType: "document_selection" | "evidence" | "academic_source";
    sourceAlias: string;
    excerpt?: string;
  }>;
};
```

The provider proposes statements and execution-local aliases. The program
resolves every alias against the frozen admitted context, checks current
authorization, rejects fabricated aliases, and reports unbound substantive
claims as unsupported. Fabricated sources, invalid authorization or invented
numeric support blocks the answer from being presented as grounded. This is a
chat-safety contract, not permission to create a Patch or bibliography entry.

## Search boundary

Phase A exposes `Search academic literature`, not generic web search. It reuses
OpenAlex metadata search and the existing explicit user-confirmation and fixed-
snapshot path. Search results do not enter model context before confirmation.
A future general-web provider requires a separate authority decision.

## Execution, idempotency and failure budget

`grant.assistant.chat` is a separate operation-registry entry and uses the
configured Grant OpenAI model through the existing Model Data Gateway and Model
Executor. The maximum budget is one initial attempt plus one controlled repair.
Structured-output invalidity and truncation may consume the repair when the
second attempt changes the failed condition. Authorization drift, stale
context, deterministic validation failures, unknown outcomes and exhausted
budgets do not retry.

Every turn receives an idempotency key and `traceId`; every attempt is written
to `grant_model_calls` before provider dispatch. There is no fallback to the
ordinary product chat route or to another model operation.

## Retention and context budget

Stored audit history and provider context are separate. The program selects a
bounded context containing the opening message, recent turns, referenced or
applied candidates and a summary of eligible older content. The client cannot
send the entire session as authoritative model context.

- Unreferenced `general_reasoning` messages with no source, candidate, Patch or
  downstream dependency may be fully deleted after the retention window.
- Grounded message bodies may expire while retaining non-reconstructive audit
  metadata: hashes, source IDs, authorization revisions, operation, model,
  `traceId`, safety state and timestamps.
- Messages connected to candidates, accepted Patches or Revisions follow the
  canonical AI-edit audit period; deleting the assistant UI session cannot
  delete the Revision audit chain.

Concrete inactivity and retention durations remain a persistence-stage policy
decision and must be frozen before a migration. No implementation may invent
indefinite retention by default.

## Data and migration impact

Phase A will require additive assistant-session/message persistence and an
explicit many-to-many or link-table relationship to existing Edit Sessions.
The implementation must not add assistant-owned candidate or revision tables.
Migration design, row-level authorization, expiry jobs and deletion RPCs are a
later authorized step. This contract-first step changes no database schema.

## Rollout and rollback

The future UI and API must be behind a fail-closed feature flag and exact schema
readiness marker. Rollback hides the persistent assistant and restores the
existing Edit Session entry surface without deleting assistant audit records,
Edit Sessions, candidates or Revisions. No copied compatibility writer is
allowed.

## Verification obligations

- Contract fixtures prove Composer Scope alone selects the operation.
- Selection attachment never changes `chat` into `edit`.
- Candidate continuation selects the correct Edit Session among multiple live
  targets.
- Stale targets fail before a model call.
- Effective admitted context forces `evidence_grounded` regardless of wording.
- Unknown or revoked citation aliases cannot render as grounded.
- `grant.assistant.chat` obeys the unified two-attempt ceiling, idempotency and
  telemetry contract.
- Existing Edit Session application still reaches the same Patch and Revision
  owners.
- Existing product chat, Document V2, diagnostics and image authorization stay
  unchanged.
