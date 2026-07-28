# ResearchGPT Technical Debt

Only active architecture debt is tracked here. Historical issues belong in Git.

| ID | Problem | Impact | Status | Removal condition | Last verified |
|---|---|---|---|---|---|
| TD-001 | Previous-assistant export can preempt a new document request | Wrong content may be exported | Open | `DocumentRequest.source` owns all migrated source decisions and legacy traffic is zero | `97fbfdd` |
| TD-002 | Dedicated DOCX generation rewrites the complete `DocumentSpec` up to four times | Long latency, token waste, unstable output | Migrating | Component generation and local repair cover the SCI DOCX scenario | Working tree |
| TD-003 | Normal chat responses can still be exported as document content | Chat prose can enter formal files | Open | Migrated file actions always enter document v2 | `97fbfdd` |
| TD-004 | `DocumentSpec` is converted to Markdown before DOCX rendering | Renderer compatibility logic can reinterpret approved structure | Migrating | v2 renderer accepts only `FinalDocumentSpec` | Working tree |
| TD-005 | Final images, visual specs, and figure placeholders coexist | Image placement and fallback behavior are ambiguous | Migrating | One ordered figure block and asset contract covers migrated scenarios | Working tree |
| TD-006 | Template identity exists in document and artifact template systems | Template choice can drift downstream | Migrating | One immutable `ResolvedTemplateSnapshot` reaches renderer | Working tree |
| TD-008 | Document-v2 has persistence, control API, and polling UI but no production worker or creation handoff | New lifecycle is not yet user-accessible from chat | Migrating | Add worker and creation handoff, then enable the v2 feature flag for controlled traffic | Working tree |

## Rules

- New document-v2 code must not depend on items TD-001 through TD-006.
- A debt item is removed only with regression or traffic evidence.
- Product behavior deletion, database migration, and production deployment
  require explicit authorization.
