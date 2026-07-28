# SCI Review Word Template v1

This is the authoritative human-readable specification for the
`sci-review@1` system template. The runtime identity is frozen as:

- content profile: `sci_review_v1`;
- rendering profile: `sci_word_v1`;
- output format: DOCX;
- languages: Chinese and English.

The fixed rendering rules are controlled by the template and renderer. AI and
users cannot alter them during ordinary generation.

## Fixed rendering rules

| Area | Fixed rule |
|---|---|
| Page | A4, portrait, one column, white background, top aligned |
| Margins | 20 mm top/bottom, 22 mm left/right, 10 mm header/footer |
| English title | Arial Bold, 22 pt, `#111111`, left, maximum two lines |
| Chinese title | Microsoft YaHei Bold fallback, 22 pt, left |
| English body | Times New Roman, 10 pt, `#222222` |
| Chinese body | SimSun fallback; Latin letters and numbers use Times New Roman |
| Abstract | 9.5 pt, 1.1 line spacing, justified, one paragraph |
| Keywords | 9.5 pt, three to eight values separated by semicolons |
| Heading 1 | Arial Bold, 13 pt, 14 pt before, 5 pt after |
| Heading 2 | Arial Bold, 11 pt, 10 pt before, 4 pt after |
| Heading 3 | Arial Bold, 10 pt, 8 pt before, 3 pt after |
| Heading depth | Maximum three levels |
| Body paragraphs | 1.15 line spacing, justified, no first-line indent, 6 pt after |
| Figure caption | Below image, Arial 8.5 pt, `Fig. 1 | Title.` |
| Figure layout | Centered, inline, locked aspect ratio, no stretch or crop |
| Figure quality | Bitmap minimum 300 dpi; line art prefers SVG or high-resolution PNG |
| Table caption | Above table, Arial 8.5 pt, `Table 1 | Title.` |
| Table | Three-line table, no vertical borders, repeating header |
| Table header | Arial Bold 9 pt, `#F2F2F2` fill |
| Table body | 8.5 pt; numbers right aligned and text left aligned |
| Formula | Cambria Math 10 pt with right-aligned parenthesized numbering |
| References | Numeric first-appearance order, 8.5 pt, single spacing, 0.5 cm hanging indent |
| Page number | Centered footer |
| Pagination | Widow control; headings stay with following text |
| Figure pairing | Image and caption remain on the same page |
| Table pairing | Caption stays with the first table row |
| Word implementation | Named Word Styles; no random per-paragraph font or size overrides |
| Quality gate | Check blank pages, orphan headings, broken captions, numbering, fonts, and distorted images |
| Reference truth | Never invent unverified authors, DOI, venue, or publication metadata |

## AI-owned semantic decisions

AI receives the resolved template structure and generates mature content for
one planned component at a time.

| Content group | AI responsibility |
|---|---|
| Title and subtitle | Generate the scientific title and decide whether a subtitle is necessary |
| Abstract and keywords | Produce the final abstract and select three to eight keywords |
| Section structure | Choose section names, order, count, and justified depth within the three-level limit |
| Section content | Write mature paragraphs and distribute length according to importance |
| Paragraph logic | Organize topic, evidence, interpretation, and conclusion |
| Coherence | Add transitions and maintain terminology and abbreviation consistency |
| Editing | Remove repetition, improve logical order, sentence variety, and academic tone |
| Optional sections | Decide whether Discussion, Limitations, or Future Perspective is needed |
| Conclusion | Produce a conclusion grounded in the completed document |
| Figures | Decide need, type, content, caption, textual cross-reference, and placement |
| Tables | Decide need, comparison dimensions, content, caption, cross-reference, and placement |
| Citations | Identify citation locations and map claims only to verified references |
| Reference order | Follow first appearance in approved content |
| Final semantic QA | Check completeness, context consistency, figure-text consistency, and reference consistency |

AI does not control page geometry, fonts, sizes, colors, Word Style identities,
caption position, numbering format, or pagination rules.

## Required component blueprint

```text
title
-> abstract
-> keywords
-> one to eight sections
-> conclusion
-> verified reference list
```

The planner may expand the repeatable section blueprint but cannot remove
required components or move the reference list away from the final position.

## User-uploaded templates

An uploaded template takes precedence over system-template matching. In the
current framework, its parser must still normalize the upload into the supported
SCI v1 layout, component, and style contract. Unsupported or ambiguous template
features must produce warnings or an explicit rejection; they must not be
silently discarded.
