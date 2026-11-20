import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/api/issue-workflow", () => ({
  getIssueWorkflow: vi.fn(),
  executeIssueAction: vi.fn(),
}));

import { ApiError, type ApiErrorKind } from "@/lib/api/client";
import { executeIssueAction, getIssueWorkflow } from "@/lib/api/issue-workflow";
import { ACTION_SPECS, WORKFLOW_ACTIONS } from "@/lib/issues/issue-actions";
import { IssueActionBar } from "./issue-action-bar";

const getWf = vi.mocked(getIssueWorkflow);
const exec = vi.mocked(executeIssueAction);

function apiError(kind: ApiErrorKind, status: number, code: string) {
  return new ApiError("RAW BACKEND TEXT", kind, status || undefined, code || undefined);
}
const wf = (...actions: string[]) => ({ actions });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("IssueActionBar — capability rendering", () => {
  it.each(WORKFLOW_ACTIONS)("renders only %s when it is the sole listed action", async (action) => {
    getWf.mockResolvedValue(wf(action));
    render(<IssueActionBar issueId="i1" />);
    expect(await screen.findByRole("button", { name: ACTION_SPECS[action].label })).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders nothing for actions: []", async () => {
    getWf.mockResolvedValue(wf());
    render(<IssueActionBar issueId="i1" />);
    await waitFor(() => expect(getWf).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("ignores unknown action identifiers", async () => {
    getWf.mockResolvedValue(wf("future.action", "acknowledge"));
    render(<IssueActionBar issueId="i1" />);
    await screen.findByRole("button", { name: "Acknowledge" });
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("server response alone toggles a control (no role/status inference)", async () => {
    getWf.mockResolvedValueOnce(wf());
    const first = render(<IssueActionBar issueId="i1" />);
    await waitFor(() => expect(getWf).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
    first.unmount();

    getWf.mockResolvedValueOnce(wf("remediation.resolve"));
    render(<IssueActionBar issueId="i1" />);
    expect(await screen.findByRole("button", { name: "Mark resolved" })).toBeVisible();
  });

  it("anonymous (401 on workflow) → no controls, no alert", async () => {
    getWf.mockRejectedValue(apiError("http", 401, "UNAUTHORIZED"));
    render(<IssueActionBar issueId="i1" />);
    await waitFor(() => expect(getWf).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("workflow network failure → retryable alert", async () => {
    getWf.mockRejectedValueOnce(apiError("network", 0, ""));
    render(<IssueActionBar issueId="i1" />);
    const user = userEvent.setup();
    expect(await screen.findByRole("alert")).toBeVisible();
    getWf.mockResolvedValueOnce(wf("acknowledge"));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Acknowledge" })).toBeVisible();
  });
});

describe("IssueActionBar — input", () => {
  it("renders failed verification as a non-destructive request-changes action with consequence", async () => {
    getWf.mockResolvedValue(wf("resolution.fail"));
    render(<IssueActionBar issueId="i1" />);
    const user = userEvent.setup();

    const actionButton = await screen.findByRole("button", {
      name: "Request changes",
      exact: true,
    });
    expect(actionButton).toHaveClass("border-warning", "text-warning");
    await user.click(actionButton);

    expect(screen.getByText(/sent back for further work/i)).toBeVisible();
    expect(screen.getByLabelText(/reason for requesting changes/i)).toBeVisible();

    const form = screen.getByRole("form", { name: "Request changes" });
    expect(within(form).getByRole("button", { name: "Request changes", exact: true })).toBeVisible();
  });

  it("rejects empty required note before the API call", async () => {
    getWf.mockResolvedValue(wf("remediation.resolve"));
    render(<IssueActionBar issueId="i1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mark resolved" }));
    await user.click(screen.getByRole("button", { name: "Confirm resolution" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/required/i);
    expect(exec).not.toHaveBeenCalled();
  });

  it("rejects a too-short failed-verification reason before the API call", async () => {
    getWf.mockResolvedValue(wf("resolution.fail"));
    render(<IssueActionBar issueId="i1" />);
    const user = userEvent.setup();

    const actionButton = await screen.findByRole("button", {
      name: "Request changes",
      exact: true,
    });
    await user.click(actionButton);

    const form = screen.getByRole("form", { name: "Request changes" });
    await user.type(screen.getByLabelText(/reason for requesting changes/i), "too short");
    await user.click(within(form).getByRole("button", { name: "Request changes", exact: true }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 10 characters/i);
    expect(exec).not.toHaveBeenCalled();
  });

  it("rejects malformed grantee id", async () => {
    getWf.mockResolvedValue(wf("remediation.grant"));
    render(<IssueActionBar issueId="i1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Grant remediation" }));
    await user.type(screen.getByLabelText(/grantee user id/i), "nope");
    await user.click(screen.getByRole("button", { name: "Confirm grant" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("IssueActionBar — mutation", () => {
  it("success adopts returned workflow and refreshes the Issue", async () => {
    getWf.mockResolvedValue(wf("remediation.resolve"));
    exec.mockResolvedValue({ issue: {}, workflow: wf("resolution.verify") });
    render(<IssueActionBar issueId="i1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mark resolved" }));
    await user.type(screen.getByLabelText(/resolution note/i), "fixed");
    await user.click(screen.getByRole("button", { name: "Confirm resolution" }));
    expect(exec).toHaveBeenCalledWith("i1", "remediation.resolve", expect.objectContaining({ note: "fixed" }));
    expect(await screen.findByRole("button", { name: "Verify resolution" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeVisible();
  });

  it("no-input action submits directly and blocks duplicates", async () => {
    getWf.mockResolvedValue(wf("remediation.accept"));
    let resolve!: (v: { issue: unknown; workflow: { actions: string[] } }) => void;
    exec.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<IssueActionBar issueId="i1" />);
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Accept remediation" });
    await user.dblClick(button);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    resolve({ issue: {}, workflow: wf() });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("IssueActionBar — failures", () => {
  async function submitAcknowledge(reread?: ReturnType<typeof wf>) {
    getWf.mockResolvedValueOnce(wf("acknowledge"));
    if (reread) getWf.mockResolvedValueOnce(reread); // consumed by the post-failure re-read
    render(<IssueActionBar issueId="i1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Acknowledge" }));
    await user.click(screen.getByRole("button", { name: "Confirm acknowledge" }));
  }

  it.each([
    ["409", apiError("http", 409, "STATE_RACE")],
    ["INVALID_STATE", apiError("http", 400, "INVALID_STATE")],
    ["403", apiError("http", 403, "FORBIDDEN")],
  ])("%s → no blind retry, workflow re-read, stale action removed", async (_n, err) => {
    exec.mockRejectedValue(err);
    await submitAcknowledge(wf());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull());
    expect(exec).toHaveBeenCalledTimes(1);
    expect(getWf).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("status")).not.toHaveTextContent("RAW BACKEND TEXT");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("network → retryable, form kept, no workflow reload", async () => {
    exec.mockRejectedValue(apiError("network", 0, ""));
    await submitAcknowledge();
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't reach/i);
    expect(screen.getByRole("button", { name: "Confirm acknowledge" })).toBeEnabled();
    expect(getWf).toHaveBeenCalledTimes(1);
  });

  it("validation failure → form kept, safe message", async () => {
    exec.mockRejectedValue(apiError("http", 400, "VALIDATION_FAILED"));
    await submitAcknowledge();
    expect(await screen.findByRole("alert")).toHaveTextContent(/rejected the input/i);
    expect(screen.getByRole("button", { name: "Confirm acknowledge" })).toBeVisible();
  });

  it("editing a field clears the previous submission error", async () => {
    exec.mockRejectedValue(apiError("http", 400, "VALIDATION_FAILED"));
    await submitAcknowledge();
    expect(await screen.findByRole("alert")).toBeVisible();
    await userEvent.setup().type(screen.getByLabelText(/note/i), "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("401 → sign-in link to canonical route", async () => {
    exec.mockRejectedValue(apiError("http", 401, "UNAUTHORIZED"));
    await submitAcknowledge();
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
  });
});
