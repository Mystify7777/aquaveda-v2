import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { UserText } from "@/components/content/user-text";
import { IssueCard } from "@/components/issues/issue-card";
import { IssueDetail } from "@/components/issues/issue-detail";
import { KnowledgeArticleView } from "@/components/knowledge/knowledge-article";
import { KnowledgeCard } from "@/components/knowledge/knowledge-card";
import { WorkflowArticleView } from "@/components/knowledge/workflow-article-view";
import type { Issue } from "@/lib/api/types/issue";
import type { KnowledgeArticle, WorkflowKnowledge } from "@/lib/api/types/knowledge";

vi.mock("@/components/issues/issue-map-loader", () => ({
  IssueMapLoader: ({ label }: { label: string }) => <div role="region" aria-label={label} />,
}));

const ACTOR = { _id: "u1", name: "Asha", role: "USER" as const };
const TS = "2026-03-05T10:00:00.000Z";

function issue(description: string): Issue {
  return {
    _id: "i1",
    title: "Burst pipe",
    description,
    location: { type: "Point", coordinates: [77.5, 12.9] },
    severity: "",
    category: "",
    domain: "water",
    status: "open",
    reportedBy: ACTOR,
    statusHistory: [],
    createdAt: TS,
    updatedAt: TS,
  } as Issue;
}
function article(body: string): KnowledgeArticle {
  return {
    _id: "k1", title: "Drip irrigation", body, region: "", status: "approved",
    author: ACTOR, reviewHistory: [], createdAt: TS, updatedAt: TS,
  };
}
function workflow(body: string): WorkflowKnowledge {
  return {
    _id: "k1", title: "Drip irrigation", body, region: "", status: "draft",
    author: ACTOR, reviewHistory: [], createdAt: TS, updatedAt: TS,
  };
}

const SAMPLE =
  "# Overview\nIntro **line**\nsecond *line*\n\n## Steps\n- one\n- two\n\n1. first\n2. second";

/** Content region = everything the policy renders (first .space-y-3 block). */
function contentOf(container: HTMLElement) {
  return container.querySelector("div.space-y-3") as HTMLElement;
}

describe("UserText", () => {
  it("renders paragraphs with line breaks and bulleted/numbered lists", () => {
    const { container } = render(<UserText text={SAMPLE} />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelectorAll("p br")).toHaveLength(1);
    expect(container.querySelector("h2")).toHaveTextContent("Overview");
    expect(container.querySelector("h3")).toHaveTextContent("Steps");
    expect(container.querySelector("p strong")).toHaveTextContent("line");
    expect(container.querySelector("p em")).toHaveTextContent("line");
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(screen.getByText("one")).toBeInTheDocument();
  });

  it("shows a neutral fallback for empty and malformed content", () => {
    for (const bad of ["", "  \n ", null, undefined, 5]) {
      const { container, unmount } = render(<UserText text={bad} />);
      expect(container).toHaveTextContent("No content provided.");
      unmount();
    }
  });

  it("renders heading levels 2-4 and never an h1 (the page title owns it)", () => {
    const { container } = render(<UserText text={"# A\n## B\n### C"} />);
    expect([...container.querySelectorAll("h1,h2,h3,h4")].map((h) => h.tagName)).toEqual(["H2", "H3", "H4"]);
  });

  it("keeps legacy '#1 priority' and '*' text literal with no heading or emphasis elements", () => {
    const { container } = render(<UserText text={"#1 priority\nrate 5 * 6 * 7 and a * b"} />);
    expect(container.querySelector("h1,h2,h3,h4,strong,em")).toBeNull();
    expect(container).toHaveTextContent("#1 priority");
    expect(container).toHaveTextContent("5 * 6 * 7 and a * b");
  });

  it("lets right-to-left text flow per block (dir=auto) and preserves it exactly", () => {
    const ar = "المياه ملوثة في الحي";
    const he = "המים עכורים בשכונה";
    const { container } = render(<UserText text={`# ${ar}\n\n${he}\n\n- ${ar}\n- **${he}**`} />);
    for (const el of container.querySelectorAll("h2, p, li")) expect(el).toHaveAttribute("dir", "auto");
    expect(container.querySelector("h2")?.textContent).toBe(ar);
    expect(container.querySelector("p")?.textContent).toBe(he);
    expect(container.querySelector("li strong")?.textContent).toBe(he);
  });

  it("renders plain legacy text unchanged", () => {
    const { container } = render(<UserText text="Water has been cloudy since Monday." />);
    expect(container).toHaveTextContent("Water has been cloudy since Monday.");
    expect(container.querySelectorAll("ul, ol")).toHaveLength(0);
  });
});

