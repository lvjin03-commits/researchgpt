# Impact Analysis 0008: Real Diagnostic Checker Pack

- Status: accepted for implementation
- Date: 2026-08-09
- Scope: Grant diagnostics only

## Intended Effect

Running Check application should find high-confidence, source-located issues in
real grant drafts instead of reporting only empty sections and placeholders.

## Authority and Data Flow

No authority moves and no second diagnostic path is added:

```text
Committed grant revision
  -> existing Diagnostic Service
  -> default deterministic checker registry
  -> existing Diagnostic Assembler
  -> existing diagnostic repository
  -> existing right-side Finding panel
```

Each checker owns only its stated deterministic conclusion. The assembler owns
Finding identity and conflict retention. The UI presents results without
reinterpreting severity.

## New Checks

- objectively thin non-reference section content;
- explicit literature claims without a visible source marker;
- highly repeated substantive text;
- conflicting explicit definitions for the same acronym.

The citation check does not claim a statement is scientifically false. The
terminology check does not choose which definition is correct. Those decisions
require evidence or expert judgment.

## Existing Product Impact

- A diagnostic run creates four checker-run records instead of one.
- Existing Finding, feedback, patch, incremental recheck and persistence
  contracts are unchanged.
- Chat, Document V2, STORM, editor revisions, evidence authorization and DOCX
  export are unchanged.
- No database migration or feature flag is required.

## Failure and Performance

- Checkers are local deterministic operations and make no model or network
  calls.
- Duplicate comparison is limited to substantive paragraph/list nodes and is
  quadratic in that bounded set; ordinary grant sizes remain inexpensive.
- One checker failure is retained as a failed run and does not reinterpret
  results from other checkers.

## Verification

1. A realistic flawed fixture produces one Finding from each new rule family.
2. A cited literature sentence is not flagged.
3. Applicant-owned prior work wording is not treated as third-party evidence.
4. Findings contain a source node or section and a concrete recommendation.
5. No user-facing severity wording is introduced.
6. Section-bundle recheck emits only findings anchored to the affected section.

## Rollback

Remove the new checkers from the default registry. Existing rows remain valid
historical diagnostic records and require no data migration.
