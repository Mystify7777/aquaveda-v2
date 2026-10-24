import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExpertApplicationQueue } from "@/components/expert/expert-application-queue";
import { ApiError } from "@/lib/api/client";
import type { ExpertApplicationForReview, ExpertSubmission } from "@/lib/api/types/expert-application";

const mockList = vi.fn();
const mockApprove = vi.fn();
const mockReject = vi.fn();
vi.mock("@/lib/api/expert-application", () => ({
  getPendingExpertApplications: (q: unknown) => mockList(q),
  approveExpertApplication: (id: string, body: unknown) => mockApprove(id, body),
  rejectExpertApplication: (id: string, body: unknown) => mockReject(id, body),
}));
const mockStatusRefresh = vi.fn();
vi.mock("@/components/expert/expert-status-provider", () => ({
  useExpertStatus: () => ({ refresh: mockStatusRefresh }),
}));

const sub = (tag = "a", over: Partial<ExpertSubmission> = {}): ExpertSubmission => ({
  expertiseAreas: ["groundwater_wells"],
  experience: `${tag} experience `.repeat(8).trim(),
  references: [],
  acknowledgement: { version: 1, acceptedAt: "2026-03-05T10:00:00.000Z" },
  ...over,
});
const item = (over: Partial<ExpertApplicationForReview> = {}): ExpertApplicationForReview => ({
  userId: "u1",
  name: "Ada Lovelace",
  bio: "",
  status: "pending",
  requestedAt: "2026-03-05T10:00:00.000Z",
  revision: 1,
  submission: sub("ada"),
  history: [{ fromStatus: null, toStatus: "pending", actor: "u1", submission: sub("ada"), timestamp: "2026-03-05T10:00:00.000Z" }],
  ...over,
});
const page = (items: ExpertApplicationForReview[], over = {}) => ({
  items,
  page: 1,
  limit: 20,
  total: items.length,
  totalPages: 1,
  ...over,
});

beforeEach(() => {
  mockList.mockReset();
  mockApprove.mockReset();
  mockReject.mockReset();
  mockStatusRefresh.mockReset();
  mockStatusRefresh.mockResolvedValue(undefined);
});

describe("states", () => {
  it("loading", () => {
    mockList.mockReturnValue(new Promise(() => {}));
    render(<ExpertApplicationQueue page={1} />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading expert applications/i);
  });

  it("empty queue", async () => {
    mockList.mockResolvedValue(page([]));
    render(<ExpertApplicationQueue page={1} />);
    expect(await screen.findByText("No pending applications")).toBeInTheDocument();
  });

  it("past the last page offers a way back, not a misleading empty state", async () => {
    mockList.mockResolvedValue(page([], { page: 9, total: 3, totalPages: 1 }));
    render(<ExpertApplicationQueue page={9} />);
    expect(await screen.findByText("No applications on this page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to first page/i })).toHaveAttribute("href", "/admin/expert-applications");
  });

  it("a failure is a retryable alert; 401 offers sign-in", async () => {
    mockList.mockRejectedValueOnce(new ApiError("x", "http", 401));
    const user = userEvent.setup();
    render(<ExpertApplicationQueue page={1} />);
    expect(await screen.findByRole("link", { name: /sign in/i })).toBeInTheDocument();
    mockList.mockResolvedValueOnce(page([item()]));
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  });
});

describe("master-detail review", () => {
  it("lists applicants, shows the first in full (areas, experience, acknowledgement) and switches on selection", async () => {
    mockList.mockResolvedValue(
      page([
        item(),
        item({ userId: "u2", name: "Grace Hopper", submission: sub("grace", { expertiseAreas: ["policy_governance"], affiliation: "Water Board" }) }),
      ]),
    );
    const user = userEvent.setup();
    render(<ExpertApplicationQueue page={1} />);
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: /pending applications/i });
    expect(within(nav).getByRole("button", { name: /ada lovelace/i })).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Groundwater and wells")).toBeInTheDocument();
    expect(screen.getByText(/ada experience/)).toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: /grace hopper/i }));
    expect(screen.getByRole("heading", { name: "Grace Hopper" })).toBeInTheDocument();
    expect(screen.getByText("Policy and governance")).toBeInTheDocument();
    expect(screen.getByText("Water Board")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /grace hopper/i })).toHaveAttribute("aria-current", "true");
  });

  it("a legacy application is clearly marked, explains itself, and remains decidable", async () => {
    mockList.mockResolvedValue(page([item({ submission: null })]));
    render(<ExpertApplicationQueue page={1} />);
    expect(await screen.findByTestId("legacy-submission")).toHaveTextContent(/no details provided/i);
    expect(screen.getAllByText(/no details/i).length).toBeGreaterThan(1); // list + detail badges
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("a re-application shows a badge and the previous attempt with its rejection note", async () => {
    mockList.mockResolvedValue(
      page([
        item({
          revision: 3,
          submission: sub("second"),
          history: [
            { fromStatus: null, toStatus: "pending", actor: "u1", submission: sub("first"), timestamp: "2026-03-01T10:00:00.000Z" },
            { fromStatus: "pending", toStatus: "rejected", actor: "a1", note: "please add references", timestamp: "2026-03-02T10:00:00.000Z" },
            { fromStatus: "rejected", toStatus: "pending", actor: "u1", submission: sub("second"), timestamp: "2026-03-03T10:00:00.000Z" },
          ],
        }),
      ]),
    );
    render(<ExpertApplicationQueue page={1} />);
    expect(await screen.findByText("Re-application")).toBeInTheDocument();
    const prev = screen.getByRole("region", { name: /previous applications/i });
    expect(within(prev).getByText(/please add references/)).toBeInTheDocument();
    expect(within(prev).getByText(/first experience/)).toBeInTheDocument();
    expect(screen.getAllByText(/second experience/).length).toBe(1); // the CURRENT one only in the main view
  });

  it("this is the Expert-application queue: it does not link to or mention the Knowledge review queue", async () => {
    mockList.mockResolvedValue(page([item()]));
    const { container } = render(<ExpertApplicationQueue page={1} />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });
    expect(container.querySelector('a[href="/learn/review"]')).toBeNull();
    expect(screen.queryByText(/knowledge review/i)).not.toBeInTheDocument();
  });

  it("shows pagination when there are several pages", async () => {
    mockList.mockResolvedValue(page([item()], { total: 45, totalPages: 3 }));
    render(<ExpertApplicationQueue page={1} />);
    expect(await screen.findByRole("navigation", { name: /expert application pages/i })).toBeInTheDocument();
  });
});

