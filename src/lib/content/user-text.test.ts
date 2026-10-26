import { describe, it, expect } from "vitest";

import { parseInline, parseUserText, userTextPreview, type Inline, type TextBlock } from "@/lib/content/user-text";

/** Compact, readable form: text as-is, strong → «…», emphasis → ‹…›. */
const show = (inline: Inline[]) =>
  inline.map((p) => (p.type === "strong" ? `«${p.text}»` : p.type === "em" ? `‹${p.text}›` : p.text)).join("");

function view(blocks: TextBlock[]) {
  return blocks.map((b) => {
    if (b.type === "heading") return { h: b.level, t: show(b.content) };
    if (b.type === "paragraph") return { p: b.lines.map(show) };
    return { [b.ordered ? "ol" : "ul"]: b.items.map(show) };
  });
}
const parse = (s: unknown) => view(parseUserText(s));

describe("blocks", () => {
  it("splits paragraphs on blank lines and keeps single newlines as line breaks", () => {
    expect(parse("Line one\nLine two\n\nSecond paragraph")).toEqual([
      { p: ["Line one", "Line two"] },
      { p: ["Second paragraph"] },
    ]);
  });

  it("recognises bulleted lists (-, *, •) of two or more items", () => {
    for (const marker of ["-", "*", "•"]) {
      expect(parse(`${marker} one\n${marker} two`)).toEqual([{ ul: ["one", "two"] }]);
    }
  });

  it("recognises numbered lists (1. / 1)) and ignores the typed numbers", () => {
    expect(parse("1. first\n3) second\n7. third")).toEqual([{ ol: ["first", "second", "third"] }]);
  });

  it("separates paragraph, list and paragraph without blank lines; never mixes list kinds", () => {
    expect(parse("Steps:\n- a\n- b\nThanks")).toEqual([{ p: ["Steps:"] }, { ul: ["a", "b"] }, { p: ["Thanks"] }]);
    expect(parse("- a\n- b\n1. c\n2. d")).toEqual([{ ul: ["a", "b"] }, { ol: ["c", "d"] }]);
  });

  it("keeps a lone marker line as literal text (no single-item lists)", () => {
    expect(parse("- only one")).toEqual([{ p: ["- only one"] }]);
    expect(parse("2024. was a drought year")).toEqual([{ p: ["2024. was a drought year"] }]);
  });
});

describe("headings", () => {
  it("maps #, ##, ### to levels 2, 3, 4 (the page title owns h1)", () => {
    expect(parse("# Overview\n## Causes\n### Detail")).toEqual([
      { h: 2, t: "Overview" },
      { h: 3, t: "Causes" },
      { h: 4, t: "Detail" },
    ]);
  });

  it("ends the preceding paragraph and starts a new one without blank lines", () => {
    expect(parse("Intro\n## Causes\nBody text")).toEqual([
      { p: ["Intro"] },
      { h: 3, t: "Causes" },
      { p: ["Body text"] },
    ]);
  });

  it("supports non-Latin heading text (Devanagari, Arabic, Hebrew)", () => {
    expect(parse("# पानी की समस्या")).toEqual([{ h: 2, t: "पानी की समस्या" }]);
    expect(parse("## مشكلة المياه")).toEqual([{ h: 3, t: "مشكلة المياه" }]);
    expect(parse("# בעיית מים")).toEqual([{ h: 2, t: "בעיית מים" }]);
  });

  it("keeps ambiguous legacy text literal", () => {
    for (const legacy of [
      "#1 priority",
      "#hashtag",
      "# 5 houses affected",
      "#",
      "# ",
      "#### too deep",
      "####",
      "Ward #4 is dry",
      "##no space",
    ]) {
      const blocks = parseUserText(legacy);
      expect(blocks.every((b) => b.type === "paragraph"), legacy).toBe(true);
    }
    expect(parse("#1 priority")).toEqual([{ p: ["#1 priority"] }]);
  });

  it("allows emphasis inside heading text", () => {
    expect(parse("# Very *urgent* issue")).toEqual([{ h: 2, t: "Very ‹urgent› issue" }]);
  });
});

describe("inline emphasis", () => {
  const i = (s: string) => show(parseInline(s));

  it("renders **strong** and *emphasis*, including several per line", () => {
    expect(i("a **bold** and *italic* b")).toBe("a «bold» and ‹italic› b");
    expect(i("**one** **two** *three*")).toBe("«one» «two» ‹three›");
    expect(i("*note*")).toBe("‹note›");
    expect(i("(**bold**)")).toBe("(«bold»)");
    expect(i("*a*, *b*.")).toBe("‹a›, ‹b›.");
  });

  it("supports non-Latin emphasis content", () => {
    expect(i("यह **जरूरी** है")).toBe("यह «जरूरी» है");
    expect(i("هذا *مهم* جدا")).toBe("هذا ‹مهم› جدا");
  });

  it("leaves malformed or ambiguous delimiters literal", () => {
    for (const literal of [
      "**unclosed",
      "*unclosed",
      "unopened**",
      "unopened*",
      "a * b * c",
      "a ** b ** c",
      "2*3*4",
      "5 * 6",
      "****",
      "**",
      "*",
      "** **",
      "* *",
      "**a *",
      "***x***",
      "_x_ and __y__",
      "snake_case_name",
      "*a **b",
      "**a* b",
    ]) {
      expect(i(literal), literal).toBe(literal);
    }
  });

  it("does not nest or span lines", () => {
    // Content of a span is literal text: inner asterisks are not re-parsed.
    expect(i("**bold *inner* bold**")).toBe("«bold *inner* bold»");
    expect(parse("**start\nend**")).toEqual([{ p: ["**start", "end**"] }]);
  });

  it("is deterministic (same input, same output)", () => {
    const s = "a **b** *c* **d";
    expect(parseInline(s)).toEqual(parseInline(s));
  });

  it("applies inside list items and mixes with other formatting", () => {
    expect(parse("# Title\nIntro with **bold**.\n\n- *one*\n- **two**\n\nEnd")).toEqual([
      { h: 2, t: "Title" },
      { p: ["Intro with «bold»."] },
      { ul: ["‹one›", "«two»"] },
      { p: ["End"] },
    ]);
  });

  it("does not treat list markers as emphasis, nor emphasis as a list marker", () => {
    expect(parse("* one\n* two")).toEqual([{ ul: ["one", "two"] }]);
    expect(parse("*one*\n*two*")).toEqual([{ p: ["‹one›", "‹two›"] }]);
  });
});

