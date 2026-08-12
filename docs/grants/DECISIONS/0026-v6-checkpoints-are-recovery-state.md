# ADR-0026: V6 checkpoints are recovery state

- Status: accepted for target-only V6 persistence
- Date: 2026-08-12

## Decision

1. V6 checkpoints are revision-bound recovery state, never Finding identity.
2. A checkpoint contains one mature Fact Map and may additionally contain the
   mature Scientific Review plus its coverage report.
3. Lookup requires document, current source Revision, checker/version, input
   fingerprint and location-scope fingerprint.
4. A successful V6 save consumes the matching checkpoint in the same database
   transaction that writes the run and both Finding families.
5. V6 Finding fingerprints use program-owned categories and canonical anchors;
   model prose and execution-local `F*`/`S*` references are excluded.
6. This step adds persistence capability only. Runtime selection remains V5.

## Consequences

- A worker may resume without repeating mature paid stages.
- Changing the canonical Revision or admitted scope invalidates reuse.
- Scientific and narrative content remain distinct while sharing the existing
  immutable Finding envelope and repository authority.
