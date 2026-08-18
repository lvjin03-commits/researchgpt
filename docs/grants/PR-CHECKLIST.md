# Grant Platform Pull Request Checklist

Copy the relevant sections into every grant-platform PR.

## Scope and Ownership

- [ ] The user-visible or architectural outcome is stated.
- [ ] The authoritative owner for every changed decision is identified.
- [ ] The change does not introduce a second route, model, revision path,
      patch committer, authorization check, model gateway, or exporter.
- [ ] Cross-module changes include an impact analysis and ADR.
- [ ] Temporary compatibility has a removal condition and expiry.
- [ ] Any exception references an approved, non-expired Exception ID.

## Contracts First

- [ ] Input/output contracts and invariants changed before implementations.
- [ ] A failing regression/contract scenario exists for the old problem.
- [ ] Replaced code is removed, or its migration/deletion condition is recorded.
- [ ] Schema changes include a forward-compatible migration and rollback reader.
- [ ] New grant persistence RPCs have a repeatable real-PostgreSQL probe covering success, authorization, stale Revision and rollback behavior.

## Revision and Patch Safety

- [ ] Formal writes go only through Revision Service.
- [ ] Compare-and-swap rejects a stale base revision.
- [ ] Patch target/anchor IDs and hashes are validated programmatically.
- [ ] Actual patch impacts are recomputed rather than trusted from model output.
- [ ] User acceptance does not bypass scope, authorization, or concurrency checks.

## Evidence and Model Data

- [ ] Every model call enters through the Grant Model Data Gateway.
- [ ] Current authorization is queried at call time.
- [ ] Read, index, model-use, reasoning, and citation permissions stay separate.
- [ ] Provider admission matches data sensitivity.
- [ ] Revocation invalidates queued work, cached context, and dependent drafts.
- [ ] Untrusted document instructions cannot change system or patch authority.
- [ ] Imported figure IDs, hashes, source anchors, captions and storage keys are
      program-owned and never inferred by a model or renderer.
- [ ] Image use has current, revision-bound, asset-scoped authorization and is
      denied by default; text/evidence authorization does not imply image use.
- [ ] Model payloads do not expose durable object paths or ask the provider to
      compose canonical section/node/asset IDs.
- [ ] Revocation, expiry or source-revision change invalidates queued and cached
      multimodal context before dispatch.

## Persistent Assistant

- [ ] Visible Composer Scope, not user wording or model output, selects chat or
      one explicit Edit Session operation.
- [ ] Referencing a document selection keeps chat scope; editing requires an
      explicit target transition.
- [ ] Every edit-candidate message references both its Edit Session and
      candidate; the assistant does not become a second candidate owner.
- [ ] Grant Model Data Gateway derives grounding from the effective admitted
      context rather than user phrasing or a model declaration.
- [ ] Grounded claim aliases resolve only to frozen, currently authorized
      sources; unknown, revoked or fabricated aliases cannot render as grounded.
- [ ] The assistant answer is a discriminated union selected from effective
      admitted context; grounded `unsupportedClaims` and `warnings` are
      required arrays rather than optional model declarations.
- [ ] Document-selection context is revalidated against the current Revision,
      node text, offsets and hashes before every assistant model dispatch.
- [ ] `grant.assistant.chat` uses the operation registry, unified executor,
      idempotency, telemetry and bounded repair budget without chat-route
      fallback.
- [ ] Academic search remains the confirmed OpenAlex snapshot path; no general
      web-search semantics are implied.
- [ ] The client submits only the new assistant message; the server selects the
      bounded stored conversation context.
- [ ] Assistant rollout requires schema marker 056, follows the canary runbook,
      and rolls back by flag without deleting audit or Revision data.
- [ ] Retention distinguishes disposable general reasoning, grounded audit
      metadata and Revision-linked records.
- [ ] Image generation and derivative-image authorization remain outside Phase
      A unless a separate impact analysis and ADR are approved.
- [ ] Free text without a preceding explicit action can invoke only
      `grant.assistant.chat`; semantic intent never selects an Operation.
- [ ] Suggested Actions bind source Revision and target hashes, have no
      execution authority, and fail closed when clicked after drift.
- [ ] Ignored ambiguity followed by new prose executes with `focus: none`.
- [ ] Ambiguity is derived by the program Focus state machine and is rechecked
      server-side before any model-call attempt; the model never self-reports
      whether a reference is ambiguous.
- [ ] Candidate-local routing preferences change only through a visible,
      reversible user setting and are never learned from behavior.
- [ ] Context budgeting never removes current Candidate, Diff, blocking issues,
      Focus identity, current question or safety policy.
