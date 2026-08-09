# Impact Analysis 0005: DOCX Initial Draft Import

## User-visible effect

The grant workspace document list gains a second entry path: upload an existing
`.docx`, inspect the extracted structure and fidelity warnings, then explicitly
confirm creation of the first canonical revision. Blank-project creation remains
unchanged.

## Authority map

| Decision | Authoritative owner |
| --- | --- |
| Whether a file is an admissible DOCX | Grant DOCX import adapter |
| Extracted semantic body and fidelity warnings | Grant DOCX import adapter |
| Whether the preview becomes formal content | User confirmation |
| Initial canonical IDs, revision and audit event | Existing Revision Service |
| Original binary location | Grant import storage adapter |

The importer does not write canonical content. It returns a draft and a fidelity
report. The existing Revision Service remains the only component that can create
the initial canonical revision.

## Boundaries and non-effects

- No chat route, Document V2 orchestrator, renderer, retry path or canonical
  content model is added or changed.
- Blank grant creation remains available and uses the existing code path.
- The uploaded file is untrusted input. Macro-enabled files, malformed ZIPs,
  oversized archives and unsupported extensions are rejected before parsing.
- Unsupported page-layout features are reported; they are not silently treated
  as editable semantic content.
- A preview never creates a formal grant document. Confirmation reparses the
  same uploaded file server-side before creating the first revision.
- The original DOCX is stored before canonical creation. If canonical creation
  fails, the uploaded object is removed best-effort so no partial project exists.

## Rollback

Remove the upload card and the two import routes. Existing canonical documents
remain readable because imported content uses the existing grant snapshot model.
Stored originals are inert private objects and do not affect the editor.

## Verification gates

1. A real DOCX containing headings, paragraphs, a list and a table produces a
   structured preview.
2. No grant document is created during preview.
3. Confirmation creates revision 1 through the Revision Service and opens it in
   the existing editor.
4. Header/footer or other unsupported layout produces a visible warning.
5. Invalid, macro-enabled and oversized files are rejected without creating a
   project.
6. Blank-project creation, diagnostics and existing document editing regressions
   remain green.
