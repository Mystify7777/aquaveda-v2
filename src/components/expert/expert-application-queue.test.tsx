import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExpertApplicationQueue } from "@/components/expert/expert-application-queue";
import { ApiError } from "@/lib/api/client";
import type { ExpertApplicationForReview } from "@/lib/api/types/expert-application";

const mockList = vi.fn();
const mockApprove = vi.fn();
const mockReject = vi.fn();
vi.mock("@/lib/api/expert-application", () => ({
  getPendingExpertApplications: (q: unknown) => mockList(q),
  approveExpertApplication: (id: string) => mockApprove(id),
  rejectExpertApplication: (id: string, note?: string) => mockReject(id, note),
}));

const app = (n: number, over: Partial<ExpertApplicationForReview> = {}): ExpertApplicationForReview => ({
  userId: `u${n}`,
  name: `Applicant ${n}`,
  bio: n === 1 ? "Hydrologist, 10 years." : undefined,
  status: "pending",
  requestedAt: "2026-03-05T10:00:00.000Z",
  history: [{ fromStatus: null, toStatus: "pending", actor: `u${n}`, timestamp: "2026-03-05T10:00:00.000Z" }],
  ...over,
});
const pageOf = (items: ExpertApplicationForReview[], over = {}) => ({
  items,
  page: 1,
  limit: 20,
  total: items.length,
  totalPages: items.length ? 1 : 0,
  ...over,
});
const apiError = (status: number, code: string) => new ApiError("x", "http", status, code);
const card = (name: string) => screen.getByRole("heading", { name }).closest("[class*='rounded']")!.parentElement!;

beforeEach(() => {
  mockList.mockReset();
  mockApprove.mockReset();
  mockReject.mockReset();
});

