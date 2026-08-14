# ADR 0031: Program owns edit candidate safety

## Decision

Compare each generated candidate with its semantic base, allocate stable turn-local `C*` claim references, and validate every proposed binding against the source IDs admitted for that exact turn.

The safety-state mapping is deterministic. Models cannot return or override `passed`, `needs_confirmation`, `blocked` or `needs_repair`. Reference generation is prohibited even when a source is bound; reference assembly remains a separate program authority.

## Consequences

Unsafe facts are visible and measurable instead of hidden behind prompt compliance. Text-only editing remains useful for rewriting, while unsupported new factual claims require explicit resolution and cannot silently seed subsequent candidates.