- [ ] Candidate comparisons use `grant-candidate-diff-v1`; no UI, model adapter
      or explanation service computes a parallel semantic Diff.
- [ ] Candidate chat submits only Session/Candidate identity and an expected
      Candidate hash; the server rebuilds Candidate, semantic base, Diff and
      blocking issues before model dispatch.
- [ ] Diff coordinates are normalized UTF-16 code-unit offsets and duplicate
      paragraph text is not assigned a guessed move identity.
- [ ] `查看差异` is a GET-only, no-model Candidate Diff route; Candidate
      discussion uses only `grant.assistant.chat`.
- [ ] The executable registry, provider adapter, request context and UI contain
      no `grant.edit_candidate.explain` path; legacy log values remain parseable
      only for historical audit.
- [ ] Candidate UI renders program-owned blocking issues before Diff detail.
- [ ] Context capacity preserves the complete Diff and every blocking issue;
      overflow fails before cache claim or model dispatch.
- [ ] Retirement preserves historical explanation audit/cache records without
      leaving an executable route, policy or provider method.

## Diagnostics

- [ ] Findings identify checker/version/input hash and source locations.
- [ ] No unsupported severity or review-outcome prediction is introduced.
- [ ] User disposition is separate from lifecycle and recheck status.
- [ ] Checker conflicts are retained.
- [ ] Checker upgrades declare historical-Finding compatibility.
- [ ] Provider-facing strict schemas use required nullable fields and required
      arrays rather than optional properties.
- [ ] Semantic categories have boundary fixtures, including positive and
      negative examples for overlapping categories.
- [ ] Model-facing locations use one atomic, execution-local reference per
      authorized canonical node; models never combine section and node IDs.
- [ ] Multi-stage semantic operations reuse one prepared atomic-location map
      and revision-scoped fingerprint; no stage rebuilds aliases independently.
- [ ] Every resolved location reference and Evidence Card ID was supplied and
      is currently authorized for its claimed scope.
- [ ] Finding fingerprints exclude recommendation phrasing and other unstable
      presentation text.
- [ ] ArgumentMap aliases, ordering and prose do not participate in durable
      Finding or recheck identity; continuity resolves to canonical nodes.
- [ ] Model-recognized semantic objects use execution-local references and
      canonical physical anchors; they never mint or impersonate document nodes.
- [ ] V6 Fact Map input reuses the admitted atomic-location scope, Evidence
      authorization set and figure map; it never reparses or rebuilds aliases.
- [ ] Fact Map provider output contains no canonical IDs, semantic-object IDs,
      Findings, diagnosis, recommendation, severity or priority.
- [ ] Fact Map Assembler allocates `S*`, resolves every `N*` and derives anchor
      offsets/hashes from frozen canonical node text.
- [ ] Semantic-object continuity excludes local aliases and model prose, and an
      ambiguous calibration is not silently treated as the same or a new object.
- [ ] Fact Map coverage accounts for every frozen semantic object exactly once;
      absence of a Finding is never treated as proof that review occurred.
- [ ] Verified-no-gap and unable-to-verify objects cannot publish Findings, and
      authorization loss is represented as unable to verify rather than fixed.
- [ ] Every target Finding is bound to at least one covered semantic object;
      unknown or orphan Finding references fail the coverage quality gate.
- [ ] Scientific Findings acknowledge existing design and evidence tier before
      reporting only the residual gap; performance is not mechanism or causality.
- [ ] Scientific Review returns coverage for every frozen Fact Map object;
      verified-no-gap and unable-to-verify never manufacture a Finding.
- [ ] `authorized_evidence` scientific conclusions use only currently admitted
      verified Evidence Cards; metadata-only records cannot support them.
- [ ] Scientific Review executor has no private retry or default token budget;
      both remain owned by the aggregate diagnostic operation.
- [ ] Narrative Findings use their own categories and fields; presentation
      friction is not represented as a scientific evidence gap.
- [ ] Scientific and narrative provider schemas reject severity, priority and
      fields owned by the other Finding family.
- [ ] Visual-communication Findings use only currently authorized, program-
      resolved figure assets; nonvisual Findings cannot claim figure use.
- [ ] Text-only Narrative Review cannot emit `visual_communication`; captions
      and omitted figures are not treated as visual access.
- [ ] Narrative Review reuses the current Model Data Gateway image admission
      and does not create a second authorization or materialization path.
- [ ] Narrative Review executor has no private retry or default token budget;
      image bytes and document prose are absent from durable failure telemetry.
- [ ] Semantic Review V6 normal execution is exactly Fact Map, Scientific
      Review and Narrative Review; the aggregate executor is the only owner of
      the four-call/46,000-completion-token ceiling.
