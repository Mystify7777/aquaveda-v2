import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExpertApplicationDecision } from "@/components/expert/expert-application-decision";
import { ApiError } from "@/lib/api/client";

const mockApprove = vi.fn();
const mockReject = vi.fn();
vi.mock("@/lib/api/expert-application", () => ({
  approveExpertApplication: (id: string, body: unknown) => mockApprove(id, body),
  rejectExpertApplication: (id: string, body: unknown) => mockReject(id, body),
}));

const result = { userId: "u1", name: "Ada", status: "approved", revision: 4, submission: null, history: [] };

function setup(revision = 3) {
  const onDecided = vi.fn();
  const onStale = vi.fn();
  const user = userEvent.setup();
  render(<ExpertApplicationDecision userId="u1" name="Ada" revision={revision} onDecided={onDecided} onStale={onStale} />);
  return { user, onDecided, onStale };
}

beforeEach(() => {
  mockApprove.mockReset();
  mockReject.mockReset();
});

describe("approve", () => {
  it("requires explicit confirmation; cancel sends nothing", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByText(/Grant Expert status to/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockApprove).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("sends the revision the reviewer saw; no note key when the note is blank", async () => {
    mockApprove.mockResolvedValue(result);
    const { user, onDecided } = setup(3);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.type(screen.getByLabelText(/welcome note/i), "   ");
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalled());
    expect(mockApprove).toHaveBeenCalledWith("u1", { revision: 3 });
    expect(onDecided).toHaveBeenCalledWith({ userId: "u1", name: "Ada", decision: "approved", result });
  });

  it("sends the trimmed optional welcome note when given", async () => {
    mockApprove.mockResolvedValue(result);
    const { user } = setup(2);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.type(screen.getByLabelText(/welcome note/i), "  Welcome aboard  ");
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith("u1", { revision: 2, note: "Welcome aboard" }));
  });
});

describe("reject", () => {
  async function open(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Reject" }));
  }

  it("a reason is REQUIRED: the confirm button is disabled until the trimmed note meets the minimum, with the reason explained", async () => {
    const { user } = setup();
    await open(user);
    const confirm = screen.getByRole("button", { name: "Confirm rejection" });
    expect(screen.getByText(/in at least 10 characters/i)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/reason for the applicant/i), "          "); // whitespace only
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByLabelText(/reason for the applicant/i));
    await user.type(screen.getByLabelText(/reason for the applicant/i), "123456789"); // 9
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/reason for the applicant/i), "0"); // 10
    expect(confirm).toBeEnabled();
  });

  it("sends { revision, trimmed note } and never anything else", async () => {
    mockReject.mockResolvedValue({ ...result, status: "rejected" });
    const { user, onDecided } = setup(5);
    await open(user);
    await user.type(screen.getByLabelText(/reason for the applicant/i), "  Please add references  ");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalled());
    expect(mockReject).toHaveBeenCalledWith("u1", { revision: 5, note: "Please add references" });
    expect(onDecided.mock.calls[0][0].decision).toBe("rejected");
  });

  it("the textarea enforces the contract's maximum", async () => {
    const { user } = setup();
    await open(user);
    expect(screen.getByLabelText(/reason for the applicant/i)).toHaveAttribute("maxLength", "500");
  });
});

describe("in-flight and failure handling", () => {
  it("double-clicking confirm sends ONE request, and approve/reject cannot overlap", async () => {
    let finish!: (v: unknown) => void;
    mockApprove.mockReturnValue(new Promise((r) => (finish = r)));
    const { user, onDecided } = setup();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    const confirm = screen.getByRole("button", { name: "Confirm approval" });
    await user.dblClick(confirm);
    expect(mockApprove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Approving..." })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(mockReject).not.toHaveBeenCalled();
    finish(result);
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
  });

  it("a STATE_RACE shows the 'changed while reviewing' message and reports stale so the queue refreshes", async () => {
    mockApprove.mockRejectedValue(new ApiError("race", "http", 409, "STATE_RACE"));
    const { user, onStale, onDecided } = setup();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed while you were reviewing/i);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onDecided).not.toHaveBeenCalled();
  });

  it("INVALID_STATE (already decided) is stale too, and the buttons re-enable (recoverable)", async () => {
    mockReject.mockRejectedValue(new ApiError("x", "http", 409, "INVALID_STATE"));
    const { user, onStale } = setup();
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.type(screen.getByLabelText(/reason for the applicant/i), "not enough detail");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer pending/i);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Confirm rejection" })).toBeEnabled();
  });

  it("a session failure offers sign-in and is not stale", async () => {
    mockApprove.mockRejectedValue(new ApiError("x", "http", 401));
    const { user, onStale } = setup();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/session/i);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/auth/login");
    expect(onStale).not.toHaveBeenCalled();
  });

  it("a 403 refusal is rendered, not pre-empted (server authorization is authoritative)", async () => {
    mockApprove.mockRejectedValue(new ApiError("x", "http", 403, "FORBIDDEN"));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not permitted/i);
  });
});
