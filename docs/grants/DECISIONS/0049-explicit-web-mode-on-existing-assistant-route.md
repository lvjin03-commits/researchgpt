# ADR 0049: Explicit web mode stays on the existing assistant route

## Status
Accepted as step 11 code integration. Production activation is not authorized.

## Decision
The existing Grant Assistant POST route accepts one optional boolean,
`webSearch`. The visible `联网补充` control is the sole selector for this
read-only answering mode; user wording and the model cannot turn it on. The
request still carries only the new user message and existing context identity.

The existing `GrantAssistantChatService` remains the conversation and
persistence owner. When web mode is selected and its guarded runtime exists, it
prepares current-revision context through the Model Data Gateway and invokes
the single web-grounding orchestrator. A successful result is persisted in the
same assistant session with the existing answer contract. A controlled web
failure continues through the existing document-only assistant execution; no
parallel fallback route or answer renderer is introduced.

Runtime admission requires three independent server gates: feature enabled,
database schema `067`, and price-catalog readiness marker `001`. Provider
credentials are also required. Missing readiness keeps web mode unavailable
without disabling ordinary Grant Assistant chat.

## Consequences
The old OpenAlex user-selected Evidence workflow remains separate and unchanged.
The new mode may automatically use general-web snippets for a read-only answer,
but it has no Patch, Candidate, Evidence authorization or Revision authority.
Production still requires migration application, real price policies, secrets,
deployment and signed-in effect-first verification.
