# Impact Analysis 0034: User-confirmed Web Source Snapshots

## Outcome

Add an intentional web-source acquisition flow for Edit Sessions: search metadata, explicit user selection, bounded immutable snapshot, Evidence ingestion, then model use through the existing Evidence Authorization Service.

## Authority

- Web Search Provider returns discovery metadata only. Search snippets never enter model context.
- User selection authorizes capture, not factual correctness or citation.
- Web Source Service owns search-session/result identity and immutable snapshot metadata.
- Evidence Service remains the sole owner of Evidence Source/Card creation and storage.
- Evidence Authorization Service remains the sole owner of model/reasoning admission and revocation.
- Model Data Gateway sees only confirmed Evidence Source IDs and performs the same per-turn current checks as local files.

## Security and failure policy

Only bounded public HTTPS pages are eligible. Local/private addresses, credentials in URLs, unknown result IDs and expired searches fail closed. The fetch adapter must additionally validate DNS resolution and every redirect against private/reserved networks before opening a connection.

Captured page text is stored as a fixed Evidence artifact with a SHA-256 snapshot hash. Live page changes do not silently alter an existing Candidate. Web snapshots default to no citation permission; reference assembly remains program-owned.

## Scope and rollback

This step defines and verifies the backend workflow with provider/fetcher ports. It does not select a production search vendor, add HTTP routes/UI, apply persistence migrations or enable rollout. Rollback omits web Evidence Source IDs; local Evidence and text-only editing remain unchanged.

