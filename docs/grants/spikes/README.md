# Grant platform spike results

Execution date: 2026-08-07

The four required technical spikes were executed before product implementation.
They use fixed, synthetic fixtures and do not touch production routes, data,
workers, or model providers.

| Spike | Measured outcome | Product implication |
|---|---|---|
| DOCX round-trip | 19/19 body nodes, one table, one image, six headings and two lists survived; two sections became one and header/footer parts were lost | Canonical body import is feasible, but arbitrary Word fidelity is not; every import needs a fidelity report and preserved original |
| Anchor drift | 8 scenarios; all eight made the safe automatic-vs-human decision; only 3/8 were safe for automatic relocation | Cross-version anchors need confidence/margin gates; split/merge/move/paraphrase/type changes require confirmation |
| Patch concurrency | Stale patch rejected; simultaneous writers produced exactly one commit and one conflict | Revision Service must own atomic compare-and-swap; Patch validation never authorizes overwrite |
| Evidence revocation | Queued call blocked, cache removed, draft invalidated, accepted revision audit retained | Context must be materialized at dispatch from current authorization; queued excerpts are forbidden |

## DOCX render status

The packaged renderer could not run because LibreOffice/`soffice` is absent.
An attempt to use installed Microsoft Word through COM also failed in the
non-interactive execution session (`RPC server unavailable`). Structural OOXML
and package checks completed, but visual page fidelity is **not verified**.
This is a blocking limitation for choosing the final import/export adapter, not
a reason to claim the round-trip visually passed.

## Reproduction

Run `scripts/grant-spikes/run_spikes.py`. The default output is
`%TEMP%/researchgpt-grant-spikes`, containing one JSON report per spike and the
two DOCX files used by the round-trip test.
