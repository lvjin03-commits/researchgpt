# Impact Analysis 0038: intelligent candidate conversation contract

## Intended outcome

Make the persistent Grant assistant feel context-aware without allowing model
semantics to select a consequential operation. Phase B adds explicit focus,
non-authoritative action suggestions, candidate explanation and one shared
explanation summary. This analysis freezes ownership before Diff, model,
persistence or UI implementation begins.

## Existing authorities retained

- Composer Scope remains the only operation-routing authority.
- Edit Session remains the owner of target, candidate chain and candidate state.
- Patch Commit Service and Revision Service remain the only canonical writers.
- Grant Model Data Gateway remains the only model-context builder.
- Grant Model Executor remains the only model budget and telemetry authority.
- Evidence and Figure Authorization services remain the current-access owners.

No free-text classifier, model response, Suggested Action, Focus state or user
preference may invoke an operation or write canonical content.

## Hard routing invariant

With no preceding explicit action, composer text always invokes
`grant.assistant.chat`. Edit-like wording, active selections, active Candidates,
model intent classification and prior user behavior cannot change that route.
Only a user click on a visible action can select `grant.edit_session.turn` or
future `grant.edit_candidate.explain`.

The model may recommend an action. The program may display it. Neither may
execute it without the user clicking the bound action.

## Non-authoritative Suggested Actions

```ts
type GrantAssistantSuggestedAction =
  | {
      actionId: string;
      kind: "start_edit";
      targetNodeId: string;
      sourceRevisionId: string;
      expectedNodeHash: string;
      instructionDraft: string;
      createdAt: string;
    }
  | {
      actionId: string;
      kind: "continue_edit" | "explain_candidate";
      editSessionId: string;
      candidateId: string;
      expectedCandidateHash: string;
      instructionDraft?: string;
      createdAt: string;
    };
```

A Suggested Action has no execution authority. Clicking it re-resolves the
document, node, Edit Session and Candidate and checks every bound hash. Drift
returns `suggested_action_stale`; it never silently applies the old instruction
to new content. The user may request a refreshed suggestion or explicitly begin
a new action against the current content.

## Focus and ambiguity

```ts
type GrantAssistantFocusState =
  | { kind: "none" }
  | { kind: "resolved"; focus: GrantAssistantFocus }
  | { kind: "ambiguous"; ambiguityId: string; choices: GrantAssistantFocus[] };
```

Focus resolves pronouns for answer composition only; it does not select an
operation. An ambiguous focus becomes resolved only when the user clicks one
choice. If the user instead types a new message, that turn executes with
`focus: none`; the program and model may not infer a choice from the new prose.

## Answer mode versus operation

`ChatAnswerMode` may be selected semantically because it changes presentation
only:

```ts
type GrantAssistantChatAnswerMode =
  | "direct_answer"
  | "candidate_explanation"
  | "document_analysis"
  | "comparison"
  | "clarifying_question";
```

Selecting an answer mode never creates a Candidate, Patch or Revision. A model
may choose an imperfect answer mode; it may not convert that choice into an
operation.

## Candidate explanation authority

Future operation `grant.edit_candidate.explain` explains a program-computed
Diff and has no write capability. One `CandidateExplanation` is the sole
semantic explanation authority:

```ts
type CandidateExplanation = {
  candidateId: string;
  summary: string;
  changes: CandidateChange[];
  blockingIssues: BlockingIssue[];
  cautions: string[];
  sources: Array<{
    sourceId: string;
    sourceTitle: string;
    usedWhenGenerated: boolean;
    currentlyAuthorized: boolean;
    status: "current" | "revoked" | "expired" | "changed";
  }>;
};
```

The Candidate card's automatic summary is exactly
`CandidateExplanation.summary`; there is no second summary generator. Before an
explanation exists, the UI may show deterministic counts but no semantic claim
such as "logic improved" or "no new data". Program-owned blocking issues are
always rendered before summary, changes and cautions and cannot be lowered by
the model.

## Explanation execution and cache

`grant.edit_candidate.explain` will use the operation registry, unified Model
Executor, `grant_model_calls`, one initial call plus at most one controlled
repair, and no fallback operation. Its deterministic cache key is:

```ts
sha256({
  candidateId,
  candidateContentHash,
  semanticBaseHash,
  diffHash,
  diffContractVersion,
  candidateSafetyState,
  factCheckFingerprint,
  evidenceAuthorizationFingerprint,
  explanationPolicyVersion,
})
```

A cache hit makes no provider call and creates no new model-call attempt.
Concurrent misses for the same key require a unique constraint or single-flight
owner. Candidate, Diff, safety, fact-check, authorization or policy changes
invalidate the key.

## Preference authority

Candidate-input behavior defaults to `ask`. Only an explicit user action in a
visible setting may change it to `continue_edit`. The system may not learn,
infer, recommend enabling or silently migrate this preference from observed
behavior. The setting is visible, reversible and limited to the Candidate-local
composer; it cannot change the global chat composer.

## Context budget

The server fills a fixed budget in this priority order: safety and operation
policy, current focus identity and hashes, current user message, Candidate and
Diff, blocking/fact-check state, current selection, admitted Evidence, recent
relevant turns, older summaries and auxiliary background. Trimming happens in
reverse priority. Current question, focus identity, Candidate, Diff, blocking
issues and safety policy are non-droppable. If they alone exceed the budget the
call fails `context_budget_exceeded`; it cannot dispatch a weakened context.

## Data and implementation impact

Later steps require a versioned Chinese Diff contract, an explanation
operation/policy, deterministic explanation persistence and cache uniqueness,
and assistant message projections for explanation cards. Those are not added
in this contract-only step. Any migration must be additive and fail closed
behind an exact schema-readiness marker.

## Verification obligations

- Free text without an explicit action always resolves to chat.
- Suggested Actions fail closed after node or Candidate drift.
- Unselected ambiguity followed by prose uses `focus: none`.
- Preferences change only through explicit user settings.
- Candidate summary and expanded explanation share one stored result.
- Blocked Candidates display program blocking issues first.
- A repeated explanation cache key produces no new provider call.
- Context trimming never removes Candidate Diff or blocking issues.