describe("normalization", () => {
  it("normalizes CRLF/CR, tabs, NBSP, space runs and line-end whitespace", () => {
    expect(parse("a  \t b\r\nc\u00A0\u00A0d   \r\r\re")).toEqual([{ p: ["a b", "c d"] }, { p: ["e"] }]);
  });

  it("turns a tab between words into a space instead of deleting it", () => {
    expect(parse("north\twater")).toEqual([{ p: ["north water"] }]);
    expect(parse("a\t\tb\t\nc\t")).toEqual([{ p: ["a b", "c"] }]);
    expect(parse("\t- a\n\t- b")).toEqual([{ ul: ["a", "b"] }]);
  });

  it("collapses repeated blank lines and trims leading/trailing blanks", () => {
    expect(parse("\n\n  a\n\n\n\n   \nb\n\n")).toEqual([{ p: ["a"] }, { p: ["b"] }]);
  });

  it("strips control characters, bidi embeddings/overrides/isolates, zero-width space and BOM", () => {
    expect(parse("a\u0000b\u202Ec\u202Ad\u2066e\u2069f\u200Bg\uFEFFh\u0007i")).toEqual([{ p: ["abcdefghi"] }]);
  });

  it("keeps non-Latin text and emoji (including ZWJ sequences) intact", () => {
    expect(parse("पानी की समस्या 👩‍🌾")).toEqual([{ p: ["पानी की समस्या 👩‍🌾"] }]);
  });

  it("returns no blocks for empty, whitespace-only and non-string input", () => {
    for (const input of ["", "   \n\t\n ", null, undefined, 42, {}, ["a"]]) {
      expect(parseUserText(input)).toEqual([]);
    }
  });
});

describe("right-to-left and joiner preservation", () => {
  const ARABIC = "المياه ملوثة في الحي رقم 12";
  const HEBREW = "המים עכורים בשכונה 12";
  const PERSIAN_ZWNJ = "می\u200Cخواهم"; // U+200C is meaningful in Persian
  const RLM = "\u200FText with RLM\u200F";
  const LRM = "abc\u200E";
  const ALM = "\u061Cabc";
  const MIXED = "Ward 7 (القاهرة) is dry — الماء مقطوع";

  it("preserves Arabic, Hebrew and mixed-direction text byte-for-byte", () => {
    for (const text of [ARABIC, HEBREW, MIXED]) {
      expect(parse(text), text).toEqual([{ p: [text] }]);
    }
  });

  it("preserves ZWNJ/ZWJ and the LRM/RLM/ALM direction marks", () => {
    for (const text of [PERSIAN_ZWNJ, RLM, LRM, ALM, "क्\u200Dष"]) {
      expect(parse(text), JSON.stringify(text)).toEqual([{ p: [text] }]);
    }
  });

  it("formats RTL content the same way as LTR (lists, headings, emphasis)", () => {
    expect(parse(`# ${ARABIC}\n- ${HEBREW}\n- **${ARABIC}**`)).toEqual([
      { h: 2, t: ARABIC },
      { ul: [HEBREW, `«${ARABIC}»`] },
    ]);
  });

  it("mixed RTL text with LTR identifiers/numbers: isolates are dropped, text and RLM/LRM kept", () => {
    // FSI/LRI/RLI … PDI wrappers are removed; the visible characters are untouched.
    expect(parse("الطلب \u2068ID-4021\u2069 جاهز")).toEqual([{ p: ["الطلب ID-4021 جاهز"] }]);
    expect(parse("המשלוח \u2066A-12/b\u2069 הגיע ב-\u20673.5\u2069%")).toEqual([{ p: ["המשלוח A-12/b הגיע ב-3.5%"] }]);
    // Authors who need explicit ordering can still use the preserved marks.
    const withMarks = "الطلب ID-4021\u200F (جاهز)\u200F";
    expect(parse(withMarks)).toEqual([{ p: [withMarks] }]);
  });

  it("still removes the override/embedding/isolate controls inside RTL text", () => {
    expect(parse(`${ARABIC.slice(0, 5)}\u202E${ARABIC.slice(5)}\u2067`)).toEqual([{ p: [ARABIC] }]);
  });
});

describe("userTextPreview", () => {
  it("flattens headings, paragraphs, lists and strips emphasis markers into one line", () => {
    expect(userTextPreview("# Head\nIntro **bold**\n\n- a\n- *b*\n\n\nEnd")).toBe("Head Intro bold a b End");
  });
  it("keeps literal legacy markers and is empty for empty or malformed input", () => {
    expect(userTextPreview("#1 priority *")).toBe("#1 priority *");
    expect(userTextPreview("  ")).toBe("");
    expect(userTextPreview(undefined)).toBe("");
  });
});
