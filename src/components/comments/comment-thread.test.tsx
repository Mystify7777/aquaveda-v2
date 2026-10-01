import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { CommentThread } from "@/components/comments/comment-thread";
import { ApiError } from "@/lib/api/client";
import type { Comment } from "@/lib/api/types/comment";

const mockGetThread = vi.fn();
vi.mock("@/lib/api/comments", () => ({ getCommentThread: (t: string, id: string) => mockGetThread(t, id) }));
vi.mock("@/components/comments/discussion-actions", () => ({
  ReplyToggle: ({ parentComment, authorName }: { parentComment: string; authorName: string }) => (
    <button>{`reply:${parentComment}:${authorName}`}</button>
  ),
}));

function comment(id: string, over: Partial<Comment> = {}): Comment {
  return {
    _id: id,
    refType: "WIKI",
    refId: "k1",
    author: { _id: "u1", name: "Asha", role: "USER" },
    body: `Body ${id}`,
    parentComment: null,
    createdAt: "2026-03-05T10:00:00.000Z",
    updatedAt: "2026-03-05T10:00:00.000Z",
    replies: [],
    ...over,
  };
}

const props = { refType: "WIKI", refId: "k1", retryHref: "/learn/k1" } as const;
const renderThread = async () => render(await CommentThread(props));

describe("CommentThread", () => {
  beforeEach(() => {
    mockGetThread.mockReset();
  });

  it("reads the thread by (refType, refId)", async () => {
    mockGetThread.mockResolvedValue([]);
    await renderThread();
    expect(mockGetThread).toHaveBeenCalledWith("WIKI", "k1");
  });

  it("empty: explicit empty text", async () => {
    mockGetThread.mockResolvedValue([]);
    await renderThread();
    expect(screen.getByText("No comments yet. Start the discussion.")).toBeInTheDocument();
  });

  it("renders top-level comments with one nested reply level and a reply control per top-level comment", async () => {
    mockGetThread.mockResolvedValue([
      comment("c1", {
        replies: [comment("c2", { parentComment: "c1", author: { _id: "u2", name: "Ravi", role: "EXPERT" } })],
      }),
      comment("c3"),
    ]);
    await renderThread();
    expect(screen.getByText("Body c1")).toBeInTheDocument();
    const replies = screen.getByRole("list", { name: "Replies to Asha" });
    expect(within(replies).getByText("Body c2")).toBeInTheDocument();
    expect(within(replies).getByText(/Ravi/)).toBeInTheDocument();
    expect(screen.getByText("Body c3")).toBeInTheDocument();
    // Reply control on top-level comments only (reply-to-reply is rejected by the backend).
    expect(screen.getByRole("button", { name: "reply:c1:Asha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "reply:c3:Asha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reply:c2/ })).not.toBeInTheDocument();
  });

  it("network failure: alert with retry", async () => {
    mockGetThread.mockRejectedValue(new ApiError("Failed to fetch", "network"));
    await renderThread();
    expect(screen.getByRole("alert")).toHaveTextContent(/unreachable/i);
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/learn/k1");
  });

  it("HTTP failure: generic alert, not an empty thread", async () => {
    mockGetThread.mockRejectedValue(new ApiError("nf", "http", 404, "TARGET_NOT_FOUND"));
    await renderThread();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load comments/i);
    expect(screen.queryByText(/No comments yet/)).not.toBeInTheDocument();
  });

  it("non-API errors propagate", async () => {
    mockGetThread.mockRejectedValue(new TypeError("bug"));
    await expect(CommentThread(props)).rejects.toThrow("bug");
  });
});
