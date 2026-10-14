import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkflowArticle } from "@/components/knowledge/workflow-article";
import { ApiError } from "@/lib/api/client";
import type { WorkflowKnowledge } from "@/lib/api/types/knowledge";

const mockGet = vi.fn();
const mockSubmit = vi.fn();
const mockApprove = vi.fn();
const mockReject = vi.fn();
const mockRevise = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("@/lib/api/knowledge", () => ({
  getKnowledgeWorkflow: (id: string) => mockGet(id),
  submitKnowledge: (id: string) => mockSubmit(id),
  approveKnowledge: (id: string) => mockApprove(id),
  rejectKnowledge: (id: string, f: string) => mockReject(id, f),
  reviseKnowledge: (id: string, p: unknown) => mockRevise(id, p),
}));
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

const AUTHOR = { _id: "u-author", name: "Asha", role: "USER" as const };
const REVIEWER = { _id: "u-rev", name: "Ravi", role: "EXPERT" as const };

function article(over: Partial<WorkflowKnowledge> = {}): WorkflowKnowledge {
  return {
    _id: "k1",
    title: "Drip irrigation",
    body: "Line one\nLine two",
    region: "",
    status: "draft",
    author: AUTHOR,
    reviewHistory: [],
    createdAt: "2026-03-05T10:00:00.000Z",
    updatedAt: "2026-03-06T10:00:00.000Z",
    ...over,
  };
}

const asAuthor = () => mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u-author", role: "USER" } });
const asReviewer = () => mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u-rev", role: "EXPERT" } });
const controls = () => screen.queryAllByRole("button").map((b) => b.textContent);
const load = async (a: WorkflowKnowledge) => {
  mockGet.mockResolvedValue(a);
  render(<WorkflowArticle knowledgeId="k1" />);
  await screen.findByRole("heading", { level: 1, name: a.title });
};