describe("decisions", () => {
  it("approve sends the revision SHOWN, then the list is re-read, the nav count refreshed, and focus moves to the next application", async () => {
    mockList
      .mockResolvedValueOnce(page([item({ revision: 4 }), item({ userId: "u2", name: "Grace Hopper", revision: 2 })]))
      .mockResolvedValueOnce(page([item({ userId: "u2", name: "Grace Hopper", revision: 2 })]));
    mockApprove.mockResolvedValue(item({ status: "approved", revision: 5 }));
    const user = userEvent.setup();
    render(<ExpertApplicationQueue page={1} />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));

    expect(mockApprove).toHaveBeenCalledWith("u1", { revision: 4 });
    expect(await screen.findByText(/Approved Ada Lovelace\. They now have Expert access\./)).toBeInTheDocument();
    const next = await screen.findByRole("heading", { name: "Grace Hopper" });
    await waitFor(() => expect(next).toHaveFocus());
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(mockStatusRefresh).toHaveBeenCalledTimes(1);
  });

  it("reject sends { revision, note }; deciding the LAST item shows the empty state and focuses the outcome message", async () => {
    mockList.mockResolvedValueOnce(page([item({ revision: 2 })])).mockResolvedValueOnce(page([]));
    mockReject.mockResolvedValue(item({ status: "rejected" }));
    const user = userEvent.setup();
    render(<ExpertApplicationQueue page={1} />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.type(screen.getByLabelText(/reason for the applicant/i), "needs references please");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

    expect(mockReject).toHaveBeenCalledWith("u1", { revision: 2, note: "needs references please" });
    expect(await screen.findByText("No pending applications")).toBeInTheDocument();
    expect(screen.getByText(/Rejected Ada Lovelace's application\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("list", { name: /recent decisions/i })).toHaveFocus());
  });

  it("STALE decision: the user is told, the queue is re-read, and the NEXT decision uses the NEW revision", async () => {
    mockList
      .mockResolvedValueOnce(page([item({ revision: 1, submission: sub("old") })]))
      .mockResolvedValueOnce(page([item({ revision: 3, submission: sub("new") })]))
      .mockResolvedValueOnce(page([])); // the re-read after the final, successful approval
    mockApprove
      .mockRejectedValueOnce(new ApiError("race", "http", 409, "STATE_RACE"))
      .mockResolvedValueOnce(item({ status: "approved", revision: 4 }));
    const user = userEvent.setup();
    render(<ExpertApplicationQueue page={1} />);
    await screen.findByText(/old experience/);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(await screen.findByText(/changed or was decided elsewhere/i)).toBeInTheDocument();
    expect(await screen.findByText(/new experience/)).toBeInTheDocument();
    expect(mockStatusRefresh).toHaveBeenCalledTimes(1);

    // the decision component was reset for the new snapshot (keyed by revision)
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(mockApprove).toHaveBeenLastCalledWith("u1", { revision: 3 });
    expect(await screen.findByText("No pending applications")).toBeInTheDocument();
  });

  it("applications are never decided without naming a revision (every call carries one)", async () => {
    mockList.mockResolvedValue(page([item({ revision: 7 })]));
    mockApprove.mockResolvedValue(item({ status: "approved" }));
    const user = userEvent.setup();
    render(<ExpertApplicationQueue page={1} />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    for (const [, body] of mockApprove.mock.calls) expect(Number.isInteger((body as { revision: number }).revision)).toBe(true);
  });
});
