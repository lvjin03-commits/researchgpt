# Impact Analysis 0006: Imported structure and editor projection

## User-visible effect

Imported NSFC applications show a nested section tree. Selecting a section
shows that section and its descendants as one continuous editable reading flow,
with a breadcrumb preserving parent context.

## Authority map

| Decision | Authoritative owner |
| --- | --- |
| Whether an imported paragraph is a section heading | Grant DOCX import adapter |
| Canonical parent/child identity and order | Grant Document Model |
| Tree, breadcrumb, and selected-subtree display | Grant presentation projection |
| Formal content writes and concurrent revision checks | Existing Revision Service |

## Boundaries and non-effects

- The canonical grant schema and database are unchanged.
- The UI does not inspect title text to infer hierarchy.
- Chat and Document V2 routes are untouched.
- Original DOCX storage and import confirmation behavior are unchanged.
- Unsupported images and page geometry remain fidelity warnings.

## Rollback

Revert the paragraph classifier and presentation projection. Existing canonical
documents remain valid because their schema is unchanged.

## Verification gates

1. Plain paragraphs inside `报告正文（2026版）` become levels 1–3.
2. Similar numbered paragraphs after `附件信息` are not classified as sections.
3. The left tree follows parent IDs and sibling order, not global order.
4. Selecting a parent shows direct content plus descendants in reading order.
5. Title/block edits still save through revision compare-and-swap.