describe("WorkflowArticle — rendering the workflow DTO", () => {
  beforeEach(() => {
    [mockGet, mockSubmit, mockApprove, mockReject, mockRevise, mockUseAuth].forEach((m) => m.mockReset());
    asAuthor();
  });

  it("shows a loading status first, then title, status, author, dates and body", async () => {
    mockGet.mockResolvedValue(article({ status: "pending_review" }));
    render(<WorkflowArticle knowledgeId="k1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading article...");
    await screen.findByRole("heading", { level: 1, name: "Drip irrigation" });
    expect(mockGet).toHaveBeenCalledWith("k1");
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    expect(screen.getByText(/By Asha/)).toBeInTheDocument();
    expect(screen.getByText("Mar 5, 2026")).toBeInTheDocument();
    expect(screen.getByText(/Line one/)).toBeInTheDocument();
  });

  it.each([
    ["draft", "Draft"],
    ["pending_review", "Pending review"],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
  ] as const)("renders the %s status as text", async (status, label) => {
    await load(article({ status }));
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it("empty review history", async () => {
    await load(article());
    expect(screen.getByText("No review decisions yet.")).toBeInTheDocument();
  });

  it("review history: decision, resolved reviewer {name, role}, rejection feedback, unresolved reviewer", async () => {
    await load(
      article({
        status: "rejected",
        reviewHistory: [
          { decision: "rejected", reviewer: REVIEWER, feedback: "Needs sources", timestamp: "2026-03-07T10:00:00.000Z" },
          { decision: "approved", reviewer: null, timestamp: "2026-03-08T10:00:00.000Z" },
        ],
      }),
    );
    const history = screen.getByRole("region", { name: "Review history" });
    const entries = within(history).getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent("Rejected by Ravi (EXPERT)");
    expect(entries[0]).toHaveTextContent("Needs sources");
    expect(entries[0]).toHaveTextContent("Mar 7, 2026");
    expect(entries[1]).toHaveTextContent("Approved by an unavailable reviewer");
  });

  it.each([
    [new ApiError("nf", "http", 404, "NOT_FOUND")],
    [new ApiError("bad", "http", 400, "VALIDATION_FAILED")],
  ])("missing/not-yours/malformed (%#) is one 'not found' view with a way back", async (error) => {
    mockGet.mockRejectedValue(error);
    render(<WorkflowArticle knowledgeId="k1" />);
    expect(await screen.findByRole("heading", { name: "Article not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to your articles" })).toHaveAttribute("href", "/learn/mine");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a server or network failure is a retryable alert, not 'not found'", async () => {
    const user = userEvent.setup();
    mockGet.mockRejectedValueOnce(new ApiError("x", "network")).mockResolvedValueOnce(article());
    render(<WorkflowArticle knowledgeId="k1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i);
    expect(screen.queryByRole("heading", { name: "Article not found" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Drip irrigation" })).toBeInTheDocument();
  });

  it("401 offers sign-in", async () => {
    mockGet.mockRejectedValue(new ApiError("x", "http", 401, "UNAUTHORIZED"));
    render(<WorkflowArticle knowledgeId="k1" />);
    await screen.findByRole("alert");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
  });
});

describe("WorkflowArticle — which lifecycle controls appear (presentation only)", () => {
  beforeEach(() => {
    [mockGet, mockSubmit, mockApprove, mockReject, mockRevise, mockUseAuth].forEach((m) => m.mockReset());
  });

  it("author + draft: Submit for review only", async () => {
    asAuthor();
    await load(article({ status: "draft" }));
    expect(controls()).toEqual(["Submit for review"]);
  });

  it("author + rejected: revise form only (no submit/approve/reject)", async () => {
    asAuthor();
    await load(article({ status: "rejected" }));
    expect(screen.getByRole("heading", { name: "Revise this article" })).toBeInTheDocument();
    expect(controls()).toEqual(["Save revision"]);
  });

  it("author + pending_review: no actions (reviewing your own article is not offered)", async () => {
    asAuthor();
    await load(article({ status: "pending_review" }));
    expect(controls()).toEqual([]);
  });

  it("reviewer + pending_review: Approve and Reject", async () => {
    asReviewer();
    await load(article({ status: "pending_review" }));
    expect(controls()).toEqual(["Approve", "Reject"]);
  });

  it("approved: no lifecycle controls, only a link to the published article", async () => {
    asAuthor();
    await load(article({ status: "approved" }));
    expect(controls()).toEqual([]);
    expect(screen.getByRole("link", { name: "View published article" })).toHaveAttribute("href", "/learn/k1");
  });

  it("non-author viewer of a draft/rejected article gets no controls", async () => {
    asReviewer();
    await load(article({ status: "draft" }));
    expect(controls()).toEqual([]);
  });

  it("no invented actions in any state (no delete/publish/edit/assign)", async () => {
    asReviewer();
    await load(article({ status: "pending_review" }));
    for (const name of [/delete/i, /publish/i, /edit/i, /assign/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});

describe("WorkflowArticle — submit for review", () => {
  beforeEach(() => {
    [mockGet, mockSubmit, mockApprove, mockReject, mockRevise, mockUseAuth].forEach((m) => m.mockReset());
    asAuthor();
  });

  it("submits, then reloads to show pending_review with no actions", async () => {
    const user = userEvent.setup();
    mockGet
      .mockResolvedValueOnce(article({ status: "draft" }))
      .mockResolvedValueOnce(article({ status: "pending_review" }));
    mockSubmit.mockResolvedValue({ _id: "k1", title: "Drip irrigation", status: "pending_review" });
    render(<WorkflowArticle knowledgeId="k1" />);
    await user.click(await screen.findByRole("button", { name: "Submit for review" }));
    expect(mockSubmit).toHaveBeenCalledWith("k1");
    await waitFor(() => expect(screen.getByText("Pending review")).toBeInTheDocument());
    expect(controls()).toEqual([]);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});

describe("WorkflowArticle — approve / reject", () => {
  beforeEach(() => {
    [mockGet, mockSubmit, mockApprove, mockReject, mockRevise, mockUseAuth].forEach((m) => m.mockReset());
    asReviewer();
  });

  it("approve: calls the endpoint, then shows an announced outcome with a way back (no refetch)", async () => {
    const user = userEvent.setup();
    mockApprove.mockResolvedValue({ _id: "k1", title: "Drip irrigation", status: "approved" });
    await load(article({ status: "pending_review" }));
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(mockApprove).toHaveBeenCalledWith("k1");
    expect(await screen.findByRole("heading", { name: "Article approved" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(/is now published/);
    expect(screen.getByRole("link", { name: "Back to review queue" })).toHaveAttribute("href", "/learn/review");
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("approve pending: disabled + busy, blocks Reject, and duplicate clicks do not re-send", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    mockApprove.mockReturnValue(new Promise((r) => (resolve = r)));
    await load(article({ status: "pending_review" }));
    await user.click(screen.getByRole("button", { name: "Approve" }));
    const busy = screen.getByRole("button", { name: "Approving..." });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    busy.click();
    expect(mockApprove).toHaveBeenCalledTimes(1);
    resolve({ _id: "k1", title: "Drip irrigation", status: "approved" });
    await screen.findByRole("heading", { name: "Article approved" });
  });

  it("reject: requires feedback — empty/whitespace shows an error, focuses the field, sends nothing", async () => {
    const user = userEvent.setup();
    await load(article({ status: "pending_review" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    const field = screen.getByLabelText("Feedback for the author");
    await user.type(field, "   ");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(mockReject).not.toHaveBeenCalled();
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Feedback is required to reject an article.");
  });

  it("reject: sends trimmed feedback, then shows the rejected outcome", async () => {
    const user = userEvent.setup();
    mockReject.mockResolvedValue({ _id: "k1", title: "Drip irrigation", status: "rejected" });
    await load(article({ status: "pending_review" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.type(screen.getByLabelText("Feedback for the author"), "  Needs sources  ");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(mockReject).toHaveBeenCalledWith("k1", "Needs sources");
    expect(await screen.findByRole("heading", { name: "Article rejected" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/returned to its author/);
  });

  it("reject pending: fields and buttons disabled, duplicate submit does not re-send", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    mockReject.mockReturnValue(new Promise((r) => (resolve = r)));
    await load(article({ status: "pending_review" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.type(screen.getByLabelText("Feedback for the author"), "No");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(screen.getByRole("button", { name: "Rejecting..." })).toBeDisabled();
    expect(screen.getByLabelText("Feedback for the author")).toBeDisabled();
    screen.getByRole("button", { name: "Rejecting..." }).closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(mockReject).toHaveBeenCalledTimes(1);
    resolve({ _id: "k1", title: "Drip irrigation", status: "rejected" });
    await screen.findByRole("heading", { name: "Article rejected" });
  });

  it("Cancel returns to Approve/Reject without sending anything", async () => {
    const user = userEvent.setup();
    await load(article({ status: "pending_review" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(controls()).toEqual(["Approve", "Reject"]);
    expect(mockReject).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError("x", "http", 403, "FORBIDDEN"), /not permitted to review/i, false],
    [new ApiError("x", "http", 409, "INVALID_STATE"), /no longer pending review/i, false],
    [new ApiError("x", "http", 409, "STATE_RACE"), /no longer pending review/i, false],
    [new ApiError("x", "http", 404, "NOT_FOUND"), /could not be found/i, false],
    [new ApiError("x", "http", 401, "UNAUTHORIZED"), /session is no longer valid/i, true],
    [new ApiError("x", "network"), /unreachable/i, false],
    [new ApiError("x", "http", 500), /could not record your decision/i, false],
  ])("approve failure %#: accessible alert, article stays, controls re-enabled", async (error, message, signIn) => {
    const user = userEvent.setup();
    mockApprove.mockRejectedValue(error);
    await load(article({ status: "pending_review" }));
    await user.click(screen.getByRole("button", { name: "Approve" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(!!within(alert).queryByRole("link", { name: "Sign in" })).toBe(signIn);
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(screen.getByRole("heading", { level: 1, name: "Drip irrigation" })).toBeInTheDocument();
  });

  it("reject failure keeps the typed feedback", async () => {
    const user = userEvent.setup();
    mockReject.mockRejectedValue(new ApiError("x", "http", 403, "FORBIDDEN"));
    await load(article({ status: "pending_review" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.type(screen.getByLabelText("Feedback for the author"), "Needs sources");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not permitted to review/i);
    expect(screen.getByLabelText("Feedback for the author")).toHaveValue("Needs sources");
  });
});

describe("WorkflowArticle — revise (rejected -> draft)", () => {
  beforeEach(() => {
    [mockGet, mockSubmit, mockApprove, mockReject, mockRevise, mockUseAuth].forEach((m) => m.mockReset());
    asAuthor();
  });

  const rejected = () =>
    article({
      status: "rejected",
      reviewHistory: [{ decision: "rejected", reviewer: REVIEWER, feedback: "Needs sources", timestamp: "2026-03-07T10:00:00.000Z" }],
    });

  it("prefills the rejected content, shows the feedback, and validates like draft authoring", async () => {
    const user = userEvent.setup();
    await load(rejected());
    expect(screen.getByLabelText("Title")).toHaveValue("Drip irrigation");
    expect(screen.getByLabelText("Body")).toHaveValue("Line one\nLine two");
    expect(screen.getByText("Needs sources")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Title"));
    await user.clear(screen.getByLabelText("Body"));
    await user.click(screen.getByRole("button", { name: "Save revision" }));
    expect(mockRevise).not.toHaveBeenCalled();
    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByText("Body is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveFocus();
  });

  it("sends exactly { title, body } (trimmed), then reloads as a draft that can be submitted again", async () => {
    const user = userEvent.setup();
    mockGet
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(article({ status: "draft", title: "Better title", body: "Better body" }));
    mockRevise.mockResolvedValue({ _id: "k1", title: "Better title", status: "draft" });
    render(<WorkflowArticle knowledgeId="k1" />);
    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "  Better title  ");
    await user.clear(screen.getByLabelText("Body"));
    await user.type(screen.getByLabelText("Body"), "Better body");
    await user.click(screen.getByRole("button", { name: "Save revision" }));

    expect(mockRevise).toHaveBeenCalledWith("k1", { title: "Better title", body: "Better body" });
    expect(await screen.findByRole("heading", { level: 1, name: "Better title" })).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(controls()).toEqual(["Submit for review"]);
  });

  it("pending: disabled/busy and a duplicate submit does not re-send", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    mockRevise.mockReturnValue(new Promise((r) => (resolve = r)));
    mockGet.mockResolvedValueOnce(rejected()).mockResolvedValueOnce(article({ status: "draft" }));
    render(<WorkflowArticle knowledgeId="k1" />);
    await user.click(await screen.findByRole("button", { name: "Save revision" }));
    const busy = screen.getByRole("button", { name: "Saving..." });
    expect(busy).toBeDisabled();
    busy.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(mockRevise).toHaveBeenCalledTimes(1);
    resolve({ _id: "k1", title: "Drip irrigation", status: "draft" });
    await waitFor(() => expect(screen.getByText("Draft")).toBeInTheDocument());
  });

  it.each([
    [new ApiError("title is required", "http", 400, "VALIDATION_FAILED"), /title is required/i],
    [new ApiError("x", "http", 403, "FORBIDDEN"), /only the author/i],
    [new ApiError("x", "http", 409, "INVALID_STATE"), /no longer in a state that can be revised/i],
    [new ApiError("x", "network"), /unreachable/i],
    [new ApiError("x", "http", 500), /could not save your revision/i],
  ])("failure %#: alert, edits preserved", async (error, message) => {
    const user = userEvent.setup();
    mockRevise.mockRejectedValue(error);
    await load(rejected());
    await user.type(screen.getByLabelText("Title"), " v2");
    await user.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Title")).toHaveValue("Drip irrigation v2");
  });
});
