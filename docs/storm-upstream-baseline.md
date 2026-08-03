# STORM Upstream Baseline

This record freezes the upstream source evaluated for the optional Research
Exploration capability. It does not authorize STORM to participate in the
Document V2 production pipeline.

## Source

| Field | Value |
| --- | --- |
| Repository | `https://github.com/stanford-oval/storm.git` |
| Release | `v1.1.0` |
| Commit | `e80d9bbea7362141a479940dabb751c1f244e4b6` |
| Local audit checkout | `C:\Users\j.lyu\storm-upstream` |
| Checkout mode | Detached HEAD, shallow clone |
| Upstream license | MIT |
| Required Python | `>=3.10` |

The upstream copyright notice and MIT license must remain present in any
redistributed substantial copy or fork.

## Dependency reproducibility

The upstream release does not provide a complete lock file. Its direct
requirements pin only some dependencies:

- `dspy_ai==2.4.9`
- `numpy==1.26.4`
- `litellm==1.59.3`

Other direct dependencies, including Sentence Transformers, LangChain,
Qdrant, Trafilatura, TOML, Wikipedia and Diskcache, are unpinned. Production
must therefore use a ResearchGPT-owned lock file and container image rather
than install the upstream `requirements.txt` directly.

## Security audit

Audit command:

```text
pip-audit 2.10.1 -r requirements.txt
```

Audit date: 2026-08-02.

The resolver reported 18 known vulnerability records across three resolved
packages:

| Package | Resolved version | Finding |
| --- | --- | --- |
| `litellm` | `1.59.3` | Multiple advisories; reported fixed versions range from `1.61.15` through `1.84.0` |
| `transformers` | `4.57.6` | Multiple advisories; some reported fixes require a later major/minor release |
| `diskcache` | `5.6.3` | One advisory without a fix version in the audit result |

Duplicate advisory aliases are included in the tool's total, so the count is
not a count of unique root causes. The result is still a production blocker.

## Admission decision

Status: **source accepted for isolated evaluation; runtime dependencies not
approved for production**.

Before the independent STORM service may be deployed, it must have:

1. a compatibility-tested dependency override or patched fork;
2. a fully resolved, hashed lock file;
3. a clean or explicitly risk-accepted vulnerability report;
4. a generated transitive-license inventory;
5. fixture tests proving that the pinned adapter still reads STORM output;
6. a container that runs without access to Document V2 credentials or storage.

STORM remains outside `lib/document-v2`, and no source candidate or outline
from this checkout is authoritative ResearchGPT data.
