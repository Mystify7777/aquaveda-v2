import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DiscussionComposer, ReplyToggle } from "@/components/comments/discussion-actions";

const mockRefresh = vi.fn();
const mockCreateComment = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/api/comments", () => ({ createComment: (p: unknown) => mockCreateComment(p) }));
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

const CREATED = { _id: "c9", refType: "WIKI", refId: "k1", body: "Hi", parentComment: null };

describe("discussion actions", () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    mockCreateComment.mockReset();
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue({ status: "authenticated" });
  });

  it("DiscussionComposer posts a top-level WIKI comment and refreshes the thread", async () => {
    const user = userEvent.setup();
    mockCreateComment.mockResolvedValue(CREATED);
    render(<DiscussionComposer refType="WIKI" refId="k1" />);
    await user.type(screen.getByLabelText("Comment"), "Hi");
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    await screen.findByText("Comment posted.");
    expect(mockCreateComment).toHaveBeenCalledWith({ refType: "WIKI", refId: "k1", body: "Hi" });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("DiscussionComposer: anonymous sees the established sign-in UX, not the form", () => {
    mockUseAuth.mockReturnValue({ status: "anonymous" });
    render(<DiscussionComposer refType="WIKI" refId="k1" />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();
  });

  it("DiscussionComposer: a failed post does not refresh", async () => {
    const user = userEvent.setup();
    const { ApiError } = await import("@/lib/api/client");
    mockCreateComment.mockRejectedValue(new ApiError("boom", "http", 500));
    render(<DiscussionComposer refType="WIKI" refId="k1" />);
    await user.type(screen.getByLabelText("Comment"), "Hi");
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    await screen.findByRole("alert");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("ReplyToggle: disclosure with aria-expanded; reply carries parentComment and refreshes", async () => {
    const user = userEvent.setup();
    mockCreateComment.mockResolvedValue({ ...CREATED, parentComment: "c1" });
    render(<ReplyToggle refType="WIKI" refId="k1" parentComment="c1" authorName="Asha" />);
    const toggle = screen.getByRole("button", { name: "Reply to Asha" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.type(screen.getByLabelText("Comment"), "Reply");
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    await screen.findByText("Comment posted.");
    expect(mockCreateComment).toHaveBeenCalledWith({
      refType: "WIKI",
      refId: "k1",
      body: "Reply",
      parentComment: "c1",
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("ReplyToggle: toggling closed removes the composer", async () => {
    const user = userEvent.setup();
    render(<ReplyToggle refType="WIKI" refId="k1" parentComment="c1" authorName="Asha" />);
    await user.click(screen.getByRole("button", { name: "Reply to Asha" }));
    expect(screen.getByLabelText("Comment")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reply to Asha" }));
    expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();
  });
});
