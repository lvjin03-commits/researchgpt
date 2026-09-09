# Impact analysis: web-search query egress

- Adds a pure fail-closed pre-dispatch policy and append-only audit contract.
- Introduces no provider call, route, database migration, model call, billing,
  UI control, Evidence authorization or canonical document mutation.
- New authority is limited to whether a candidate query may leave the system.
  It does not choose a provider or assess returned content.
- Current document text is used transiently for overlap detection and never
  enters the audit record. Blocked text is represented only by SHA-256 hash.
- Risks: false positives for technical phrases and incomplete entity detection.
  Mitigation: explicit issue codes, versioning, program-derived sensitive terms,
  bounded query length and offline adversarial tests. Runtime must allow a safer
  rewrite rather than silently weakening the gate.
- Later work must persist audits, wire the gate immediately before provider
  dispatch, register Operation/billing and verify the visible user path.
