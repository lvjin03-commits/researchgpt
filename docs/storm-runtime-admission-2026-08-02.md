# STORM runtime admission — 2026-08-02

## Decision

**Blocked. Do not enable the real STORM runtime.**

This decision applies only to the isolated service under
`services/storm-exploration`. Document V2 remains on the verified runtime-off
path and is not changed by this admission review.

## Candidate evaluated

| Item | Value |
| --- | --- |
| Package | `knowledge-storm` |
| Candidate version | `1.1.1` |
| PyPI wheel SHA-256 | `85e9ca115463bfe0731620d7b95b630b7509ba3b665e6e02d90b7fb7baef13d2` |
| Target runtime | Python 3.11, Linux amd64 |
| Upstream maturity | Alpha |

PyPI 1.1.1 was selected instead of the older 1.1.0 baseline because it is the
latest published package. Its package metadata still fixes `dspy_ai==2.4.9`
and `wikipedia==1.4.0`, while leaving most large dependencies unbounded.

## Blocking findings

### 1. Mandatory DiskCache dependency has no admitted fixed release

`knowledge-storm` requires `diskcache`. The latest published DiskCache release,
5.6.3, is affected by `GHSA-w8v5-vhqr-4h9v`: unsafe pickle deserialization can
execute code when an attacker can write to the cache directory and the service
later reads it.

This is not merely an unused transitive package: STORM configures LiteLLM disk
caches in both `knowledge_storm/lm.py` and `knowledge_storm/encoder.py`.

The isolated service data directory reduces exposure but does not remove the
vulnerable dependency. A production admission must not turn a mitigation into
an assertion that the dependency is fixed.

### 2. The upstream dependency graph is not reproducible as published

The Python 3.11/Linux resolver reached extensive backtracking across Qdrant,
LangChain, Hugging Face, LiteLLM and related packages. Most of those packages
are not bounded by STORM 1.1.1. Choosing a random successful resolution would
make ResearchGPT the maintainer of an untested compatibility fork.

No runtime lock file was admitted. `requirements-runtime.in` is an evaluation
input, not a production installation file.

### 3. Real provider wiring remains intentionally absent

Even after dependency admission, `create_real_runner()` still needs explicit
language-model, retrieval-provider, credential, timeout and egress policies.
Provider wiring must be implemented and tested inside the isolated service; it
must not be inferred from Document V2 configuration.

## Controls implemented

- `runtime-admission.json` is the machine-readable decision record.
- `STORM_RUNTIME_APPROVED=true` is no longer sufficient by itself.
- The runner requires both the environment flag and an approved admission
  record containing a hash-lock filename.
- The repository boundary check rejects an approved admission if its hash lock
  is missing or unhashed.
- The health endpoint exposes `runtimeAdmissionStatus`.

## Evidence verified

- Official PyPI metadata and wheel hash for `knowledge-storm==1.1.1`.
- Official GitHub release history and project maturity information.
- Python 3.11/Linux dependency resolution using wheel-only platform targets,
  with a locally built wheel only for upstream's pure-Python
  `wikipedia==1.4.0` source distribution.
- Existing deterministic Proposal conversion fixtures remain the compatibility
  boundary; no model, search provider or Document V2 call is needed for them.

## Conditions for a later approval

All conditions are required:

1. Use a fixed DiskCache release or remove/replace the vulnerable cache path in
   a small, reviewed STORM fork.
2. Maintain a Python 3.11/Linux compatibility constraint set.
3. Produce a complete `--hash=sha256:` runtime lock.
4. Pass `pip-audit` with no unaccepted runtime vulnerability.
5. Produce and review a transitive license inventory.
6. Install the lock in a clean image and run import, API and Proposal fixture
   tests without provider credentials.
7. Add provider/search configuration and run a cost-capped canary that cannot
   publish authoritative evidence or mutate Document V2.

Until then, the correct state is `blocked`, not partially enabled.
