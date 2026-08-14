# Impact Analysis 0036: explicit Edit Session source controls

The Edit Session UI exposes local upload and academic web search directly beside the instruction box. Local uploads still enter through the existing Evidence Service and require explicit model/reasoning authorization. Web search uses the existing Web Source Service: OpenAlex returns metadata-only candidates, the user selects sources, and only then does the server capture a bounded public snapshot and create an authorized Evidence Card.

No canonical write, patch, revision, evidence-authorization, or model-context authority moves. DNS and redirect checks remain server-side. Rollback removes the two UI controls and routes; existing evidence and snapshots remain ordinary auditable project sources.
