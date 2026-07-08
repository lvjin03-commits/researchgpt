# Changelog

## 2026-07-08

- Restored Literature Tracker search to the open provider pipeline.
- Disabled AI analysis during literature updates.
- Added ResearchAI Scholar Saver Chrome extension v1 for saving visible Google Scholar results into the ResearchAI literature library.
- Added a Google Scholar import API endpoint with extension CORS support.
- Added Google Scholar as an internal literature source label.
- Added Google Scholar jump links to literature result cards.
- Improved literature search ranking with research direction matching, phrase matching, provider reliability, metadata completeness, and publication type quality signals.
- Added a conservative quality score floor so low-quality results are suppressed when enough stronger candidates exist.
- Extended literature search debug output with ranking score breakdowns.
- Reduced literature update timeout risk by defaulting the active online pipeline to OpenAlex, arXiv, and PubMed.
- Made backend literature settings preserve and respect `selectedSources`.
- Parallelized provider fetches and reduced AI reranking load to the top 10 candidates.
- Fixed literature update responses so tracker results show only the current search instead of mixing in previous searches.
- Kept AI analysis limited to top candidates while returning the full current search result set.
- Added a Google Scholar search handoff link from the literature tracker.
- Added project status tracking document.
