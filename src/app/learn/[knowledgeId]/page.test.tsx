import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import KnowledgePage from "@/app/learn/[knowledgeId]/page";
import KnowledgeNotFound from "@/app/learn/[knowledgeId]/not-found";
import { ApiError } from "@/lib/api/client";
import type { KnowledgeArticle } from "@/lib/api/types/knowledge";

const mockGetArticle = vi.fn();
vi.mock("@/lib/api/knowledge", () => ({ getKnowledgeArticle: (id: string) => mockGetArticle(id) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
// Async server component and router-bound client pieces are covered by their own tests.
vi.mock("@/components/comments/comment-thread", () => ({
  CommentThread: ({ refType, refId }: { refType: string; refId: string }) => (
    <div data-testid="thread">{`${refType}:${refId}`}</div>
  ),
}));
vi.mock("@/components/comments/discussion-actions", () => ({
  DiscussionComposer: ({ refType, refId }: { refType: string; refId: string }) => (
    <div data-testid="composer">{`${refType}:${refId}`}</div>
  ),
}));

const ARTICLE: KnowledgeArticle = {
  _id: "k1",
  title: "Drip irrigation",
  body: "Line one\nLine two",
  region: "",
  status: "approved",
  author: { _id: "u1", name: "Asha", role: "USER" },
  reviewHistory: [
    { decision: "rejected", reviewer: "r1", feedback: "Needs sources", timestamp: "2026-03-06T10:00:00.000Z" },
    { decision: "approved", reviewer: "r2", timestamp: "2026-03-08T10:00:00.000Z" },
  ],
  createdAt: "2026-03-05T10:00:00.000Z",
  updatedAt: "2026-03-08T10:00:00.000Z",
};

const call = (id = "k1") => KnowledgePage({ params: Promise.resolve({ knowledgeId: id }) });

describe("/learn/[knowledgeId]", () => {
  beforeEach(() => {
    mockGetArticle.mockReset();
  });

  it("renders the approved article with author, dates and body", async () => {
    mockGetArticle.mockResolvedValue(ARTICLE);
    render(await call());
    expect(mockGetArticle).toHaveBeenCalledWith("k1");
    expect(screen.getByRole("heading", { level: 1, name: "Drip irrigation" })).toBeInTheDocument();
    expect(screen.getByText(/By Asha/)).toBeInTheDocument();
    expect(screen.getByText("Mar 5, 2026")).toBeInTheDocument();
    expect(screen.getByText("Mar 8, 2026")).toBeInTheDocument();
    expect(screen.getByText(/Line one/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All articles/ })).toHaveAttribute("href", "/learn");
  });

  it("does not surface rejection feedback or reviewer ids, and offers no review/lifecycle controls", async () => {
    mockGetArticle.mockResolvedValue(ARTICLE);
    render(await call());
    expect(screen.queryByText(/Needs sources/)).not.toBeInTheDocument();
    expect(screen.queryByText(/r2/)).not.toBeInTheDocument();
    for (const name of [/approve/i, /reject/i, /revise/i, /submit/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("mounts the discussion for the WIKI target: thread and composer", async () => {
    mockGetArticle.mockResolvedValue(ARTICLE);
    render(await call());
    expect(screen.getByRole("heading", { level: 2, name: "Discussion" })).toBeInTheDocument();
    expect(screen.getByTestId("thread")).toHaveTextContent("WIKI:k1");
    expect(screen.getByTestId("composer")).toHaveTextContent("WIKI:k1");
  });

  it.each(["draft", "pending_review", "rejected"] as const)(
    "visibility boundary: a %s article is never rendered",
    async (status) => {
      mockGetArticle.mockResolvedValue({ ...ARTICLE, status });
      await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );

  it("404 -> notFound()", async () => {
    mockGetArticle.mockRejectedValue(new ApiError("nf", "http", 404, "NOT_FOUND"));
    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("malformed id (400 VALIDATION_FAILED) -> notFound()", async () => {
    mockGetArticle.mockRejectedValue(new ApiError("bad", "http", 400, "VALIDATION_FAILED"));
    await expect(call("nope")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("VALIDATION_FAILED with a non-400 status is a load error, not not-found", async () => {
    mockGetArticle.mockRejectedValue(new ApiError("odd", "http", 500, "VALIDATION_FAILED"));
    render(await call());
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("network failure: alert with retry to the same article", async () => {
    mockGetArticle.mockRejectedValue(new ApiError("Failed to fetch", "network"));
    render(await call());
    expect(screen.getByRole("alert")).toHaveTextContent(/unreachable/i);
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/learn/k1");
  });

  it("server error: generic alert, not a 404", async () => {
    mockGetArticle.mockRejectedValue(new ApiError("boom", "http", 500));
    render(await call());
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load this article/i);
  });

  it("not-found UI links back to Learn", () => {
    render(<KnowledgeNotFound />);
    expect(screen.getByRole("heading", { name: "Article not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Learn" })).toHaveAttribute("href", "/learn");
  });
});