describe("ExpertApplicationQueue — reading", () => {
  it("loading status, then applicants with date and bio", async () => {
    mockList.mockResolvedValue(pageOf([app(1), app(2)]));
    render(<ExpertApplicationQueue page={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading expert applications...");
    expect(await screen.findByRole("heading", { name: "Applicant 1" })).toBeInTheDocument();
    expect(screen.getByText("Hydrologist, 10 years.")).toBeInTheDocument();
    expect(screen.getAllByText(/Applied Mar 5, 2026/)).toHaveLength(2);
    expect(mockList).toHaveBeenCalledWith({ page: 1 });
  });

  it("empty queue", async () => {
    mockList.mockResolvedValue(pageOf([]));
    render(<ExpertApplicationQueue page={1} />);
    expect(await screen.findByText("No pending applications")).toBeInTheDocument();
  });

  it("past the last page: distinct empty state with a way back", async () => {
    mockList.mockResolvedValue(pageOf([], { page: 5, total: 3, totalPages: 1 }));
    render(<ExpertApplicationQueue page={5} />);
    expect(await screen.findByText("No applications on this page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to first page" })).toHaveAttribute("href", "/admin/expert-applications");
  });

  it("a re-application shows the previous rejection and its note", async () => {
    mockList.mockResolvedValue(
      pageOf([
        app(1, {
          history: [
            { fromStatus: null, toStatus: "pending", actor: "u1", timestamp: "2026-03-01T10:00:00.000Z" },
            { fromStatus: "pending", toStatus: "rejected", actor: "a1", note: "more detail", timestamp: "2026-03-02T10:00:00.000Z" },
            { fromStatus: "rejected", toStatus: "pending", actor: "u1", timestamp: "2026-03-05T10:00:00.000Z" },
          ],
        }),
      ]),
    );
    render(<ExpertApplicationQueue page={1} />);
    expect(await screen.findByText(/Re-application/)).toHaveTextContent("more detail");
  });

  it("failures: 403 is the BACKEND's refusal rendered (no client pre-emption); 401 offers sign-in; others retry", async () => {
    mockList.mockRejectedValueOnce(apiError(403, "FORBIDDEN"));
    const { unmount } = render(<ExpertApplicationQueue page={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account is not permitted to view Expert applications.");
    unmount();

    mockList.mockRejectedValueOnce(apiError(401, "UNAUTHORIZED"));
    const second = render(<ExpertApplicationQueue page={1} />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    second.unmount();

    mockList.mockRejectedValueOnce(apiError(500, "INTERNAL")).mockResolvedValueOnce(pageOf([app(1)]));
    render(<ExpertApplicationQueue page={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load Expert applications. Try again.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Applicant 1" })).toBeInTheDocument();
  });
});

describe("ExpertApplicationQueue — approve", () => {
  it("requires explicit confirmation; Cancel makes no request", async () => {
    mockList.mockResolvedValue(pageOf([app(1)]));
    render(<ExpertApplicationQueue page={1} />);
    await screen.findByRole("heading", { name: "Applicant 1" });
    const c = within(card("Applicant 1"));
    await userEvent.click(c.getByRole("button", { name: "Approve" }));
    expect(c.getByRole("group", { name: "Confirm approval for Applicant 1" })).toBeInTheDocument();
    expect(mockApprove).not.toHaveBeenCalled();
    await userEvent.click(c.getByRole("button", { name: "Cancel" }));
    expect(c.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("confirm calls the approve endpoint for that applicant, reports the result, and refreshes the queue", async () => {
    mockList.mockResolvedValueOnce(pageOf([app(1), app(2)])).mockResolvedValueOnce(pageOf([app(2)]));
    mockApprove.mockResolvedValue(app(1, { status: "approved" }));
    render(<ExpertApplicationQueue page={1} />);
    const c = within(await screen.findByRole("heading", { name: "Applicant 1" }).then(() => card("Applicant 1")));
    await userEvent.click(c.getByRole("button", { name: "Approve" }));
    await userEvent.click(c.getByRole("button", { name: "Confirm approval" }));

    expect(mockApprove).toHaveBeenCalledTimes(1);
    expect(mockApprove).toHaveBeenCalledWith("u1");
    expect(await screen.findByText("Approved Applicant 1. They now have Expert access.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Applicant 1" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Applicant 2" })).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("a double click on Confirm sends exactly one request", async () => {
    mockList.mockResolvedValue(pageOf([app(1)]));
    let resolve!: (v: ExpertApplicationForReview) => void;
    mockApprove.mockReturnValue(new Promise<ExpertApplicationForReview>((r) => (resolve = r)));
    render(<ExpertApplicationQueue page={1} />);
    const c = within(await screen.findByRole("heading", { name: "Applicant 1" }).then(() => card("Applicant 1")));
    await userEvent.click(c.getByRole("button", { name: "Approve" }));
    await userEvent.dblClick(c.getByRole("button", { name: "Confirm approval" }));
    expect(mockApprove).toHaveBeenCalledTimes(1);
    expect(c.getByRole("button", { name: "Approving..." })).toBeDisabled();
    resolve(app(1, { status: "approved" }));
    await waitFor(() => expect(mockApprove).toHaveBeenCalledTimes(1));
  });
});

describe("ExpertApplicationQueue — reject", () => {
  it("sends the optional note to the reject endpoint and refreshes", async () => {
    mockList.mockResolvedValueOnce(pageOf([app(1)])).mockResolvedValueOnce(pageOf([]));
    mockReject.mockResolvedValue(app(1, { status: "rejected" }));
    render(<ExpertApplicationQueue page={1} />);
    const c = within(await screen.findByRole("heading", { name: "Applicant 1" }).then(() => card("Applicant 1")));
    await userEvent.click(c.getByRole("button", { name: "Reject" }));
    await userEvent.type(c.getByLabelText("Note for the applicant (optional)"), "  Please add detail  ");
    await userEvent.click(c.getByRole("button", { name: "Confirm rejection" }));

    expect(mockReject).toHaveBeenCalledWith("u1", "Please add detail");
    expect(await screen.findByText("Rejected Applicant 1's application.")).toBeInTheDocument();
    expect(await screen.findByText("No pending applications")).toBeInTheDocument();
  });

  it("the note is optional: a blank note sends none", async () => {
    mockList.mockResolvedValue(pageOf([app(1)]));
    mockReject.mockResolvedValue(app(1, { status: "rejected" }));
    render(<ExpertApplicationQueue page={1} />);
    const c = within(await screen.findByRole("heading", { name: "Applicant 1" }).then(() => card("Applicant 1")));
    await userEvent.click(c.getByRole("button", { name: "Reject" }));
    await userEvent.type(c.getByLabelText("Note for the applicant (optional)"), "   ");
    await userEvent.click(c.getByRole("button", { name: "Confirm rejection" }));
    expect(mockReject).toHaveBeenCalledWith("u1", undefined);
  });

  it("the note is capped at the backend's 500 characters", async () => {
    mockList.mockResolvedValue(pageOf([app(1)]));
    render(<ExpertApplicationQueue page={1} />);
    const c = within(await screen.findByRole("heading", { name: "Applicant 1" }).then(() => card("Applicant 1")));
    await userEvent.click(c.getByRole("button", { name: "Reject" }));
    expect(c.getByLabelText("Note for the applicant (optional)")).toHaveAttribute("maxlength", "500");
  });
});

describe("ExpertApplicationQueue — failures and stale applications", () => {
  it("a stale application (INVALID_STATE) explains, and the queue refreshes without it", async () => {
    mockList.mockResolvedValueOnce(pageOf([app(1), app(2)])).mockResolvedValueOnce(pageOf([app(2)]));
    mockApprove.mockRejectedValue(apiError(409, "INVALID_STATE"));
    render(<ExpertApplicationQueue page={1} />);
    const c = within(await screen.findByRole("heading", { name: "Applicant 1" }).then(() => card("Applicant 1")));
    await userEvent.click(c.getByRole("button", { name: "Approve" }));
    await userEvent.click(c.getByRole("button", { name: "Confirm approval" }));
    expect(await screen.findByText(/already been decided elsewhere/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Applicant 1" })).not.toBeInTheDocument());
    expect(screen.queryByText(/They now have Expert access/)).not.toBeInTheDocument();
  });

  it("STATE_RACE and NOT_FOUND are treated as stale too", async () => {
    for (const [status, code] of [[409, "STATE_RACE"], [404, "NOT_FOUND"]] as const) {
      mockList.mockReset();
      mockList.mockResolvedValue(pageOf([app(1)]));
      mockApprove.mockReset();
      mockApprove.mockRejectedValue(apiError(status, code));
      const { unmount } = render(<ExpertApplicationQueue page={1} />);
      const c = within(await screen.findByRole("heading", { name: "Applicant 1" }).then(() => card("Applicant 1")));
      await userEvent.click(c.getByRole("button", { name: "Approve" }));
      await userEvent.click(c.getByRole("button", { name: "Confirm approval" }));
      expect(await screen.findByText(/already been decided elsewhere/)).toBeInTheDocument();
      unmount();
    }
  });

  it("a backend 403 on a decision is shown as the backend's denial; no success is reported", async () => {
    mockList.mockResolvedValue(pageOf([app(1)]));
    mockApprove.mockRejectedValue(apiError(403, "FORBIDDEN"));
    render(<ExpertApplicationQueue page={1} />);
    const c = within(await screen.findByRole("heading", { name: "Applicant 1" }).then(() => card("Applicant 1")));
    await userEvent.click(c.getByRole("button", { name: "Approve" }));
    await userEvent.click(c.getByRole("button", { name: "Confirm approval" }));
    expect(await c.findByRole("alert")).toHaveTextContent("Your account is not permitted to decide Expert applications.");
    expect(screen.queryByText(/They now have Expert access/)).not.toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("network, validation, 401 and server failures are reported; the decision controls stay usable", async () => {
    mockList.mockResolvedValue(pageOf([app(1)]));
    render(<ExpertApplicationQueue page={1} />);
    const c = within(await screen.findByRole("heading", { name: "Applicant 1" }).then(() => card("Applicant 1")));
    const approve = async () => {
      await userEvent.click(c.getByRole("button", { name: "Approve" }));
      await userEvent.click(c.getByRole("button", { name: "Confirm approval" }));
    };

    mockApprove.mockRejectedValueOnce(new ApiError("down", "network"));
    await approve();
    expect(await c.findByRole("alert")).toHaveTextContent(/unreachable/i);

    mockApprove.mockRejectedValueOnce(apiError(401, "UNAUTHORIZED"));
    await userEvent.click(c.getByRole("button", { name: "Confirm approval" }));
    await waitFor(() => expect(c.getByRole("link", { name: "Sign in" })).toBeInTheDocument());

    mockApprove.mockRejectedValueOnce(apiError(500, "INTERNAL"));
    await userEvent.click(c.getByRole("button", { name: "Confirm approval" }));
    await waitFor(() => expect(c.getByRole("alert")).toHaveTextContent("We could not record your decision. Try again."));
    expect(c.getByRole("button", { name: "Confirm approval" })).toBeEnabled();
  });
});
