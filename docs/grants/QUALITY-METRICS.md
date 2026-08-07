# Grant Platform Quality Metrics

These metrics measure product and checker quality after rollout. They do not
score an applicant, predict review outcomes, or create unsupported severity.

## Diagnostic Quality

- user-reported false-positive rate;
- expert-confirmed false-positive rate when expert review exists;
- inaccurate or overly broad source-location rate;
- duplicate Finding rate;
- unresolved checker-conflict rate;
- unlocated Finding rate;
- Finding drift across checker versions.

## Advice and Patch Quality

- advice expansion rate;
- user-requested adjustment rate;
- patch acceptance and rejection rates;
- stale-revision rejection count;
- out-of-scope patch rejection count;
- evidence-insufficient stop count;
- authorization-revoked stop count.

## Recheck Quality

- resolved, partially resolved, and still-present rates;
- unable-to-match rate;
- new-related-issue rate;
- A -> B -> A cycle rate;
- human-review-required rate.

## Operational Safety

- model calls blocked by data policy;
- model contexts rebuilt after authorization revision;
- duplicate provider calls prevented;
- failed deletion or revocation propagation;
- rollback and feature-flag drill results.

## Ownership and Review

Every checker records an owner, version, benchmark set, quality trend, retention
criteria, and downgrade/removal criteria. Quality is reviewed at each delivery
phase and on a recurring schedule after rollout. A checker is not retained only
because implementation effort has already been spent.

Metrics must use aggregate or non-sensitive identifiers. Application text,
unpublished results, evidence excerpts, and full prompts must not enter product
analytics.
