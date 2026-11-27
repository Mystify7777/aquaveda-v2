import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AccountGovernanceActions } from "@/components/admin/account-governance-actions";
import { ApiError } from "@/lib/api/client";
import type { AdminAccountEntry } from "@/lib/api/types/accounts";
import envelopes from "@/test-utils/fixtures/account-governance-envelopes.json";

const mockMute = vi.fn();
const mockLiftMute = vi.fn();
const mockSuspend = vi.fn();
const mockLiftSuspension = vi.fn();
vi.mock("@/lib/api/account-governance", () => ({
  muteAccount: (...a: unknown[]) => mockMute(...a),
  liftMute: (...a: unknown[]) => mockLiftMute(...a),
  suspendAccount: (...a: unknown[]) => mockSuspend(...a),
  liftSuspension: (...a: unknown[]) => mockLiftSuspension(...a),
}));

const NOW = new Date("2026-11-25T12:00:00.000Z");
const ok = { id: "t1", accountState: "MUTED" };

const entry = (over: Partial<AdminAccountEntry> = {}): AdminAccountEntry => ({
  id: "t1",
  name: "Mira Muted",
  email: "mira@example.test",
  role: "USER",
  registeredAt: "2026-11-01T00:00:00.000Z",
  accountState: "ACTIVE",
  accountStateChangedAt: null,
  deletionPending: false,
  deletionRequestedAt: null,
  restriction: null,
  ...over,
});

type Env = { status: number; body: { code?: string; message?: string; reason?: string } };
const apiError = (name: keyof typeof envelopes) => {
  const e = envelopes[name] as unknown as Env;
  return new ApiError(e.body.message ?? "", "http", e.status, e.body.code, undefined, e.body.reason);
};

const onApplied = vi.fn();
const onReconcile = vi.fn();
const onOpen = vi.fn();
function setup(e: AdminAccountEntry = entry(), props: { viewerId?: string; busy?: boolean } = {}) {
  return render(
    <AccountGovernanceActions
      entry={e}
      viewerId={"viewerId" in props ? props.viewerId : "admin-1"}
      busy={props.busy}
      now={() => NOW}
      onOpen={onOpen}
      onApplied={onApplied}
      onReconcile={onReconcile}
    />,
  );
}
const user = () => userEvent.setup();
const dialog = () => screen.getByRole("dialog");
const section = () => screen.getByRole("region", { name: "Governance actions" });
const button = (name: string | RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  for (const m of [mockMute, mockLiftMute, mockSuspend, mockLiftSuspension, onApplied, onReconcile, onOpen]) m.mockReset();
});

