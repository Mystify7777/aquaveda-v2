/**
 * Presentation policy for user-authored text (Issue descriptions, Knowledge
 * bodies; issue #88). Pure; never mutates or re-persists the stored value.
 *
 * Contract evidence: both fields are plain `String`s entered via `<textarea>`
 * and trimmed by Zod; no format is declared in the models/API. The policy is a
 * small, explicit, Markdown-LIKE subset, chosen so that ordinary plain text
 * renders unchanged and ambiguous input stays literal:
 *
 *  Blocks (recognised by line shape, after whitespace normalization)
 *  - heading: `#`, `##` or `###`, one space, then text that STARTS WITH A LETTER
 *    → levels 2/3/4 (the page title owns h1). `#1 priority` (no space) and
 *    `# 5 houses` (digit first) stay literal.
 *  - lists: two or more consecutive lines starting `- `, `* `, `•` (bulleted) or
 *    `1. ` / `1) ` (numbered; typed numbers ignored). A lone marker line stays
 *    literal.
 *  - paragraphs: everything else; blank lines separate, single newlines are
 *    line breaks.
 *
 *  Inline (within one line; no nesting, never spans lines)
 *  - `**strong**` and `*emphasis*` only; span content is literal text, so
 *    `**a *b* c**` is strong with literal inner asterisks. Opener must be
 *    followed by a non-space and not preceded by a letter/digit/underscore/`*`;
 *    closer must follow a
 *    non-space and not be followed by a letter/digit/underscore. Unmatched,
 *    empty, spaced (`a * b`), intraword (`2*3*4`), `***x***` and `_x_` are literal.
 *
 *  Normalization
 *  - CRLF/CR → LF; tabs (never deleted: `north<TAB>water` → `north water`), NBSP and other Unicode spaces and space runs collapse
 *    to one space; line ends are trimmed; repeated blank lines collapse.
 *  - Removed: C0/C1 control characters (except newline), bidirectional
 *    embeddings/overrides U+202A–202E and isolates U+2066–2069 (the "Trojan
 *    Source" display-spoofing set; direction of real RTL text comes from the
 *    characters themselves and `dir="auto"` in the renderer), zero-width space
 *    U+200B and BOM U+FEFF (invisible text).
 *  - Preserved: LRM/RLM/ALM marks (U+200E/200F/061C), ZWJ/ZWNJ (U+200D/200C:
 *    emoji sequences, Persian/Indic shaping) and all other Unicode text.
 *
 * Not supported: links, images, code, tables, HTML, nested formatting. Text is
 * only ever turned into React text nodes by the renderer, so markup-looking
 * input (`<script>`, `javascript:`) stays inert literal text.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string };

export type TextBlock =
  | { type: "heading"; level: 2 | 3 | 4; content: Inline[] }
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

// Tab (U+0009) is intentionally NOT here: it is whitespace, handled by SPACES.
const REMOVED = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const SPACES = /[ \t\u00A0\u2000-\u200A\u202F\u205F\u3000]+/g;
const BULLET = /^[-*•]\s+(\S.*)$/;
const NUMBERED = /^\d{1,3}[.)]\s+(\S.*)$/;
const HEADING = /^(#{1,3})\s+(\p{L}.*)$/u;
const WORD = /[\p{L}\p{N}_]/u;
const SPACE = /\s/;

function normalizeLines(input: string): string[] {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(REMOVED, "")
    .split("\n")
    .map((line) => line.replace(SPACES, " ").trim());
}

const isWord = (ch: string | undefined) => ch !== undefined && WORD.test(ch);
const isSpace = (ch: string | undefined) => ch !== undefined && SPACE.test(ch);

/** Index of the closing delimiter for an opener at `open`, or -1. */
function findCloser(line: string, open: number, delimiter: "*" | "**"): number {
  const len = delimiter.length;
  for (let j = open + len + 1; j < line.length; j++) {
    if (!line.startsWith(delimiter, j)) continue;
    const before = line[j - 1];
    const after = line[j + len];
    if (isSpace(before) || before === "*") continue;
    if (after === "*" || isWord(after)) continue;
    const inner = line.slice(open + len, j);
    // Content may not contain the delimiter character (no nesting/ambiguity).
    if (delimiter === "*" ? inner.includes("*") : inner.includes("**")) return -1;
    return j;
  }
  return -1;
}

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ type: "text", text: buffer });
    buffer = "";
  };

  for (let i = 0; i < line.length; ) {
    if (line[i] === "*" && line[i - 1] !== "*" && !isWord(line[i - 1])) {
      const strong = line.startsWith("**", i);
      const delimiter = strong ? "**" : "*";
      const next = line[i + delimiter.length];
      if (next !== undefined && !isSpace(next) && next !== "*") {
        const close = findCloser(line, i, delimiter);
        if (close > i) {
          flush();
          out.push({
            type: strong ? "strong" : "em",
            text: line.slice(i + delimiter.length, close),
          });
          i = close + delimiter.length;
          continue;
        }
      }
    }
    buffer += line[i];
    i++;
  }
  flush();
  return out;
}

type Marker = { ordered: boolean; text: string } | null;

function markerOf(line: string): Marker {
  const bullet = BULLET.exec(line);
  if (bullet) return { ordered: false, text: bullet[1] };
  const numbered = NUMBERED.exec(line);
  if (numbered) return { ordered: true, text: numbered[1] };
  return null;
}

export function parseUserText(input: unknown): TextBlock[] {
  if (typeof input !== "string") return [];

  const blocks: TextBlock[] = [];
  let paragraph: Inline[][] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", lines: paragraph });
    paragraph = [];
  };

  const lines = normalizeLines(input);
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (line === "") {
      flushParagraph();
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: (heading[1].length + 1) as 2 | 3 | 4,
        content: parseInline(heading[2]),
      });
      i++;
      continue;
    }

    const first = markerOf(line);
    if (first) {
      const items = [first.text];
      let j = i + 1;
      while (j < lines.length) {
        const next = markerOf(lines[j]);
        if (!next || next.ordered !== first.ordered) break;
        items.push(next.text);
        j++;
      }
      if (items.length >= 2) {
        flushParagraph();
        blocks.push({ type: "list", ordered: first.ordered, items: items.map(parseInline) });
        i = j;
        continue;
      }
    }
    paragraph.push(parseInline(line));
    i++;
  }
  flushParagraph();
  return blocks;
}

const inlineText = (inline: Inline[]) => inline.map((part) => part.text).join("");

/** Single-line preview for cards: same normalization; markup and structure flattened. */
export function userTextPreview(input: unknown): string {
  return parseUserText(input)
    .flatMap((block) => {
      if (block.type === "heading") return [inlineText(block.content)];
      if (block.type === "paragraph") return block.lines.map(inlineText);
      return block.items.map(inlineText);
    })
    .join(" ");
}
