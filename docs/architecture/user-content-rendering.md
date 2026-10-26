# User-authored content rendering policy

Status: **Locked** with issue #88. Frontend-only; no backend, persistence or API change.

## Content flow (evidence)

- Issue `description` and Knowledge `body` are plain `String`s (`server/src/models/Issue.js`, `Knowledge.js`), validated only as trimmed non-empty strings. Both are entered through `<textarea>`s.
- No Markdown, HTML or rich-text format is declared in the models, validators, API types or docs, and no editor, Markdown or sanitizer dependency exists. Rendering used to be raw React text with `whitespace-pre-wrap`.
- Stored values are never rewritten; the policy is presentation-only, applied at render time.

## Decision

A small, hand-written **Markdown-like subset** (`src/lib/content/user-text.ts`, pure parser) rendered by one component (`src/components/content/user-text.tsx`). Alternatives rejected: a Markdown library + sanitizer (large stack, HTML/link/image surface the product does not need, reinterprets legacy text broadly); pure plain text (cannot meet #88's heading/emphasis criteria).

### Vocabulary

| Syntax | Result | Notes |
|---|---|---|
| `# T`, `## T`, `### T` | `h2`, `h3`, `h4` | Needs one space and text **starting with a letter** (any script). The page title owns `h1`. |
| 2+ lines starting `- `, `* `, `•` | `ul` | A lone marker line stays literal. |
| 2+ lines starting `1. ` / `1) ` | `ol` | Typed numbers ignored; lists never mix kinds. |
| blank line | paragraph break | Single newlines are line breaks. |
| `**text**` | `strong` | Single line, no nesting (content is literal). |
| `*text*` | `em` | Same rules. `_text_` is **not** emphasis (identifiers like `snake_case`). |

Emphasis delimiters need a non-space inside, no letter/digit/underscore/`*` before the opener, and no letter/digit/underscore after the closer. Everything else stays **literal**: `#1 priority`, `#hashtag`, `# 5 houses`, `#### x`, `a * b`, `2*3*4`, `5 * 6`, `**unclosed`, `***x***`, `**a* b`, `snake_case`, spans across lines.

Known behavior change for legacy text: a well-formed `*word*` (or `**word**`) in an existing description now renders as emphasis (the delimiters are consumed). Stored text is unchanged. A `# Title`-style line with a letter-first title becomes a heading.

### Normalization

CRLF/CR → LF; tabs, NBSP and Unicode spaces collapse to one space; line ends trimmed; repeated blank lines collapse.

Removed, and why:
- C0/C1 control characters (except newline) and DEL: non-printing, no text meaning.
- U+202A–202E (bidi embeddings/overrides) and U+2066–2069 (isolates): the "Trojan Source" display-reordering set. Legitimate RTL text gets its direction from the characters themselves; the renderer adds `dir="auto"` per block.
- U+200B (zero-width space) and U+FEFF (BOM): invisible text.

Display consequence: with isolates removed, a mixed run such as an RTL sentence containing an LTR identifier or number follows the standard Unicode bidi algorithm using the block's `dir="auto"` base direction (taken from its first strong character). Neutral punctuation next to an identifier can therefore reorder differently than it would inside an isolate. Authors can pin ordering with the preserved LRM/RLM marks; no in-text isolation is offered by design, because the same controls enable display spoofing.

Preserved: LRM/RLM/ALM (U+200E, U+200F, U+061C), ZWJ/ZWNJ (U+200D/U+200C: emoji sequences, Persian and Indic shaping), and all other Unicode. Tested with Arabic, Hebrew, Persian, Devanagari and mixed-direction text.

## Safety

The renderer emits only React text nodes inside `h2–h4`, `p`, `ul`, `ol`, `li`, `strong`, `em`, `br` and `span`. No `dangerouslySetInnerHTML`, no links or images, so scripts, event-handler attributes and `javascript:`/`data:` URLs are inert literal text. Tests assert this per payload and per surface, and mutation checks (unsafe renderer, loosened heading rule, stripped RTL marks) were confirmed to fail them.

## Surfaces

`IssueDetail`, `KnowledgeArticleView`, `WorkflowArticleView` render `<UserText>`; `IssueCard` / `KnowledgeCard` use `userTextPreview()` (same normalization, markup flattened to one line).

## Known limitations / out of scope

- Project descriptions, Comment bodies, rejection feedback and Expert-application text keep their previous (safe) rendering; they can adopt `<UserText>` later.
- No links/images/code/tables/nesting; adding any needs a contract decision and a sanitizer boundary first.
- Form textareas give no syntax hint and there is no live preview.
- Nested lists are flattened.
