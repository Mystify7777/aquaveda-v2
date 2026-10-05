import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import LearnPage from "@/app/learn/page";
import LearnLoading from "@/app/learn/loading";
import { ApiError } from "@/lib/api/client";
import type { KnowledgeArticle } from "@/lib/api/types/knowledge";

const mockGetKnowledgeList = vi.fn();
vi.mock("@/lib/api/knowledge", () => ({ getKnowledgeList: (q: unknown) => mockGetKnowledgeList(q) }));
// Session-dependent links are covered by learn-workflow-links.test.tsx.
vi.mock("@/components/knowledge/learn-workflow-links", () => ({ LearnWorkflowLinks: () => null }));

function article(n: number): KnowledgeArticle {
  return {
    _id: `k${n}`,
    title: `Article ${n}`,
    body: `Body ${n}`,
    region: "",
    status: "approved",
    author: { _id: "u1", name: "Asha", role: "USER" },
    reviewHistory: [],
    createdAt: "2026-03-05T10:00:00.000Z",
    updatedAt: "2026-03-05T10:00:00.000Z",
  };
}

async function renderPage(sp: { page?: string | string[] } = {}) {
  render(await LearnPage({ searchParams: Promise.resolve(sp) }));
}

describe("/learn", () => {
  beforeEach(() => {
    mockGetKnowledgeList.mockReset();
  });

  it("lists articles as links to detail pages; requests only { page } (no status parameter)", async () => {
    mockGetKnowledgeList.mockResolvedValue({ items: [article(1), article(2)], page: 1, limit: 20, total: 2, totalPages: 1 });
    await renderPage();
    expect(mockGetKnowledgeList).toHaveBeenCalledWith({ page: 1 });
    expect(screen.getByRole("heading", { level: 1, name: "Learn" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Article 1" })).toHaveAttribute("href", "/learn/k1");
    expect(screen.getByRole("link", { name: "Article 2" })).toHaveAttribute("href", "/learn/k2");
    expect(screen.getAllByText(/By Asha/)).toHaveLength(2);
    expect(screen.getAllByText("Mar 5, 2026")).toHaveLength(2);
    // No lifecycle/review controls on the public list.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("authoring entry point: public link to the established draft route", async () => {
    mockGetKnowledgeList.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    await renderPage();
    expect(screen.getByRole("link", { name: "Write an article" })).toHaveAttribute("href", "/learn/new");
  });

  it("empty: copy speaks only of published articles", async () => {
    mockGetKnowledgeList.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    await renderPage();
    expect(screen.getByRole("heading", { name: "No published articles yet" })).toBeInTheDocument();
  });

  it("page past the end: distinct empty state", async () => {
    mockGetKnowledgeList.mockResolvedValue({ items: [], page: 9, limit: 20, total: 3, totalPages: 1 });
    await renderPage({ page: "9" });
    expect(screen.getByRole("link", { name: "Back to first page" })).toHaveAttribute("href", "/learn");
  });

  it("pagination: URL-driven prev/next", async () => {
    mockGetKnowledgeList.mockResolvedValue({ items: [article(1)], page: 2, limit: 1, total: 3, totalPages: 3 });
    await renderPage({ page: "2" });
    expect(screen.getByRole("navigation", { name: "Article pages" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/learn");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/learn?page=3");
  });

  it.each([["abc"], ["0"], ["-2"], ["1.5"]])("invalid page %s falls back to 1", async (raw) => {
    mockGetKnowledgeList.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    await renderPage({ page: raw });
    expect(mockGetKnowledgeList).toHaveBeenCalledWith({ page: 1 });
  });

  it("network failure: alert with retry, no fabricated empty state", async () => {
    mockGetKnowledgeList.mockRejectedValue(new ApiError("Failed to fetch", "network"));
    await renderPage({ page: "2" });
    expect(screen.getByRole("alert")).toHaveTextContent(/unreachable/i);
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/learn?page=2");
    expect(screen.queryByRole("heading", { name: /No published articles/ })).not.toBeInTheDocument();
  });

  it("HTTP failure: generic alert", async () => {
    mockGetKnowledgeList.mockRejectedValue(new ApiError("boom", "http", 500));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load articles/i);
  });

  it("non-API errors propagate to the error boundary", async () => {
    mockGetKnowledgeList.mockRejectedValue(new TypeError("bug"));
    await expect(LearnPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("bug");
  });

  it("loading state is an announced status region", () => {
    render(<LearnLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading articles...");
  });
});
