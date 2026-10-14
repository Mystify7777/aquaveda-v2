import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import IssuePage from "@/app/explore/[issueId]/page";
import { AuthProvider } from "@/components/providers/auth-provider";
import { ApiError } from "@/lib/api/client";
import type { Issue } from "@/lib/api/types/issue";

/**
 * The Issue detail's discussion against the real auth boundary (same
 * approach as the Learn article): real page, AuthProvider session
 * initialization, RequireAuth, CommentComposer, DiscussionComposer; only
 * the network and router are mocked. CommentThread (async Server
 * Component) and the Leaflet map are stubbed.
 */
const mockGetIssue = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockRefreshSession = vi.fn();
const mockCreateComment = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/lib/api/issues", () => ({ getIssue: (id: string) => mockGetIssue(id) }));
vi.mock("@/lib/api/auth", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
  refreshSession: () => mockRefreshSession(),
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
}));
vi.mock("@/lib/api/comments", () => ({ createComment: (p: unknown) => mockCreateComment(p) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/comments/comment-thread", () => ({ CommentThread: () => <p>Existing comment</p> }));
vi.mock("@/components/issues/issue-map-loader", () => ({ IssueMapLoader: () => null }));

const ISSUE: Issue = {
  _id: "i1",
  title: "Burst pipe",
  description: "Water everywhere",
  location: { type: "Point", coordinates: [77.5, 12.9] },
  severity: "",
  category: "",
  domain: "water",
  status: "open",
  reportedBy: { _id: "u1", name: "Asha", role: "USER" },
  statusHistory: [],
  createdAt: "2026-03-05T10:00:00.000Z",
  updatedAt: "2026-03-05T10:00:00.000Z",
};

async function renderIssue() {
  render(<AuthProvider>{await IssuePage({ params: Promise.resolve({ issueId: "i1" }) })}</AuthProvider>);
  await screen.findByRole("heading", { level: 1, name: "Burst pipe" });
}

describe("Issue discussion × auth boundary", () => {
  beforeEach(() => {
    [mockGetIssue, mockGetCurrentUser, mockRefreshSession, mockCreateComment, mockRefresh].forEach((m) => m.mockReset());
    mockGetIssue.mockResolvedValue(ISSUE);
  });

  it("anonymous: issue and thread are public; the composer offers sign-in, never a form", async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    mockRefreshSession.mockRejectedValue(new ApiError("expired", "http", 401, "REFRESH_FAILED"));
    await renderIssue();
    expect(screen.getByText("Existing comment")).toBeInTheDocument();
    expect(await screen.findByText("Sign in to continue with this contribution.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();
    expect(mockCreateComment).not.toHaveBeenCalled();
  });

  it("authenticated: posts an ISSUE comment and refreshes the thread", async () => {
    const user = userEvent.setup();
    mockGetCurrentUser.mockResolvedValue({ id: "u-1", role: "USER" });
    mockCreateComment.mockResolvedValue({ _id: "c1", refType: "ISSUE", refId: "i1", body: "Seen it", parentComment: null });
    await renderIssue();
    await user.type(await screen.findByLabelText("Comment"), "Seen it");
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    expect(await screen.findByText("Comment posted.")).toBeInTheDocument();
    expect(mockCreateComment).toHaveBeenCalledWith({ refType: "ISSUE", refId: "i1", body: "Seen it" });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("401 on post: session message with sign-in; no refresh", async () => {
    const user = userEvent.setup();
    mockGetCurrentUser.mockResolvedValue({ id: "u-1", role: "USER" });
    mockCreateComment.mockRejectedValue(new ApiError("Authentication required", "http", 401, "UNAUTHORIZED"));
    await renderIssue();
    await user.type(await screen.findByLabelText("Comment"), "Hi");
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/session is no longer valid/i);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
