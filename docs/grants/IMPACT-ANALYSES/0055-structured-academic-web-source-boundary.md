# Impact analysis: structured academic sources for Grant web research

## Problem

The active `OpenAIWebSearchProvider` satisfies the general-web Provider port,
but its evidence records are reconstructed from URL citations in an OpenAI
generated research brief. The stored `snippet` is a bounded neighborhood around
the citation, not a publisher or bibliographic abstract, and `publishedAt` is
currently unavailable. Downstream assessment and synthesis therefore receive
secondary explanatory text while the product presents it through the same
record shape used for source evidence. More searches or a stronger synthesis
prompt cannot recover bibliographic facts that never entered the system.

## Authority and scope changes

- A structured academic Provider becomes the authoritative owner for paper
  title, abstract, publication date/year, DOI, venue, author metadata and
  bibliographic provider identity.
- OpenAI native web search remains a separate general-web discovery Provider for
  public institutional, policy and supplementary web information. Its cited
  answer neighborhood is classified as `citation_context`, never `abstract`.
- A metadata-enrichment adapter such as Crossref may fill or verify DOI, venue
  and publication dates. It cannot invent an abstract or replace the academic
  Provider's source identity.
- The existing Grant general-web service continues to own query egress policy,
  pre-dispatch audit, source persistence and observed usage reporting.
- The deterministic trust registry continues to own `qualityTier`; models may
  consume but never assign or upgrade it.
- The existing source assessment, claim binding, overlap validation and Grant
  Assistant answer owners remain in place. Later schema expansion must extend
  these owners rather than add a parallel research-answer pipeline.

## Data provenance requirements

Every evidence-bearing text field must carry a program-owned provenance kind:

- `abstract`: returned by a structured academic or publisher metadata source;
- `citation_context`: bounded text produced around a general-web citation;
- `official_excerpt`: bounded public text returned by an approved official
  source adapter;
- `metadata_only`: title and bibliographic metadata with no evidence text.

The UI and model context must not describe `citation_context` as a paper abstract.
Missing abstracts, dates and quantitative findings remain explicitly missing.
DOI, canonical URL and provider record identity are used for deterministic
deduplication without merging provenance histories.

## Content boundary

This decision does not authorize crawling, downloading or storing paper full
text. The first implementation may use structured abstracts, bibliographic
metadata, publisher-displayed abstract fields and bounded official excerpts.
Any later extraction from article bodies requires a separate impact analysis,
ADR, copyright/retention policy and explicit rollout authorization.

## Migration and compatibility

- Historical `openai_web_search` records remain readable with their existing
  fingerprints and audit history.
- New records require a schema version that distinguishes evidence-text
  provenance. Existing rows are not retroactively relabeled as abstracts.
- Provider composition must be additive at the port level but must have one
  program-owned merge/deduplication owner. No route may independently combine
  academic and general-web results.
- Production behavior remains unchanged until the data contract, migration,
  adapters, composition tests and signed-in effect-first verification are
  complete and separately authorized.

## Verification

- Contract tests reject a general-web citation neighborhood labeled `abstract`.
- Structured academic fixtures preserve title, abstract, year/date, DOI, venue
  and provider identity, including explicit missing values.
- Deduplication fixtures prove that DOI/URL duplicates retain provenance and do
  not appear twice in model context.
- Grounded-claim validation proves that a number must occur in its admitted
  evidence text or be marked unsupported.
- Offline tests are the default; no paid OpenAI call is part of this step.
