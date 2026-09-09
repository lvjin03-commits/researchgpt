# ADR 0044: Google Custom Search adapter boundary

## Status
Accepted as step 6 offline implementation; production composition is disabled.

## Decision
General web search uses a separate Google Custom Search JSON API adapter. It
accepts only a currently approved egress decision, requests at most ten webpage
results with SafeSearch active, and parses only title, URL, bounded snippet and
provider record ID. It never fetches result pages or stores page bodies.

The application service writes the document-scoped egress audit before provider
dispatch, then converts provider results into the canonical source record using
the program-owned trust registry. Audit failure fails closed. Malformed results
and duplicate public-content fingerprints are discarded. Provider errors have
stable categories; secret values and rejected response bodies are not logged.

This adapter does not replace or expand OpenAlex. It is not composed into a
route, does not have production credentials, and cannot execute until audit
persistence, telemetry/price migrations, configuration and rollout are approved.

The endpoint and request parameters follow Google's official Custom Search JSON
API `cse.list` contract: GET `https://customsearch.googleapis.com/customsearch/v1`
with `key`, `cx`, `q`, and `num` between 1 and 10.
