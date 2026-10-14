import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import MyKnowledgePage from "@/app/(protected)/learn/mine/page";
import ReviewQueuePage from "@/app/(protected)/learn/review/page";
import WorkflowArticlePage from "@/app/(protected)/learn/review/[id]/page";

vi.mock("@/components/knowledge/workflow-list", () => ({
  MyKnowledgeList: ({ page, status }: { page: number; status?: string }) => (
    <div data-testid="mine">{`${page}|${status ?? ""}`}</div>
  ),
  ReviewQueueList: ({ page }: { page: number }) => <div data-testid="queue">{`${page}`}</div>,
}));
vi.mock("@/components/knowledge/workflow-article", () => ({
  WorkflowArticle: ({ knowledgeId }: { knowledgeId: string }) => <div data-testid="article">{knowledgeId}</div>,
}));

describe("protected learn pages parse the URL and hand off to client components", () => {
  it.each([
    [{}, "1|"],
    [{ page: "3", status: "rejected" }, "3|rejected"],
    [{ page: "abc", status: "published" }, "1|"],
    [{ page: "0" }, "1|"],
    [{ page: ["2", "5"], status: ["draft"] }, "2|draft"],
  ])("/mine %j -> %s", async (sp, expected) => {
    render(await MyKnowledgePage({ searchParams: Promise.resolve(sp) }));
    expect(screen.getByTestId("mine")).toHaveTextContent(expected);
    expect(screen.getByRole("heading", { level: 1, name: "My articles" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Write an article" })).toHaveAttribute("href", "/learn/new");
  });

  it.each([[{}, "1"], [{ page: "4" }, "4"], [{ page: "-1" }, "1"]])("/review %j -> %s", async (sp, expected) => {
    render(await ReviewQueuePage({ searchParams: Promise.resolve(sp) }));
    expect(screen.getByTestId("queue")).toHaveTextContent(expected);
    expect(screen.getByRole("heading", { level: 1, name: "Review queue" })).toBeInTheDocument();
  });

  it("/review/[id] passes the id through and links back to My articles", async () => {
    render(await WorkflowArticlePage({ params: Promise.resolve({ id: "abc123" }) }));
    expect(screen.getByTestId("article")).toHaveTextContent("abc123");
    expect(screen.getByRole("link", { name: /My articles/ })).toHaveAttribute("href", "/learn/mine");
  });
});