describe("which controls are offered", () => {
  it.each(["USER", "EXPERT"] as const)("%s, ACTIVE: Mute and Suspend only", (role) => {
    setup(entry({ role }));
    expect(within(section()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Mute", "Suspend"]);
  });

  it("MUTED: Lift mute only. HARD_SUSPENDED: Lift suspension only (never contradictory actions)", () => {
    const first = setup(entry({ accountState: "MUTED" }));
    expect(within(section()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Lift mute"]);
    first.unmount();
    setup(entry({ accountState: "HARD_SUSPENDED" }));
    expect(within(section()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Lift suspension"]);
  });

  it("states with no action explain why instead of showing controls", () => {
    setup(entry({ accountState: "DELETION_PENDING" }));
    expect(section()).toHaveTextContent("No governance actions are available while this account is deletion pending.");
    expect(within(section()).queryAllByRole("button")).toHaveLength(0);
  });

  it("a lapsed restriction says so and keeps its lift", () => {
    setup(entry({ accountState: "MUTED", restriction: { kind: "TEMPORARY", expiresAt: "2026-11-25T11:00:00.000Z", safeReason: null, lapsed: true } }));
    expect(section()).toHaveTextContent("expired and will clear automatically");
    expect(button("Lift mute")).toBeEnabled();
  });

  it("ADMIN targets, the viewer's own account and an unknown viewer render NOTHING", () => {
    for (const [e, viewerId] of [
      [entry({ role: "ADMIN" }), "admin-1"],
      [entry({ role: "ADMIN", accountState: "MUTED" }), "admin-1"],
      [entry({ id: "admin-1" }), "admin-1"],
      [entry(), undefined],
    ] as const) {
      const { container, unmount } = setup(e, { viewerId });
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("controls are disabled while a post-mutation refresh is pending", () => {
    setup(entry(), { busy: true });
    for (const b of within(section()).getAllByRole("button")) expect(b).toBeDisabled();
  });
});

describe("mute", () => {
  it("opens a labelled dialog, submits the exact body (expiry from `now`), then reports success", async () => {
    mockMute.mockResolvedValue(ok);
    setup();
    await user().click(button("Mute"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Mute: Mira Muted" })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("cannot post, report or make other contributions");

    await user().click(screen.getByLabelText("7 days"));
    await user().type(screen.getByLabelText("Message shown to the account holder (optional)"), "Please keep it civil");
    await user().click(button("Mute account"));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith("Mira Muted was muted."));
    expect(mockMute).toHaveBeenCalledTimes(1);
    expect(mockMute).toHaveBeenCalledWith("t1", { expiresAt: "2026-12-02T12:00:00.000Z", safeReason: "Please keep it civil" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onReconcile).not.toHaveBeenCalled();
  });

  it("the private reason is optional for a mute and sent only when provided", async () => {
    mockMute.mockResolvedValue(ok);
    setup();
    await user().click(button("Mute"));
    await user().type(screen.getByLabelText("Private reason (optional)"), "  spam  ");
    await user().click(button("Mute account"));
    await waitFor(() => expect(mockMute).toHaveBeenCalledWith("t1", { expiresAt: "2026-11-26T12:00:00.000Z", reason: "spam" }));
  });

  it("a custom end in the past is rejected before anything is sent", async () => {
    setup();
    await user().click(button("Mute"));
    await user().click(screen.getByLabelText("Custom"));
    fireEvent.change(screen.getByLabelText("Ends at"), { target: { value: "2020-01-01T00:00" } });
    await user().click(button("Mute account"));
    expect(await screen.findByText("The end must be in the future.")).toBeInTheDocument();
    expect(mockMute).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it("Cancel closes without sending; reopening starts empty", async () => {
    setup();
    await user().click(button("Mute"));
    await user().type(screen.getByLabelText("Private reason (optional)"), "draft text");
    await user().click(button("Cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user().click(button("Mute"));
    expect(screen.getByLabelText("Private reason (optional)")).toHaveValue("");
    expect(mockMute).not.toHaveBeenCalled();
  });
});

describe("suspend: validation and a separate confirmation step", () => {
  it("requires a private reason: blank is rejected inline, nothing is sent, no confirmation is shown", async () => {
    setup();
    await user().click(button("Suspend"));
    expect(screen.getByLabelText("Private reason (required)")).toBeInTheDocument();
    await user().click(button("Review suspension"));
    const error = await screen.findByText("A private reason is required for a suspension.");
    expect(error).toBeInTheDocument();
    expect(screen.getByLabelText("Private reason (required)")).toHaveAttribute("aria-invalid", "true");
    await user().type(screen.getByLabelText("Private reason (required)"), "   ");
    await user().click(button("Review suspension"));
    expect(mockSuspend).not.toHaveBeenCalled();
    expect(screen.queryByText(/Confirm suspension/)).not.toBeInTheDocument();
  });

  it("Review shows an explicit confirmation naming the account and consequence; NOTHING is sent until confirmed", async () => {
    mockSuspend.mockResolvedValue({ id: "t1", accountState: "HARD_SUSPENDED" });
    setup();
    await user().click(button("Suspend"));
    await user().type(screen.getByLabelText("Private reason (required)"), "SECRET-PRIVATE-REASON");
    await user().click(button("Review suspension"));

    expect(screen.getByRole("dialog", { name: "Confirm suspension of Mira Muted" })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("Mira Muted (User)");
    expect(dialog()).toHaveTextContent("Indefinite: until an administrator lifts it");
    expect(dialog()).toHaveTextContent("signed out and cannot use signed-in features");
    expect(dialog()).not.toHaveTextContent("SECRET-PRIVATE-REASON"); // the private reason is not echoed back
    expect(mockSuspend).not.toHaveBeenCalled();

    await user().click(button("Suspend account"));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith("Mira Muted was suspended."));
    expect(mockSuspend).toHaveBeenCalledTimes(1);
    expect(mockSuspend).toHaveBeenCalledWith("t1", { kind: "INDEFINITE", reason: "SECRET-PRIVATE-REASON" });
    expect(document.body.textContent).not.toContain("SECRET-PRIVATE-REASON");
    expect(onApplied.mock.calls[0][0]).not.toContain("SECRET");
  });

  it("Back returns to the form with the entered values intact and sends nothing", async () => {
    setup();
    await user().click(button("Suspend"));
    await user().type(screen.getByLabelText("Private reason (required)"), "kept");
    await user().click(button("Review suspension"));
    await user().click(button("Back"));
    expect(screen.getByLabelText("Private reason (required)")).toHaveValue("kept");
    expect(mockSuspend).not.toHaveBeenCalled();
  });

  it("temporary suspension: duration shown in the confirmation and sent as the exact union body", async () => {
    mockSuspend.mockResolvedValue({ id: "t1", accountState: "HARD_SUSPENDED" });
    setup(entry({ role: "EXPERT" }));
    await user().click(button("Suspend"));
    await user().click(screen.getByLabelText("Temporary (ends automatically)"));
    await user().click(screen.getByLabelText("24 hours"));
    await user().type(screen.getByLabelText("Private reason (required)"), "abuse");
    await user().click(button("Review suspension"));
    expect(dialog()).toHaveTextContent("Mira Muted (Expert)");
    expect(dialog()).toHaveTextContent(/Until Nov 26, 2026/);
    await user().click(button("Suspend account"));
    await waitFor(() =>
      expect(mockSuspend).toHaveBeenCalledWith("t1", { kind: "TEMPORARY", expiresAt: "2026-11-26T12:00:00.000Z", reason: "abuse" }),
    );
  });
});

describe("lifts", () => {
  it("lift mute: optional reason, exact body", async () => {
    mockLiftMute.mockResolvedValue({ id: "t1", accountState: "ACTIVE" });
    setup(entry({ accountState: "MUTED" }));
    await user().click(button("Lift mute"));
    expect(screen.queryByLabelText("Message shown to the account holder (optional)")).not.toBeInTheDocument();
    await user().click(within(dialog()).getByRole("button", { name: "Lift mute" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith("The mute on Mira Muted was lifted."));
    expect(mockLiftMute).toHaveBeenCalledWith("t1", {});
  });

  it("lift suspension: sends the optional reason when given", async () => {
    mockLiftSuspension.mockResolvedValue({ id: "t1", accountState: "ACTIVE" });
    setup(entry({ accountState: "HARD_SUSPENDED" }));
    await user().click(button("Lift suspension"));
    await user().type(screen.getByLabelText("Private reason (optional)"), "appeal reviewed");
    await user().click(within(dialog()).getByRole("button", { name: "Lift suspension" }));
    await waitFor(() => expect(mockLiftSuspension).toHaveBeenCalledWith("t1", { reason: "appeal reviewed" }));
    expect(onApplied).toHaveBeenCalledWith("The suspension on Mira Muted was lifted.");
  });
});

describe("duplicate submission is prevented", () => {
  it("while in flight: one request, controls locked, Escape and Close cannot abandon it", async () => {
    let resolve!: (v: unknown) => void;
    mockMute.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    await user().click(button("Mute"));
    const submit = button("Mute account");
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.submit(submit.closest("form")!);
    await waitFor(() => expect(button("Applying...")).toBeDisabled());
    expect(mockMute).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(dialog().querySelector("form")).toHaveAttribute("aria-busy", "true");
    await user().keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // the page behind an open modal is aria-hidden, so query it as hidden
    const behind = screen.getByRole("region", { name: "Governance actions", hidden: true });
    for (const b of within(behind).getAllByRole("button", { hidden: true }).filter((el) => ["Mute", "Suspend"].includes(el.textContent ?? ""))) {
      expect(b).toBeDisabled();
    }

    await act(async () => resolve(ok));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockMute).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });
});

describe("failures: presented safely, the mutation is NEVER re-sent", () => {
  async function submitMute() {
    setup();
    await user().click(button("Mute"));
    await user().click(button("Mute account"));
  }

  it.each([
    ["SELF_TARGET_PROHIBITED", "selfTarget", "protected", "You can't change your own account's governance state."],
    ["ADMIN_TARGET_PROTECTED", "adminTarget", "protected", "Administrator accounts are managed by operators and can't be changed here."],
    ["STATE_RACE", "stateRace", "stale", "This account changed while you were working, so nothing was applied."],
    ["INVALID_STATE (stale view)", "muteAgainInvalidState", "stale", "nothing was applied"],
    ["NOT_FOUND", "notFound", "not-found", "This account no longer exists."],
  ] as const)("%s: closes the dialog and hands off to reconcile", async (_label, envelope, kind, message) => {
    mockMute.mockRejectedValue(apiError(envelope));
    await submitMute();
    await waitFor(() => expect(onReconcile).toHaveBeenCalledTimes(1));
    expect(onReconcile).toHaveBeenCalledWith(expect.objectContaining({ kind, reconcile: true, message: expect.stringContaining(message) }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
    await act(async () => {});
    expect(mockMute).toHaveBeenCalledTimes(1); // no blind retry
  });

  it.each([
    ["network", new ApiError("x", "network")],
    ["timeout", new ApiError("Request timed out", "network", undefined, undefined, "timeout")],
    ["500", new ApiError("boom", "http", 500, "INTERNAL_ERROR")],
  ])("unknown outcome (%s): reconcile and say so, never re-send", async (_l, error) => {
    mockMute.mockRejectedValue(error);
    await submitMute();
    await waitFor(() => expect(onReconcile).toHaveBeenCalledTimes(1));
    expect(onReconcile).toHaveBeenCalledWith(expect.objectContaining({ kind: "unknown-outcome", message: expect.stringContaining("couldn't confirm") }));
    await act(async () => {});
    expect(mockMute).toHaveBeenCalledTimes(1);
  });

  it("server validation failure: stays open on the form, shows the safe text, keeps the values, and re-sends only on the user's own action", async () => {
    mockMute.mockRejectedValueOnce(apiError("validationPastExpiry")).mockResolvedValueOnce(ok);
    setup();
    await user().click(button("Mute"));
    await user().type(screen.getByLabelText("Message shown to the account holder (optional)"), "keep me");
    await user().click(button("Mute account"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent('Check the details and try again. The server said: "Invalid account governance request".');
    expect(screen.getByLabelText("Message shown to the account holder (optional)")).toHaveValue("keep me");
    expect(mockMute).toHaveBeenCalledTimes(1);
    expect(onReconcile).not.toHaveBeenCalled();

    await user().click(button("Mute account")); // the admin's own, second, deliberate submit
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(mockMute).toHaveBeenCalledTimes(2);
  });

  it("401: stays open with a sign-in link; no reconcile", async () => {
    mockMute.mockRejectedValue(apiError("unauthorized"));
    await submitMute();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your session is no longer valid.");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(onReconcile).not.toHaveBeenCalled();
    expect(mockMute).toHaveBeenCalledTimes(1);
  });

  it("generic 403: safe existing wording, stays open, nothing leaked", async () => {
    mockMute.mockRejectedValue(apiError("forbiddenUserActor"));
    await submitMute();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your account is not permitted to change this account.");
    expect(alert).not.toHaveTextContent("insufficient role privileges");
    expect(onReconcile).not.toHaveBeenCalled();
  });

  it("the admin's own account restriction (#248) uses the shared restricted copy", async () => {
    mockMute.mockRejectedValue(new ApiError("x", "http", 403, "ACCOUNT_MUTED"));
    await submitMute();
    expect(await screen.findByRole("alert")).toHaveTextContent(/muted/);
    expect(onReconcile).not.toHaveBeenCalled();
  });

  it("a failed mutation never displays the server's 'reload and retry' text", async () => {
    mockMute.mockRejectedValue(apiError("stateRace"));
    await submitMute();
    await waitFor(() => expect(onReconcile).toHaveBeenCalled());
    expect(document.body.textContent).not.toMatch(/reload and retry/i);
  });
});
