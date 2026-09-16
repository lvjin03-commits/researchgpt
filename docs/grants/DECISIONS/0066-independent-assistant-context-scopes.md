# ADR 0066: Independent Grant Assistant context scopes

- Status: accepted for implementation
- Date: 2026-09-16
- Owners: Grant Assistant Context Planner and Planned Context Assembler

## Context

One pair of target arrays currently serves three different decisions: which
document memory to project, which original text to retrieve and which current
diagnostic Findings are relevant. Whole-document review does not require the
model to enumerate original-text targets, but relevant diagnostics and focused
memory can still require precise targets.

## Decision

The planner returns three independent discriminated scopes:

- memory: all memory or validated targets;
- original document: no original, validated targets or the whole Revision;
- diagnostics: none, validated targets or all current Findings.

Only a targeted scope contains aliases. The Context Planner validates every
alias used by a targeted scope and resolves it to current Revision or memory
identity. The program, not the model, enumerates whole-Revision coverage.

The final full-document synthesis contract is bounded to a concise response
whose maximum field sizes and operation-policy completion budget agree.

## Consequences

- Whole-document intent cannot fail because the model attempted to enumerate
  the entire application.
- Diagnostic relevance no longer depends on incidental original-text targets.
- Targeted requests remain strict; no unknown alias is silently omitted or
  approximately matched.
- The existing memory pipeline and context assembler remain the only execution
  path and authorization boundary.
