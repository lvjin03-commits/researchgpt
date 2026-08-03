# STORM Runtime Admission and Verification

## Current decision

**Do not enable the real STORM runtime yet.** The removable integration and
rollback controls are verified, but the production research runtime is not
admitted. `services/storm-exploration/requirements.txt` deliberately excludes
`knowledge-storm`, and `create_real_runner()` deliberately stops before
provider configuration.

Setting `STORM_RUNTIME_APPROVED=true` now is not an activation procedure. It
would only move execution to the next explicit safety failure.

## Admission prerequisites

All items must be complete before the global switch can become true:

1. Produce a hashed Python lock file for the audited STORM fork/version.
2. Resolve or explicitly accept every dependency vulnerability recorded in
   `docs/storm-upstream-baseline.md`.
3. Generate and review the transitive dependency license inventory.
4. Implement the real runner with article generation and polishing disabled.
5. Configure separate low-cost question/search and outline model profiles.
6. Configure an approved search provider, quotas, timeout, and source policy.
7. Replace development SQLite with a durable production execution store or a
   single-worker persistent-volume deployment with tested recovery.
8. Add service-to-service authentication, secret rotation, rate limiting, and
   network restrictions.
9. Persist provider request IDs, usage, cost, status, and result checksums.
10. Deploy the STORM service without Document V2 database or storage
    credentials.

## Functional verification sequence

### 1. Runtime-off baseline

```powershell
$env:STORM_RUNTIME_APPROVED = "false"
npm run test:storm-runtime-off
```

Expected: no start, inspect, or result-load call reaches STORM, and a real
Document V2 DOCX fixture is generated.

### 2. Isolated service verification

Run the service with test credentials and a non-production data store. Submit
one exploration, inspect it until terminal, and load its result.

Expected result:

- status is `complete` or explicitly `partial`;
- article generation and polishing remain disabled;
- the response passes `ResearchExplorationProposalSchema`;
- usage and provider request IDs are present;
- restart recovery does not duplicate the exploration.

### 3. Source-quality verification

For a fixed benchmark topic, manually inspect candidate URLs and metadata.
Then pass candidates through the existing Reference Pipeline.

Expected:

- candidates are never marked verified by STORM;
- inaccessible or mismatched sources are rejected;
- only verified references become citable evidence;
- no STORM internal source key reaches the document.

### 4. Shadow rollout

Enable only internal test accounts and Shadow mode. Keep production planning
authoritative and compare coverage, source verification rate, latency, model
calls, and cost.

Exit criteria must be frozen before the trial. Shadow failure must not change
or pause a Document V2 job.

### 5. Advisory rollout

Generate matched documents with and without advisory hints. Verify the actual
DOCX files, references, diagnostics, and cost.

Expected: disabling STORM produces the baseline document path; corrupt or
missing proposals fall back without contaminating the skeleton.

### 6. Required rollout

Required mode is last. Verify success, partial result, timeout, cancellation,
unknown outcome, and global shutdown while an exploration is running.

Expected: failure pauses with an explicit reason and never silently changes a
paid deep-research request into ordinary planning.

### 7. Rollback drill

Set the global switch to false, confirm normal DOCX delivery, and deploy the
stable tag to an isolated preview against a compatible database snapshot.
Record the deployment ID and smoke-test result.

## Production activation order

```text
runtime off
→ deploy service and web integration
→ verify baseline Document V2
→ internal Shadow
→ limited Advisory
→ expand Advisory after metrics pass
→ limited Required
```

At any failure threshold, set the enabled percentage to zero and then set
`STORM_RUNTIME_APPROVED=false`. A circuit breaker may stop new explorations,
but it must never stop Document V2.
