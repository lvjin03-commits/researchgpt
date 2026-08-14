# ADR 0034: Web search results require user-confirmed snapshots

## Decision

Search results are discovery suggestions, not evidence. No result snippet or live URL may enter an Edit Session model call. The user selects up to five results, after which the server captures bounded text, records the requested/final URL and content hash, and delegates artifact/card creation to the existing Evidence Service.

The resulting Evidence Source receives model and reasoning permission but not citation permission. Every later Edit Session turn reuses the existing current-authorization checks; revocation therefore has the same `needs_repair` behavior as local files.

## Consequences

The product gains intentional web assistance without restoring automatic reference invention or introducing a second Evidence model. Search-provider output remains replaceable behind a port, while model context is reproducible from the captured artifact rather than mutable web content.

