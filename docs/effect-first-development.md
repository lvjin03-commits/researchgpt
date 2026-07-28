# ResearchGPT Effect-First Development Rules

ResearchGPT development must be judged by the user-visible result, not by whether code was changed.

## Core Rule

Do not say a feature is fixed, finished, deployed, or ready unless the actual user path has been verified.

If verification is incomplete, say exactly what was verified and what still needs a real user-path check.

## Definition of Done

For every user-facing change, complete these steps:

1. Identify the user-visible effect.
   - What should the user click, type, upload, generate, or download?
   - What should be different from before?

2. Identify the execution path.
   - Router: what intent should be detected?
   - Planner: what pipeline should be selected?
   - Tool: what API, renderer, parser, or connector should run?
   - Output: what should the user receive?

3. Verify the actual path.
   - Test through the same entry point the user uses whenever feasible.
   - Do not only test a helper function when the bug appears in the full workflow.

4. Verify the output quality.
   - Open generated files when possible.
   - Inspect exported Word, Excel, PPT, PDF, and image artifacts.
   - Confirm the output is structured, readable, and suitable for the requested task.

5. Check for old-path fallback.
   - Confirm the request did not silently fall back to legacy chat logic.
   - Confirm old compatibility code is not overriding the new pipeline.

6. Report verification honestly.
   - Say "verified with build only" when no user-path test was run.
   - Say "verified by opening generated DOCX" only when that really happened.
   - Do not use vague phrases such as "should work" as a completion claim.

## File Generation Requirements

When changing Word, Excel, PPT, PDF, or image generation:

- The system must not generate a long chat answer first and then paste it into a file.
- The file pipeline must receive structured content, not raw conversational text.
- The generated file must be downloadable.
- The generated file must open in the expected app.
- The content must match the requested document type.
- The title must not be copied directly from the user's command unless the user explicitly asks for that exact title.
- The output must not contain prompt text, tool instructions, Markdown fences, horizontal rules, or placeholder instructions.
- The output must be checked for obvious mojibake, empty sections, and broken formatting.

## Word-Specific Checks

A Word document is not complete unless:

- It opens as a valid `.docx`.
- It has a real title, not the raw user request.
- It has the expected section structure for its document type.
- Headings, paragraphs, lists, and tables are real Word objects.
- It is not a single pasted block of Markdown.
- It does not contain duplicated `Abstract`, `Content`, `Keywords`, or `References` sections.
- The selected style track is actually applied.

## Excel-Specific Checks

An Excel document is not complete unless:

- It opens as a valid `.xlsx`.
- Data is split into meaningful rows and columns.
- It is not a single paragraph pasted into one cell.
- Headers are clear.
- Column widths and wrapping make the sheet readable.
- If the task asks for analysis, the workbook contains the expected tables, formulas, or charts.

## Router and Planner Checks

Router and planner changes must be checked with natural language variations, not only exact keywords.

Examples:

- "帮我生成一份 Word 报告"
- "整理成可以下载的文档"
- "做成 Excel 表格"
- "不要在聊天里写，直接给我文件"
- "为什么这个图和上一个没区别"

The last example is a question, not an image-generation request. If it is routed to image generation, the router failed.

## Regression Rule

When a bug has appeared before, the fix must include a repeatable regression scenario.

Before claiming it is fixed:

- Reproduce the old failure or describe why it cannot be reproduced.
- Apply the fix.
- Run the same scenario again.
- Confirm the old failure no longer appears.

## Final Response Rule

Every completion message after code changes should include:

- What changed.
- What was verified.
- What was not verified.
- Whether deployment or commit was done.

Do not imply stronger verification than actually happened.