- [ ] Fact Map never retries; Scientific and Narrative Review share no more
      than one exceptional recovery for truncation or explicit transient
      provider failure, and deterministic failures consume no retry.
- [ ] Resume checkpoints validate revision, input and location scope before a
      provider call; Narrative image authorization is rebuilt per paid attempt.
- [ ] V6 checkpoint lookup/save is owner-, current-Revision-, checker-, input-
      and location-scope-bound; checkpoints never become Finding identity.
- [ ] V6 success persists the existing run/Finding envelope, both V6 detail
      families and checkpoint consumption in one stale-Revision-guarded RPC.
- [ ] V6 fingerprints exclude model prose and execution-local `F*`/`S*` refs;
      Scientific identity uses stable semantic facets/anchors and Narrative
      identity uses canonical locations/scope/authorized figure IDs.
- [ ] ArgumentMap output is descriptive only; diagnostic judgments and advice
      remain owned by the semantic Finding contract.
- [ ] ArgumentMap provider code stays in the existing Grant model adapter
      boundary; diagnostics owns only prompt, contracts and deterministic
      assembly.
- [ ] ArgumentMap does not add a private retry counter; all future retries must
      consume the unified two-stage provider budget.
- [ ] Root diagnosis groups repeated manifestations semantically in one card;
      deterministic code does not attempt prose-based root-cause merging.
- [ ] Invalid related locations degrade locally, while findings without a valid
      primary occurrence or with unauthorized Evidence Cards are not published.
- [ ] The two-stage diagnostic has one aggregate call-budget owner and cannot
      exceed one ArgumentMap call plus two root-diagnosis calls.
- [ ] Retry changes the failed condition; unknown outcomes, 400s, structural
      references and Evidence authorization failures do not retry.
- [ ] ArgumentMap checkpoint recovery validates revision and frozen location
      scope before any provider call.
- [ ] Default issue order follows canonical source order and does not treat
      actionability or confidence as severity or priority.
- [ ] V2/V3 compatibility is normalized below the UI, and historical records
      remain auditable without becoming duplicate active Findings.
- [ ] Validation/failure telemetry contains no grant prose, quotes, or evidence
      excerpts; content fields are represented only by safe structural facts.
- [ ] Durable root identity is derived from canonical occurrence fingerprints,
      never ArgumentMap aliases, model prose, recommendation wording or model order.
- [ ] A successful hierarchical save writes the existing Finding envelope,
      V4 details and checkpoint consumption atomically.
- [ ] Root-card occurrence navigation resolves canonical nodes through the
      normalized projection; UI does not reconstruct continuity or root grouping.

## Verification

- [ ] `grant.assistant.chat` depends on Revision reads and chat-only gateway
      methods; it cannot compile against Patch, apply or Revision-commit APIs.
- [ ] Free text, cache hits and recommended-question clicks remain no-write;
      recommendations only fill the composer.
- [ ] Unknown and retired Operation values fail closed in the registry rather
      than falling through to another model policy.
- [ ] Edit Session creation/continuation and `应用到正文` remain explicit user
      actions outside the ordinary chat route.
- [ ] Repeating an unchanged focused question returns the stored answer with
      zero provider calls and zero new `grant_model_calls` attempts.
- [ ] Chat cache identity includes normalized question, Revision, model policy,
      focus identity and focus content hash; Candidate reuse also binds Diff
      and safety state.
- [ ] Unfocused chat and Evidence-attached turns do not use the lightweight
      cache without a current Evidence-authorization fingerprint.
- [ ] Recommended questions are deterministic templates, make no model call,
      and only fill the ordinary chat composer without selecting an Operation.

- [ ] End-to-end and PostgreSQL tests obtain checker, contract, schema, prompt,
      and policy versions from production authorities; fixtures do not inject
      handwritten "correct" versions that bypass the production path.
- [ ] `npm run check:grant-architecture` passes.
- [ ] Typecheck/build and relevant automated tests pass.
- [ ] Existing chat, Document V2, upload, literature, and auth behavior was
      regression-tested when shared infrastructure changed.
- [ ] The actual user path and real output were verified per
      `docs/effect-first-development.md`.
- [ ] What was not verified is stated explicitly.

## Rollout

- [ ] Feature flags default to the intended safe state.
- [ ] Rollback keeps canonical content readable.
- [ ] Migration and deletion steps are documented.
- [ ] Logs and metrics do not expose sensitive application content.
- [ ] Hierarchical diagnosis requires rollout admission and database schema
      `047` readiness; either missing gate fails closed before a model call.
- [ ] Canary selection is server-owned and stable by authenticated owner ID.
- [ ] Rollback mode `off` restores the existing semantic implementation without
      deleting canonical content, checkpoints or historical Findings.
