# Impact analysis: unified web grounding contract

- Adds the canonical provider-neutral source record and a narrow model proposal.
- Reuses ADR 0040 classification; no second trust authority is introduced.
- Keeps the existing formal-edit result shape temporarily with an explicit
  migration/deletion condition, preserving stored search sessions.
- Adds no route, database table, provider request, model call, billing event,
  UI change, Evidence authorization or canonical document write.
- Public source-content fingerprints may be reused globally; future usage/audit
  associations must remain document-scoped.
- Risks addressed offline: model-supplied trust fields, invented source IDs,
  duplicate assessments, URL credentials and fragment-only duplicate records.
- Later gates: query egress, provider adapter, persistence, claim entailment and
  paraphrase checks, Operation/billing registration, rollout and live-path QA.
