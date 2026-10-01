import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import KnowledgePage from "@/app/learn/[knowledgeId]/page";
import { AuthProvider } from "@/components/providers/auth-provider";
import { ApiError } from "@/lib/api/client";
import type { KnowledgeArticle } from "@/lib/api/types/knowledge";

/**
 * Integration of the public article's discussion with the real auth
 * boundary. Real: the page, AuthProvider (and its session
 * initialization), RequireAuth, CommentComposer, DiscussionComposer,
 * ReplyToggle. Mocked: only the network (`@/lib/api/*`) and the Next
 * router. CommentThread is an async Server Component, which jsdom's
 * client renderer cannot execute (it has its own tests); its stand-in
 * renders one comment with the *real* ReplyToggle so the reply path is
 * exercised through the same auth boundary.
 */

const mockGetArticle = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockRefreshSession = vi.fn();
const mockCreateComment = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/lib/api/knowledge", () => ({ getKnowledgeArticle: (id: string) => mockGetArticle(id) }));
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
vi.mock("@/components/comments/comment-thread", async () => {
  const { ReplyToggle } = await import("@/components/comments/discussion-actions");
  return {
    CommentThread: ({ refType, refId }: { refType: "ISSUE" | "WIKI"; refId: string }) => (
      <div>
        <p>Existing comment</p>
        <ReplyToggle refType={refType} refId={refId} parentComment="c1" authorName="Ravi" />
      </div>
    ),
  };
});

const ARTICLE: KnowledgeArticle = {
  _id: "k1",
  title: "Drip irrigation",
  body: "Body text",
  region: "",
  status: "approved",
  author: { _id: "u-author", name: "Asha", role: "USER" },
  reviewHistory: [],
  createdAt: "2026-03-05T10:00:00.000Z",
  updatedAt: "2026-03-05T10:00:00.000Z",
};

const SESSION_USER = { id: "u-1", role: "USER" };
const CREATED = { _id: "c9", refType: "WIKI", refId: "k1", body: "Hi", parentComment: null };

const signedIn = () => mockGetCurrentUser.mockResolvedValue(SESSION_USER);
const anonymous = () => {
  mockGetCurrentUser.mockResolvedValue(null);
  mockRefreshSession.mockRejectedValue(new ApiError("expired", "http", 401, "REFRESH_FAILED"));
};

async function renderArticle() {
  const ui = await KnowledgePage({ params: Promise.resolve({ knowledgeId: "k1" }) });
  render(<AuthProvider>{ui}</AuthProvider>);
  await screen.findByRole("heading", { level: 1, name: "Drip irrigation" });
}

describe("public article discussion × auth boundary", () => {
  beforeEach(() => {
    [mockGetArticle, mockGetCurrentUser, mockRefreshSession, mockCreateComment, mockRefresh].forEach((m) =>
      m.mockReset(),
    );
    mockGetArticle.mockResolvedValue(ARTICLE);
  });

  it("anonymous: the article and thread are public; the composer offers sign-in/register, never a form", async () => {
    anonymous();
    await renderArticle();
    expect(screen.getByText("Body text")).toBeInTheDocument();
    expect(screen.getByText("Existing comment")).toBeInTheDocument();
    expect(await screen.findAllByText("Sign in to continue with this contribution.")).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/auth/login");
    expect(screen.getAllByRole("link", { name: "Register" })[0]).toHaveAttribute("href", "/auth/register");
    expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();
    expect(mockCreateComment).not.toHaveBeenCalled();
  });

  it("initializing: the article is already visible; the composer is a busy placeholder, not a form", async () => {
    mockGetCurrentUser.mockReturnValue(new Promise(() => {}));
    await renderArticle();
    expect(screen.getByText("Body text")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Checking authentication").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();
  });

  it("authenticated: posts a top-level WIKI comment, shows success, and refreshes the thread", async () => {
    const user = userEvent.setup();
    signedIn();
    mockCreateComment.mockResolvedValue(CREATED);
    await renderArticle();
    await user.type(await screen.findByLabelText("Comment"), "Hi");
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    expect(await screen.findByText("Comment posted.")).toBeInTheDocument();
    expect(mockCreateComment).toHaveBeenCalledWith({ refType: "WIKI", refId: "k1", body: "Hi" });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("authenticated: replying goes through the same boundary and carries parentComment", async () => {
    const user = userEvent.setup();
    signedIn();
    mockCreateComment.mockResolvedValue({ ...CREATED, parentComment: "c1" });
    await renderArticle();
    const toggle = await screen.findByRole("button", { name: "Reply to Ravi" });
    await user.click(toggle);
    // Scope to the reply panel the toggle controls (the main composer also has a "Comment" field).
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    await user.type(within(panel).getByLabelText("Comment"), "Thanks");
    await user.click(within(panel).getByRole("button", { name: "Post comment" }));
    await waitFor(() =>
      expect(mockCreateComment).toHaveBeenCalledWith({
        refType: "WIKI",
        refId: "k1",
        body: "Thanks",
        parentComment: "c1",
      }),
    );
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("anonymous: opening a reply shows sign-in instead of a reply form", async () => {
    const user = userEvent.setup();
    anonymous();
    await renderArticle();
    await user.click(await screen.findByRole("button", { name: "Reply to Ravi" }));
    expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThanOrEqual(2);
  });

  it("session expiring mid-session (401 on post): session message with sign-in, no refresh, no success", async () => {
    const user = userEvent.setup();
    signedIn();
    mockCreateComment.mockRejectedValue(new ApiError("Authentication required", "http", 401, "UNAUTHORIZED"));
    await renderArticle();
    await user.type(await screen.findByLabelText("Comment"), "Hi");
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/session is no longer valid/i);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.queryByText("Comment posted.")).not.toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("auth service unreachable: 'unavailable' alert (not a sign-in prompt), article unaffected", async () => {
    mockGetCurrentUser.mockRejectedValue(new ApiError("Failed to fetch", "network"));
    await renderArticle();
    expect(await screen.findAllByText(/Authentication is unavailable right now/)).not.toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();
    expect(screen.getByText("Body text")).toBeInTheDocument();
  });

  it("session-failure (non-network auth error): 'problem with your session' with sign-in, no form", async () => {
    mockGetCurrentUser.mockRejectedValue(new ApiError("boom", "http", 500));
    await renderArticle();
    expect(await screen.findAllByText(/problem with your session/i)).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/auth/login");
    expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();
    expect(mockCreateComment).not.toHaveBeenCalled();
  });
});
