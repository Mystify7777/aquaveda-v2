import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import IssuePage from "@/app/explore/[issueId]/page";
import IssueNotFound from "@/app/explore/[issueId]/not-found";
import { ApiError } from "@/lib/api/client";
import type { Issue } from "@/lib/api/types/issue";

const mockGetIssue = vi.fn();
vi.mock("@/lib/api/issues", () => ({ getIssue: (id: string) => mockGetIssue(id) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/issues/issue-map-loader", () => ({
  IssueMapLoader: ({ label }: { label: string }) => <div role="region" aria-label={label} />,
}));
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

const ISSUE: Issue = {
  _id: "i1",
  title: "Burst pipe",
  description: "Water everywhere",
  location: { type: "Point", coordinates: [77.5, 12.9] },
  severity: "",
  category: "",
  domain: "water",
  status: "acknowledged",
  reportedBy: { _id: "u1", name: "Asha", role: "USER" },
  statusHistory: [],
  createdAt: "2026-03-05T10:00:00.000Z",
  updatedAt: "2026-03-05T10:00:00.000Z",
};
const call = (id = "i1") => IssuePage({ params: Promise.resolve({ issueId: id }) });

describe("/explore/[issueId]", () => {
  beforeEach(() => {
    mockGetIssue.mockReset();
  });

  it("anonymous: renders the public issue detail with a way back", async () => {
    mockGetIssue.mockResolvedValue(ISSUE);
    render(await call());
    expect(mockGetIssue).toHaveBeenCalledWith("i1");
    expect(screen.getByRole("heading", { level: 1, name: "Burst pipe" })).toBeInTheDocument();
    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All issues/ })).toHaveAttribute("href", "/explore");
  });

  it("mounts the ISSUE discussion: thread and composer", async () => {
    mockGetIssue.mockResolvedValue(ISSUE);
    render(await call());
    expect(screen.getByRole("heading", { level: 2, name: "Discussion" })).toBeInTheDocument();
    expect(screen.getByTestId("thread")).toHaveTextContent("ISSUE:i1");
    expect(screen.getByTestId("composer")).toHaveTextContent("ISSUE:i1");
  });

  it("404 -> notFound()", async () => {
    mockGetIssue.mockRejectedValue(new ApiError("nf", "http", 404, "NOT_FOUND"));
    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("malformed id (400 VALIDATION_FAILED) -> notFound()", async () => {
    mockGetIssue.mockRejectedValue(new ApiError("bad", "http", 400, "VALIDATION_FAILED"));
    await expect(call("nope")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("VALIDATION_FAILED with a non-400 status is a load error, not not-found", async () => {
    mockGetIssue.mockRejectedValue(new ApiError("odd", "http", 500, "VALIDATION_FAILED"));
    render(await call());
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("network failure: alert with retry to the same issue", async () => {
    mockGetIssue.mockRejectedValue(new ApiError("Failed to fetch", "network"));
    render(await call());
    expect(screen.getByRole("alert")).toHaveTextContent(/unreachable/i);
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/explore/i1");
  });

  it("server error: generic alert, not a 404", async () => {
    mockGetIssue.mockRejectedValue(new ApiError("boom", "http", 500));
    render(await call());
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load this issue/i);
  });

  it("not-found UI links back to Explore", () => {
    render(<IssueNotFound />);
    expect(screen.getByRole("heading", { name: "Issue not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Explore" })).toHaveAttribute("href", "/explore");
  });
});