describe("UserText — hostile input stays inert text", () => {
  const PAYLOADS = [
    "<script>window.__pwned = 1</script>",
    '<img src=x onerror="window.__pwned=1">',
    '<a href="javascript:window.__pwned=1">click</a>',
    "[click](javascript:window.__pwned=1)",
    "javascript:window.__pwned=1",
    "data:text/html;base64,PHNjcmlwdD4=",
    '<iframe src="https://evil.example"></iframe>',
    "<svg onload=window.__pwned=1>",
    "- <b>bold</b>\n- <u onmouseover=x>u</u>",
    "&lt;script&gt;",
    "**<script>window.__pwned=1</script>**",
    "*<img src=x onerror=window.__pwned=1>*",
    "# Title <img src=x onerror=window.__pwned=1>",
    "**[x](javascript:window.__pwned=1)**",
    "# <script>window.__pwned=1</script>",
  ];

  it.each(PAYLOADS)("%s creates no elements, attributes or navigation targets", (payload) => {
    const { container } = render(<UserText text={payload} />);
    expect(container.querySelector("script, img, a, iframe, svg, b, u, [onerror], [onload], [onmouseover]")).toBeNull();
    // Whatever was typed is shown literally, minus formatting delimiters.
    const typed = payload.split("\n")[0].replace(/^- /, "").replace(/^#+ /, "").replace(/^\*+|\*+$/g, "");
    expect(container.textContent).toContain(typed);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("does not linkify URLs or render Markdown links", () => {
    const { container } = render(<UserText text={"https://example.com and [x](https://example.com)"} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent("[x](https://example.com)");
  });
});

describe("consistent rendering across Issue and Knowledge surfaces", () => {
  it("Issue detail, public article and workflow article produce identical content markup", () => {
    const a = contentOf(render(<IssueDetail issue={issue(SAMPLE)} />).container);
    const b = contentOf(render(<KnowledgeArticleView article={article(SAMPLE)} />).container);
    const c = contentOf(render(<WorkflowArticleView article={workflow(SAMPLE)} />).container);
    expect(a.innerHTML).toBe(b.innerHTML);
    expect(b.innerHTML).toBe(c.innerHTML);
    expect(a.querySelectorAll("li")).toHaveLength(4);
  });

  it("hostile content is inert on every surface", () => {
    const evil = "<script>window.__pwned=1</script>\n\n- <img src=x onerror=window.__pwned=1>\n- [a](javascript:1)";
    for (const { container } of [
      render(<IssueDetail issue={issue(evil)} />),
      render(<KnowledgeArticleView article={article(evil)} />),
      render(<WorkflowArticleView article={workflow(evil)} />),
    ]) {
      expect(container.querySelector("script, img, iframe, [onerror]")).toBeNull();
      expect(container.querySelector("article a")).toBeNull();
      expect(container).toHaveTextContent("<script>window.__pwned=1</script>");
    }
  });

  it("cards use the same normalization as a single-line preview (no list markers or raw newlines)", () => {
    const issueCard = render(<IssueCard issue={issue("Intro\n\n- a\n- b")} />).container;
    const knowCard = render(<KnowledgeCard article={article("Intro\n\n- a\n- b")} />).container;
    expect(issueCard).toHaveTextContent("Intro a b");
    expect(knowCard).toHaveTextContent("Intro a b");
    expect(issueCard.querySelector("ul, li")).toBeNull();
  });

  it("empty and malformed stored content shows the same fallback everywhere", () => {
    for (const { container } of [
      render(<IssueDetail issue={issue("   ")} />),
      render(<KnowledgeArticleView article={article("")} />),
      render(<WorkflowArticleView article={workflow("\n\n")} />),
    ]) {
      expect(container).toHaveTextContent("No content provided.");
    }
  });
});
