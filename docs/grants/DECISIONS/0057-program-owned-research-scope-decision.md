# ADR 0057: Program-owned research suggestion scope decision

## Status

Accepted for the research judgment contract. Production integration remains a
separate rollout step.

## Context

Literature relevance does not imply that a topic belongs in an NSFC proposal.
Lifecycle analysis, anode-free cells or a new characterization chain may be
valid research trends while still diluting the application's core question.
One model-generated label is not stable enough to control that boundary.

## Decision

The model supplies only bounded match and expansion signals. A deterministic
policy derives `relevance`, `scopeImpact`, `finalDecision` and a rejection
reason. Adjacent topics and major scope expansions cannot enter final answer
synthesis. Verified no-gap candidates are rejected as already covered.

Existing-design records separately state coverage level, verification status
and support boundaries. This distinction is reused from the scientific-review
discipline rather than creating a second diagnostic authority.

Rejected candidates retain an audit record with their summary, source identity
and reason. Renderers may expose this audit but cannot reinterpret it.

## Consequences

The answer model becomes an expression layer over admitted suggestions. It may
shorten or organize approved content, but it cannot add a rejected suggestion,
upgrade evidence strength or introduce a new work package.
