import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AccountDetail } from "@/components/admin/account-detail";
import { ApiError } from "@/lib/api/client";
import type { AdminAccountEntry, AdminGovernanceEvent } from "@/lib/api/types/accounts";
import governance from "@/test-utils/fixtures/account-governance-envelopes.json";

const mockEntry = vi.fn();
const mockHistory = vi.fn();
const mockMute = vi.fn();
const mockLiftMute = vi.fn();
const mockSuspend = vi.fn();
const mockUseAuth = vi.fn();
const mockReplace = vi.fn();
vi.mock("@/lib/api/accounts", () => ({
  getAccountEntry: (...a: unknown[]) => mockEntry(...a),
  getAccountHistory: (...a: unknown[]) => mockHistory(...a),
}));
vi.mock("@/lib/api/account-governance", () => ({
  muteAccount: (...a: unknown[]) => mockMute(...a),
  liftMute: (...a: unknown[]) => mockLiftMute(...a),
  suspendAccount: (...a: unknown[]) => mockSuspend(...a),
  liftSuspension: vi.fn(),
}));
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mockReplace }) }));

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

const active: AdminAccountEntry = {
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
};
const muted: AdminAccountEntry = {
  ...active,
  accountState: "MUTED",
  accountStateChangedAt: "2026-11-25T12:00:00.000Z",
  restriction: { kind: "TEMPORARY", expiresAt: "2026-11-27T12:00:00.000Z", safeReason: "Please keep it civil", lapsed: false },
};
const muteEvent: AdminGovernanceEvent = {
  id: "e1",
  action: "MUTE",
  actorType: "USER",
  actor: { id: "admin-1", name: "Asha Admin" },
  previousState: "ACTIVE",
  resultingState: "MUTED",
  safeReason: "Please keep it civil",
  occurredAt: "2026-11-25T12:00:00.000Z",
};
const page = (items: AdminGovernanceEvent[], p = 1) => ({ items, page: p, limit: 20, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / 20)) });

type Env = { status: number; body: { code?: string; message?: string; reason?: string } };
const apiError = (name: keyof typeof governance) => {
  const e = governance[name] as unknown as Env;
  return new ApiError(e.body.message ?? "", "http", e.status, e.body.code, undefined, e.body.reason);
};

const asAdmin = () => mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "admin-1", role: "ADMIN" } });
const renderDetail = (historyPage = 1) => render(<AccountDetail userId="t1" historyPage={historyPage} />);
const actionsRegion = () => screen.getByRole("region", { name: "Governance actions" });

beforeEach(() => {
  for (const m of [mockEntry, mockHistory, mockMute, mockLiftMute, mockSuspend, mockReplace]) m.mockReset();
  asAdmin();
});

async function muteIt() {
  await userEvent.click(within(actionsRegion()).getByRole("button", { name: "Mute" }));
  await userEvent.click(screen.getByRole("button", { name: "Mute account" }));
}

