import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MyKnowledgeList, ReviewQueueList } from "@/components/knowledge/workflow-list";
import { ApiError } from "@/lib/api/client";
import type { WorkflowKnowledgeSummary } from "@/lib/api/types/knowledge";

const mockMine = vi.fn();
const mockQueue = vi.fn();
vi.mock("@/lib/api/knowledge", () => ({
  getMyKnowledge: (q: unknown) => mockMine(q),
  getReviewQueue: (q: unknown) => mockQueue(q),
}));

function item(n: number, over: Partial<WorkflowKnowledgeSummary> = {}): WorkflowKnowledgeSummary {
  return {
    _id: `k${n}`,
    title: `Article ${n}`,
    region: "",
    status: "draft",
    author: { _id: "u1", name: "Asha", role: "USER" },
    createdAt: "2026-03-05T10:00:00.000Z",
    updatedAt: "2026-03-06T10:00:00.000Z",
    ...over,
  };
}
const pageOf = (items: WorkflowKnowledgeSummary[], over = {}) => ({
  items, page: 1, limit: 20, total: items.length, totalPages: items.length ? 1 : 0, ...over,
});

describe("MyKnowledgeList", () => {
  beforeEach(() => {
    mockMine.mockReset();
    mockQueue.mockReset();
  });

  it("shows a loading status, then every status with a text label, linking to the workflow detail", async () => {
    mockMine.mockResolvedValue(
      pageOf([
        item(1, { status: "draft" }),
        item(2, { status: "pending_review" }),
        item(3, { status: "approved" }),
        item(4, { status: "rejected" }),
      ]),
    );
    render(<MyKnowledgeList page={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your articles...");
    expect(await screen.findByRole("link", { name: "Article 1" })).toHaveAttribute(
      "href",
      "/protected/learn/review/k1",
    );
    expect(mockMine).toHaveBeenCalledWith({ page: 1, status: undefined });
    const list = screen.getByRole("list");
    for (const label of ["Draft", "Pending review", "Approved", "Rejected"]) {
      expect(list).toHaveTextContent(label);
    }
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("passes the status filter to the backend and marks the active filter", async () => {
    mockMine.mockResolvedValue(pageOf([item(1, { status: "rejected" })]));
    render(<MyKnowledgeList page={2} status="rejected" />);
    await screen.findByRole("link", { name: "Article 1" });
    expect(mockMine).toHaveBeenCalledWith({ page: 2, status: "rejected" });
    const nav = screen.getByRole("navigation", { name: "Filter by status" });
    expect(nav).toHaveTextContent("All");
    expect(screen.getByRole("link", { name: "Rejected" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Draft" })).toHaveAttribute("href", "/protected/learn/mine?status=draft");
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/protected/learn/mine");
  });

  it("pagination preserves the active status filter", async () => {
    mockMine.mockResolvedValue(pageOf([item(1)], { page: 2, total: 60, totalPages: 3 }));
    render(<MyKnowledgeList page={2} status="draft" />);
    await screen.findByText("Page 2 of 3");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/protected/learn/mine?status=draft&page=3");
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/protected/learn/mine?status=draft");
  });

  it("empty (no filter): invites writing; empty (filtered): says so; past-the-end: links back", async () => {
    mockMine.mockResolvedValueOnce(pageOf([]));
    const { unmount } = render(<MyKnowledgeList page={1} />);
    expect(await screen.findByRole("heading", { name: "No articles yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Write an article" })).toHaveAttribute("href", "/protected/learn/new");
    unmount();

    mockMine.mockResolvedValueOnce(pageOf([]));
    const filtered = render(<MyKnowledgeList page={1} status="approved" />);
    expect(await screen.findByRole("heading", { name: "No approved articles" })).toBeInTheDocument();
    filtered.unmount();

    mockMine.mockResolvedValueOnce(pageOf([], { page: 9, total: 3, totalPages: 1 }));
    render(<MyKnowledgeList page={9} />);
    expect(await screen.findByRole("link", { name: "Back to first page" })).toHaveAttribute(
      "href",
      "/protected/learn/mine",
    );
  });

  it.each([
    [new ApiError("x", "network"), /unreachable/i, false],
    [new ApiError("x", "http", 401, "UNAUTHORIZED"), /session is no longer valid/i, true],
    [new ApiError("x", "http", 500), /could not load your articles/i, false],
  ])("failure %#: accessible alert, retry refetches", async (error, message, signIn) => {
    const user = userEvent.setup();
    mockMine.mockRejectedValueOnce(error).mockResolvedValueOnce(pageOf([item(1)]));
    render(<MyKnowledgeList page={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(!!screen.queryByRole("link", { name: "Sign in" })).toBe(signIn);
    expect(screen.queryByRole("heading", { name: /No articles yet/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Article 1" })).toBeInTheDocument();
    expect(mockMine).toHaveBeenCalledTimes(2);
  });
});

describe("ReviewQueueList", () => {
  beforeEach(() => {
    mockQueue.mockReset();
  });

  it("fetches the queue and shows pending articles with their author", async () => {
    mockQueue.mockResolvedValue(pageOf([item(1, { status: "pending_review" })]));
    render(<ReviewQueueList page={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading review queue...");
    expect(await screen.findByRole("link", { name: "Article 1" })).toHaveAttribute(
      "href",
      "/protected/learn/review/k1",
    );
    expect(mockQueue).toHaveBeenCalledWith({ page: 1 });
    expect(screen.getByText(/By Asha/)).toBeInTheDocument();
    expect(screen.getByText("Pending review")).toBeInTheDocument();
  });

  it("empty queue", async () => {
    mockQueue.mockResolvedValue(pageOf([]));
    render(<ReviewQueueList page={1} />);
    expect(await screen.findByRole("heading", { name: "The review queue is empty" })).toBeInTheDocument();
  });

  it("pagination links stay under the review route", async () => {
    mockQueue.mockResolvedValue(pageOf([item(1)], { page: 2, total: 60, totalPages: 3 }));
    render(<ReviewQueueList page={2} />);
    await screen.findByText("Page 2 of 3");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/protected/learn/review?page=3");
  });

  it("a backend refusal (403) is rendered, not pre-empted client-side", async () => {
    mockQueue.mockRejectedValue(new ApiError("Forbidden", "http", 403, "FORBIDDEN"));
    render(<ReviewQueueList page={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account is not permitted to view the review queue.");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("network failure and retry", async () => {
    const user = userEvent.setup();
    mockQueue.mockRejectedValueOnce(new ApiError("x", "network")).mockResolvedValueOnce(pageOf([item(1)]));
    render(<ReviewQueueList page={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Article 1" })).toBeInTheDocument());
  });
});
