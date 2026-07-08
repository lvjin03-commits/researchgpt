# Changelog

## 2026-07-08

- Improved literature search ranking with research direction matching, phrase matching, provider reliability, metadata completeness, and publication type quality signals.
- Added a conservative quality score floor so low-quality results are suppressed when enough stronger candidates exist.
- Extended literature search debug output with ranking score breakdowns.
- Reduced literature update timeout risk by defaulting the active online pipeline to OpenAlex, arXiv, and PubMed.
- Made backend literature settings preserve and respect `selectedSources`.
- Parallelized provider fetches and reduced AI reranking load to the top 10 candidates.
- Added project status tracking document.
