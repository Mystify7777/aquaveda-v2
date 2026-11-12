import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AttentionQueue } from "@/components/expert/attention-queue";
import { ApiError } from "@/lib/api/client";
import type { AttentionQueueItem, AttentionQueuePage } from "@/lib/api/types/issue-attention";

const mockFetch = vi.fn();
const mockPush = vi.fn();
const mockSearchParams = vi.fn();
vi.mock("@/lib/api/issue-attention", () => ({
  getIssueAttentionQueue: (query: unknown, init: unknown) => mockFetch(query, init),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams(),
  useRouter: () => ({ push: mockPush }),
}));

const item = (id: string, over: Partial<AttentionQueueItem> = {}): AttentionQueueItem => ({
  _id: id,
  title: `Issue ${id}`,
  category: "water_quality",
  severity: "high",
  status: "open",
  nextAction: "awaiting_acknowledgement",
  waitingSince: "2026-05-01T10:00:00.000Z",
  responsibility: "none",
  ...over,
});
const page = (
  queue: AttentionQueuePage["queue"],
  items: AttentionQueueItem[],
  over: Partial<AttentionQueuePage> = {},
): AttentionQueuePage => ({
  queue, items, page: 1, limit: 20, total: items.length, totalPages: items.length ? 1 : 0, ...over,
});
const params = (values: Record<string, string> = {}) => new URLSearchParams(values);

beforeEach(() => {
  mockFetch.mockReset();
  mockPush.mockReset();
  mockSearchParams.mockReset().mockReturnValue(params());
});

describe("AttentionQueue", () => {
  it("loads the default queue using the exact backend pagination contract and renders only DTO fields", async () => {
    mockFetch.mockResolvedValue(page("unacknowledged", [item("i1")]));
    render(<AttentionQueue />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading attention queue");
    expect(await screen.findByRole("link", { name: "Issue i1" })).toHaveAttribute("href", "/explore/i1");
    expect(mockFetch).toHaveBeenCalledWith(
      { queue: "unacknowledged", page: 1, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText(/Waiting since/)).toBeInTheDocument();
    expect(screen.getByText("Responsibility: None accepted")).toBeInTheDocument();
  });

  it.each([
    ["unacknowledged", "Unacknowledged"],
    ["unassigned", "Unassigned"],
    ["awaiting_verification", "Awaiting verification"],
  ] as const)("selects the %s backend queue", async (queue, label) => {
    mockSearchParams.mockReturnValue(params({ queue }));
    mockFetch.mockResolvedValue(page(queue, []));
    render(<AttentionQueue />);
    expect(await screen.findByRole("heading", { name: label })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: label }));
    expect(mockPush).toHaveBeenCalledWith(`/dashboard/attention?queue=${queue}`);
  });

  it("reads the requested queue and server page from the URL; pagination preserves the queue", async () => {
    mockSearchParams.mockReturnValue(params({ queue: "unassigned", page: "2" }));
    mockFetch.mockResolvedValue(page("unassigned", [item("i2")], { page: 2, total: 45, totalPages: 3 }));
    render(<AttentionQueue />);
    await screen.findByRole("link", { name: "Issue i2" });
    expect(mockFetch).toHaveBeenCalledWith(
      { queue: "unassigned", page: 2, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/dashboard/attention?queue=unassigned&page=3");
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/dashboard/attention?queue=unassigned");
  });

  it("empty queue is distinct from an invalid page beyond the end", async () => {
    mockSearchParams.mockReturnValue(params({ queue: "awaiting_verification" }));
    mockFetch.mockResolvedValue(page("awaiting_verification", []));
    render(<AttentionQueue />);
    expect(await screen.findByRole("heading", { name: "This queue is clear" })).toBeInTheDocument();
  });

  it("a page beyond the end offers a link back to the first page", async () => {
    mockSearchParams.mockReturnValue(params({ queue: "unassigned", page: "4" }));
    mockFetch.mockResolvedValue(page("unassigned", [], { page: 4, total: 3, totalPages: 1 }));
    render(<AttentionQueue />);
    expect(await screen.findByRole("heading", { name: "No issues on this page" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to first page" })).toHaveAttribute("href", "/dashboard/attention?queue=unassigned");
  });

  it("renders a backend 403 instead of treating client role visibility as authorization", async () => {
    mockFetch.mockRejectedValue(new ApiError("Forbidden", "http", 403, "FORBIDDEN"));
    render(<AttentionQueue />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account is not permitted to view the Issue attention queue.");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("401 offers sign-in and retry can recover", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new ApiError("Unauthorized", "http", 401, "UNAUTHORIZED"));
    render(<AttentionQueue />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    mockFetch.mockResolvedValueOnce(page("unacknowledged", [item("i1")]));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Issue i1" })).toBeInTheDocument();
  });

  it("network failure is retryable", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new ApiError("offline", "network")).mockResolvedValueOnce(page("unacknowledged", [item("i1")]));
    render(<AttentionQueue />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Issue i1" })).toBeInTheDocument());
  });

  it("never renders identity, workflow-private or mutation controls", async () => {
    mockSearchParams.mockReturnValue(params({ queue: "unassigned" }));
    mockFetch.mockResolvedValue(page("unassigned", [item("i1", { responsibility: "pending" })]));
    const { container } = render(<AttentionQueue />);
    await screen.findByRole("link", { name: "Issue i1" });
    expect(container.textContent).not.toMatch(/reporter|grantee|grantor|pending user/i);
    expect(screen.queryByRole("button", { name: /acknowledge|assign|verify|resolve|reopen/i })).not.toBeInTheDocument();
  });
});