describe("controls on the detail page", () => {
  it("USER and EXPERT targets get controls; the state decides which", async () => {
    mockHistory.mockResolvedValue(page([]));
    mockEntry.mockResolvedValue(active);
    const first = renderDetail();
    await screen.findByRole("heading", { name: "Mira Muted" });
    expect(within(actionsRegion()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Mute", "Suspend"]);
    first.unmount();

    mockEntry.mockResolvedValue({ ...muted, role: "EXPERT" });
    renderDetail();
    await screen.findByRole("heading", { name: "Mira Muted" });
    expect(within(actionsRegion()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Lift mute"]);
  });

  it("an ADMIN target keeps the operator-managed note and has no controls", async () => {
    mockHistory.mockResolvedValue(page([]));
    mockEntry.mockResolvedValue({ ...active, role: "ADMIN" });
    renderDetail();
    await screen.findByText(/managed by operators and cannot be restricted from here/);
    expect(screen.queryByRole("region", { name: "Governance actions" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("the viewer's own account keeps the note and has no controls", async () => {
    mockHistory.mockResolvedValue(page([]));
    mockEntry.mockResolvedValue({ ...active, id: "admin-1" });
    renderDetail();
    await screen.findByText(/managed by operators/);
    expect(screen.queryByRole("region", { name: "Governance actions" })).not.toBeInTheDocument();
  });

  it("a non-ADMIN sees no controls and no request is made", () => {
    mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u", role: "USER" } });
    renderDetail();
    expect(screen.getByRole("alert")).toHaveTextContent("Administrator access required");
    expect(mockEntry).not.toHaveBeenCalled();
    expect(mockHistory).not.toHaveBeenCalled();
  });
});

describe("a successful mutation reconciles the account and its history in place", () => {
  it("shows the success notice, keeps the page on screen while refreshing, then shows the new state, actions and history event", async () => {
    const refetchedEntry = deferred<AdminAccountEntry>();
    const refetchedHistory = deferred<ReturnType<typeof page>>();
    mockEntry.mockResolvedValueOnce(active).mockReturnValueOnce(refetchedEntry.promise);
    mockHistory.mockResolvedValueOnce(page([])).mockReturnValueOnce(refetchedHistory.promise);
    mockMute.mockResolvedValue({ id: "t1", accountState: "MUTED" });
    renderDetail();
    await screen.findByRole("heading", { name: "Mira Muted" });
    expect(screen.getByText("No governance history")).toBeInTheDocument();

    await muteIt();
    await waitFor(() => expect(screen.getByText("Mira Muted was muted.")).toBeInTheDocument());
    expect(mockMute).toHaveBeenCalledTimes(1);

    // pending refresh: NO page-wide loading, the account and history stay put, actions are locked
    expect(screen.queryByText("Loading account...")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mira Muted" })).toBeInTheDocument();
    expect(screen.getByText("No governance history")).toBeInTheDocument();
    for (const b of within(actionsRegion()).getAllByRole("button")) expect(b).toBeDisabled();

    await act(async () => {
      refetchedEntry.resolve(muted);
      refetchedHistory.resolve(page([muteEvent]));
    });
    await waitFor(() => expect(within(actionsRegion()).getByRole("button", { name: "Lift mute" })).toBeEnabled());
    expect(within(actionsRegion()).queryByRole("button", { name: "Mute" })).not.toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Account" });
    expect(within(card).getByText("Muted")).toBeInTheDocument();
    const history = screen.getByRole("list", { name: "Governance history" });
    expect(within(history).getByText("Muted")).toBeInTheDocument();
    expect(history).toHaveTextContent("By Asha Admin");
    expect(mockEntry).toHaveBeenCalledTimes(2);
    expect(mockHistory).toHaveBeenCalledTimes(2);
    expect(mockMute).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("from a deeper history page, the view moves to page 1 where the new event sorts first", async () => {
    mockEntry.mockResolvedValue(active);
    mockHistory.mockResolvedValue(page([muteEvent], 3));
    mockMute.mockResolvedValue({ id: "t1", accountState: "MUTED" });
    renderDetail(3);
    await screen.findByRole("heading", { name: "Mira Muted" });
    await muteIt();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/admin/accounts/t1"));
  });

  it("the private reason typed by the admin never appears anywhere after submission", async () => {
    mockEntry.mockResolvedValueOnce(active).mockResolvedValue(muted);
    mockHistory.mockResolvedValue(page([muteEvent]));
    mockMute.mockResolvedValue({ id: "t1", accountState: "MUTED" });
    renderDetail();
    await screen.findByRole("heading", { name: "Mira Muted" });
    await userEvent.click(within(actionsRegion()).getByRole("button", { name: "Mute" }));
    await userEvent.type(screen.getByLabelText("Private reason (optional)"), "TOP-SECRET-NOTE");
    await userEvent.click(screen.getByRole("button", { name: "Mute account" }));
    await waitFor(() => expect(screen.getByText("Mira Muted was muted.")).toBeInTheDocument());
    expect(mockMute).toHaveBeenCalledWith("t1", expect.objectContaining({ reason: "TOP-SECRET-NOTE" }));
    expect(document.body.textContent).not.toContain("TOP-SECRET-NOTE");
  });

  it("a new action clears the previous outcome message", async () => {
    mockEntry.mockResolvedValueOnce(active).mockResolvedValue(muted);
    mockHistory.mockResolvedValue(page([muteEvent]));
    mockMute.mockResolvedValue({ id: "t1", accountState: "MUTED" });
    renderDetail();
    await screen.findByRole("heading", { name: "Mira Muted" });
    await muteIt();
    await waitFor(() => expect(screen.getByText("Mira Muted was muted.")).toBeInTheDocument());
    await userEvent.click(await within(actionsRegion()).findByRole("button", { name: "Lift mute" }));
    expect(screen.queryByText("Mira Muted was muted.")).not.toBeInTheDocument();
  });
});

describe("STATE_RACE converges to the server's state without a retry", () => {
  it("warns, re-reads, shows the newer state and its valid actions, and never re-sends", async () => {
    const mutedByOther: AdminAccountEntry = { ...muted, restriction: { ...muted.restriction!, safeReason: null } };
    mockEntry.mockResolvedValueOnce(active).mockResolvedValue(mutedByOther);
    mockHistory.mockResolvedValue(page([]));
    mockMute.mockRejectedValue(apiError("stateRace"));
    renderDetail();
    await screen.findByRole("heading", { name: "Mira Muted" });
    expect(within(actionsRegion()).getByRole("button", { name: "Mute" })).toBeInTheDocument();

    await muteIt();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This account changed while you were working, so nothing was applied.");
    expect(document.body.textContent).not.toMatch(/reload and retry/i);

    await waitFor(() => expect(within(actionsRegion()).getByRole("button", { name: "Lift mute" })).toBeEnabled());
    expect(within(actionsRegion()).queryByRole("button", { name: "Mute" })).not.toBeInTheDocument();
    expect(mockEntry).toHaveBeenCalledTimes(2);
    expect(mockHistory).toHaveBeenCalledTimes(2);
    await act(async () => {});
    expect(mockMute).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ADMIN_TARGET_PROTECTED is presented as authoritative and the view re-reads", async () => {
    mockEntry.mockResolvedValue(active);
    mockHistory.mockResolvedValue(page([]));
    mockMute.mockRejectedValue(apiError("adminTarget"));
    renderDetail();
    await screen.findByRole("heading", { name: "Mira Muted" });
    await muteIt();
    expect(await screen.findByRole("alert")).toHaveTextContent("Administrator accounts are managed by operators and can't be changed here.");
    await waitFor(() => expect(mockEntry).toHaveBeenCalledTimes(2));
    expect(mockMute).toHaveBeenCalledTimes(1);
  });

  it("an unknown outcome (network) reconciles by re-reading, not by retrying", async () => {
    mockEntry.mockResolvedValueOnce(active).mockResolvedValue(muted); // it DID apply; we only learn that by reading
    mockHistory.mockResolvedValue(page([muteEvent]));
    mockMute.mockRejectedValue(new ApiError("x", "network"));
    renderDetail();
    await screen.findByRole("heading", { name: "Mira Muted" });
    await muteIt();
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't confirm whether the change was applied.");
    await waitFor(() => expect(within(actionsRegion()).getByRole("button", { name: "Lift mute" })).toBeInTheDocument());
    expect(mockMute).toHaveBeenCalledTimes(1);
  });
});

describe("a failed refresh never discards what is on screen", () => {
  it("keeps the stale data, says so, and Try again re-reads (a read, not a mutation)", async () => {
    mockEntry.mockResolvedValueOnce(active).mockRejectedValueOnce(new ApiError("x", "http", 500)).mockResolvedValue(muted);
    mockHistory.mockResolvedValue(page([muteEvent]));
    mockMute.mockResolvedValue({ id: "t1", accountState: "MUTED" });
    renderDetail();
    await screen.findByRole("heading", { name: "Mira Muted" });
    await muteIt();
    expect(await screen.findByText(/couldn.t refresh this account/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mira Muted" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(actionsRegion()).getByRole("button", { name: "Lift mute" })).toBeInTheDocument());
    expect(screen.queryByText(/couldn.t refresh this account/)).not.toBeInTheDocument();
    expect(mockMute).toHaveBeenCalledTimes(1);
  });
});
