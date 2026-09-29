import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommentComposer } from "@/components/comments/comment-composer";
import { ApiError } from "@/lib/api/client";

const mockCreateComment = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("@/lib/api/comments", () => ({ createComment: (p: unknown) => mockCreateComment(p) }));
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

const REF = { refType: "WIKI", refId: "64b7f0f0f0f0f0f0f0f0f0f0" } as const;
const CREATED = { _id: "c1", ...REF, body: "Helpful", parentComment: null };

const box = () => screen.getByLabelText(/^comment/i);
const submit = () => screen.getByRole("button", { name: "Post comment" });

describe("CommentComposer", () => {
  beforeEach(() => {
    mockCreateComment.mockReset();
    mockUseAuth.mockReturnValue({ status: "authenticated" });
  });

  it("authenticated: renders a labelled field and enabled submit", () => {
    render(<CommentComposer {...REF} />);
    expect(box()).toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });

  it("anonymous: shows the sign-in UX, not the composer", () => {
    mockUseAuth.mockReturnValue({ status: "anonymous" });
    render(<CommentComposer {...REF} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.queryByLabelText(/^comment/i)).not.toBeInTheDocument();
  });

  it("required field: shows error, focuses the field, never calls the API", async () => {
    const user = userEvent.setup();
    render(<CommentComposer {...REF} />);
    await user.type(box(), "   ");
    await user.click(submit());
    expect(mockCreateComment).not.toHaveBeenCalled();
    expect(screen.getByText("Comment is required.")).toBeInTheDocument();
    expect(box()).toHaveFocus();
    expect(box()).toHaveAttribute("aria-invalid", "true");
    expect(box()).toHaveAccessibleDescription("Comment is required.");
  });

  it("valid submission sends the exact payload (refType/refId passed through, trimmed body, no parentComment)", async () => {
    const user = userEvent.setup();
    mockCreateComment.mockResolvedValue(CREATED);
    render(<CommentComposer {...REF} />);
    await user.type(box(), "  Helpful  ");
    await user.click(submit());
    expect(mockCreateComment).toHaveBeenCalledTimes(1);
    expect(mockCreateComment).toHaveBeenCalledWith({ ...REF, body: "Helpful" });
    expect(await screen.findByText("Comment posted.")).toBeInTheDocument();
  });

  it("passes parentComment through only when supplied", async () => {
    const user = userEvent.setup();
    mockCreateComment.mockResolvedValue(CREATED);
    render(<CommentComposer refType="ISSUE" refId="i1" parentComment="p1" />);
    await user.type(box(), "Reply");
    await user.click(submit());
    expect(mockCreateComment).toHaveBeenCalledWith({
      refType: "ISSUE",
      refId: "i1",
      body: "Reply",
      parentComment: "p1",
    });
  });

  it("success: offers to write another and resets the field", async () => {
    const user = userEvent.setup();
    mockCreateComment.mockResolvedValue(CREATED);
    render(<CommentComposer {...REF} />);
    await user.type(box(), "Helpful");
    await user.click(submit());
    await user.click(await screen.findByRole("button", { name: "Write another" }));
    expect(box()).toHaveValue("");
  });

  it("pending: disables controls and blocks duplicate submission", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    mockCreateComment.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<CommentComposer {...REF} />);
    await user.type(box(), "Helpful");
    const form = submit().closest("form")!;
    await user.click(submit());
    expect(screen.getByRole("button", { name: "Posting..." })).toBeDisabled();
    expect(form).toHaveAttribute("aria-busy", "true");
    expect(box()).toBeDisabled();
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(mockCreateComment).toHaveBeenCalledTimes(1);
    resolve(CREATED);
    await screen.findByText("Comment posted.");
  });

  it("backend validation failure: shows message, preserves input", async () => {
    const user = userEvent.setup();
    mockCreateComment.mockRejectedValue(new ApiError("body is required", "http", 400, "VALIDATION_FAILED"));
    render(<CommentComposer {...REF} />);
    await user.type(box(), "Helpful");
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("body is required");
    expect(box()).toHaveValue("Helpful");
  });

  it("session failure (401): prompts sign-in", async () => {
    const user = userEvent.setup();
    mockCreateComment.mockRejectedValue(new ApiError("Authentication required", "http", 401, "UNAUTHORIZED"));
    render(<CommentComposer {...REF} />);
    await user.type(box(), "Helpful");
    await user.click(submit());
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(box()).toHaveValue("Helpful");
  });

  it("target not found (404): specific message, no sign-in link", async () => {
    const user = userEvent.setup();
    mockCreateComment.mockRejectedValue(new ApiError("no WIKI document", "http", 404, "TARGET_NOT_FOUND"));
    render(<CommentComposer {...REF} />);
    await user.type(box(), "Helpful");
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be found/i);
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("invalid parent (409): specific message, input preserved, no sign-in link", async () => {
    const user = userEvent.setup();
    mockCreateComment.mockRejectedValue(new ApiError("parentComment p1 does not exist", "http", 409, "INVALID_PARENT"));
    render(<CommentComposer {...REF} parentComment="p1" />);
    await user.type(box(), "Reply");
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The comment you are replying to is no longer available.",
    );
    expect(box()).toHaveValue("Reply");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("network failure: unavailable message (not a session message); retry succeeds", async () => {
    const user = userEvent.setup();
    mockCreateComment.mockRejectedValueOnce(new ApiError("Failed to fetch", "network"));
    mockCreateComment.mockResolvedValueOnce(CREATED);
    render(<CommentComposer {...REF} />);
    await user.type(box(), "Helpful");
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i);
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    await user.click(submit());
    await waitFor(() => expect(screen.getByText("Comment posted.")).toBeInTheDocument());
  });

  it("unexpected failure: generic message, input preserved", async () => {
    const user = userEvent.setup();
    mockCreateComment.mockRejectedValue(new ApiError("boom", "http", 500));
    render(<CommentComposer {...REF} />);
    await user.type(box(), "Helpful");
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not post your comment/i);
    expect(box()).toHaveValue("Helpful");
  });
});
