import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { KnowledgeSubmitAction } from "@/components/knowledge/knowledge-submit-action";
import { KnowledgeDraftForm } from "@/components/knowledge/knowledge-draft-form";
import { ApiError } from "@/lib/api/client";

const mockSubmit = vi.fn();
const mockCreate = vi.fn();
vi.mock("@/lib/api/knowledge", () => ({
  submitKnowledge: (id: string) => mockSubmit(id),
  createKnowledge: (p: unknown) => mockCreate(p),
}));

const SUBMITTED = { _id: "k1", title: "Drip irrigation", status: "pending_review" };
const btn = () => screen.getByRole("button", { name: "Submit for review" });

describe("KnowledgeSubmitAction", () => {
  beforeEach(() => {
    mockSubmit.mockReset();
    mockCreate.mockReset();
  });

  it("submits the given id and reports the result", async () => {
    const user = userEvent.setup();
    const onSubmitted = vi.fn();
    mockSubmit.mockResolvedValue(SUBMITTED);
    render(<KnowledgeSubmitAction knowledgeId="k1" onSubmitted={onSubmitted} />);
    await user.click(btn());
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(SUBMITTED));
    expect(mockSubmit).toHaveBeenCalledWith("k1");
  });

  it("pending: disabled, busy, and duplicate clicks do not resubmit", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    mockSubmit.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<KnowledgeSubmitAction knowledgeId="k1" onSubmitted={vi.fn()} />);
    await user.click(btn());
    const pending = screen.getByRole("button", { name: "Submitting..." });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    pending.click();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    resolve(SUBMITTED);
  });

  it.each([
    [new ApiError("x", "http", 401, "UNAUTHORIZED"), /session is no longer valid/i, true],
    [new ApiError("x", "http", 403, "FORBIDDEN"), /only the author/i, false],
    [new ApiError("x", "http", 404, "NOT_FOUND"), /could not be found/i, false],
    [new ApiError("x", "http", 409, "INVALID_STATE"), /no longer in a state/i, false],
    [new ApiError("x", "http", 409, "STATE_RACE"), /no longer in a state/i, false],
    [new ApiError("Failed to fetch", "network"), /unreachable/i, false],
    [new ApiError("boom", "http", 500), /could not submit/i, false],
  ])("failure %#: accessible alert; sign-in link only for 401", async (error, message, signIn) => {
    const user = userEvent.setup();
    const onSubmitted = vi.fn();
    mockSubmit.mockRejectedValue(error);
    render(<KnowledgeSubmitAction knowledgeId="k1" onSubmitted={onSubmitted} />);
    await user.click(btn());
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(!!screen.queryByRole("link", { name: "Sign in" })).toBe(signIn);
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(btn()).toBeEnabled();
  });

  it("draft form: after save offers submit; after submit shows the new status and no button", async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({ _id: "k1", title: "Drip irrigation", status: "draft" });
    mockSubmit.mockResolvedValue(SUBMITTED);
    render(<KnowledgeDraftForm />);
    await user.type(screen.getByLabelText(/^title/i), "Drip irrigation");
    await user.type(screen.getByLabelText(/^body/i), "Steps");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(/has not been submitted for review/i)).toBeInTheDocument();
    await user.click(btn());
    expect(await screen.findByText(/submitted for review with status/i)).toHaveTextContent("pending_review");
    expect(mockSubmit).toHaveBeenCalledWith("k1");
    expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Write another" }));
    expect(screen.getByLabelText(/^title/i)).toHaveValue("");
  });
});
