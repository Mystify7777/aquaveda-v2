import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AccountDetail } from "@/components/admin/account-detail";
import { ApiError } from "@/lib/api/client";
import envelopes from "@/test-utils/fixtures/account-directory-envelopes.json";

const mockEntry = vi.fn();
const mockHistory = vi.fn();
const mockUseAuth = vi.fn();
vi.mock("@/lib/api/accounts", () => ({
  getAccountEntry: (...a: unknown[]) => mockEntry(...a),
  getAccountHistory: (...a: unknown[]) => mockHistory(...a),
}));
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

type Env = { body: { data: Record<string, unknown> } };
const data = (name: keyof typeof envelopes) => (envelopes[name] as unknown as Env).body.data;
const ids = envelopes.ids as Record<string, string>;
const asAdmin = (id = "admin-self") => mockUseAuth.mockReturnValue({ status: "authenticated", user: { id, role: "ADMIN" } });

beforeEach(() => {
  mockEntry.mockReset();
  mockHistory.mockReset();
  mockUseAuth.mockReset();
});

describe("authorization", () => {
  it.each(["USER", "EXPERT"])("%s: access message and NO request", (role) => {
    mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u", role } });
    render(<AccountDetail userId={ids.muted} historyPage={1} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Administrator access required");
    expect(mockEntry).not.toHaveBeenCalled();
    expect(mockHistory).not.toHaveBeenCalled();
  });

  it("the backend's 403 on the entry is rendered", async () => {
    asAdmin();
    mockEntry.mockRejectedValue(new ApiError("Forbidden", "http", 403, "FORBIDDEN"));
    mockHistory.mockReturnValue(new Promise(() => {}));
    render(<AccountDetail userId={ids.muted} historyPage={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account is not permitted to view this account.");
  });
});

describe("states", () => {
  it("loading shows skeletons for the account and its history", () => {
    asAdmin();
    mockEntry.mockReturnValue(new Promise(() => {}));
    render(<AccountDetail userId={ids.muted} historyPage={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading account...");
  });

  it.each([404, 400])("entry %i -> account not found with a way back", async (status) => {
    asAdmin();
    mockEntry.mockRejectedValue(new ApiError("x", "http", status));
    render(<AccountDetail userId="nope" historyPage={1} />);
    expect(await screen.findByText("Account not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to accounts" })).toHaveAttribute("href", "/admin/accounts");
  });

  it("entry 500 -> retryable error", async () => {
    asAdmin();
    mockEntry.mockRejectedValueOnce(new ApiError("x", "http", 500)).mockResolvedValueOnce(data("detailMuted"));
    mockHistory.mockResolvedValue(data("history"));
    render(<AccountDetail userId={ids.muted} historyPage={1} />);
    await userEvent.click(await screen.findByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByRole("heading", { name: "Mira Muted" })).toBeInTheDocument();
  });

  it("history loading, error (entry still shown), and empty are independent states", async () => {
    asAdmin();
    mockEntry.mockResolvedValue(data("detailMuted"));
    mockHistory.mockReturnValue(new Promise(() => {}));
    const first = render(<AccountDetail userId={ids.muted} historyPage={1} />);
    expect(await screen.findByText("Loading governance history...")).toBeInTheDocument();
    first.unmount();

    mockHistory.mockRejectedValue(new ApiError("x", "http", 500));
    const second = render(<AccountDetail userId={ids.muted} historyPage={1} />);
    expect(await screen.findByText("We could not load governance history. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mira Muted" })).toBeInTheDocument();
    second.unmount();

    mockHistory.mockResolvedValue(data("historyEmpty"));
    render(<AccountDetail userId={ids.muted} historyPage={1} />);
    expect(await screen.findByText("No governance history")).toBeInTheDocument();
  });

  it("history past-the-end page is explained", async () => {
    asAdmin();
    mockEntry.mockResolvedValue(data("detailMuted"));
    mockHistory.mockResolvedValue({ items: [], page: 9, limit: 20, total: 4, totalPages: 1 });
    render(<AccountDetail userId={ids.muted} historyPage={9} />);
    expect(await screen.findByText("No events on this page")).toBeInTheDocument();
  });
});

describe("entry rendering (privacy-safe)", () => {
  it("shows the allowed identity, state, restriction and the user-safe reason", async () => {
    asAdmin();
    mockEntry.mockResolvedValue(data("detailMuted"));
    mockHistory.mockResolvedValue(data("historyEmpty"));
    render(<AccountDetail userId={ids.muted} historyPage={1} />);
    const card = await screen.findByRole("region", { name: "Account" });
    expect(within(card).getByRole("heading", { name: "Mira Muted" })).toBeInTheDocument();
    expect(card).toHaveTextContent("mira.muted@example.test");
    expect(card).toHaveTextContent("User");
    expect(card).toHaveTextContent(/Registered/);
    expect(within(card).getByText("Muted")).toBeInTheDocument();
    expect(card).toHaveTextContent(/Until Nov \d+, 2026/);
    expect(card).toHaveTextContent("Please keep discussion civil");
    expect(card).toHaveTextContent(ids.muted);
  });

  it("indefinite suspension and deletion-pending indicators", async () => {
    asAdmin();
    mockHistory.mockResolvedValue(data("historyEmpty"));
    mockEntry.mockResolvedValue(data("detailSuspended"));
    const first = render(<AccountDetail userId={ids.suspended} historyPage={1} />);
    expect(await screen.findByText("No end date")).toBeInTheDocument();
    expect(screen.getByText("Repeated policy violations")).toBeInTheDocument();
    first.unmount();

    mockEntry.mockResolvedValue({
      ...data("detailMuted"),
      accountState: "DELETION_PENDING",
      restriction: null,
      deletionPending: true,
      deletionRequestedAt: "2026-11-23T10:00:00.000Z",
    });
    render(<AccountDetail userId={ids.deletion} historyPage={1} />);
    expect((await screen.findAllByText("Deletion pending")).length).toBeGreaterThan(0);
    expect(screen.getByText("Deletion requested Nov 23, 2026")).toBeInTheDocument();
  });

  it("Admin accounts and the viewer's own account carry the operator-managed note; others do not", async () => {
    mockHistory.mockResolvedValue(data("historyEmpty"));
    asAdmin("someone-else");
    mockEntry.mockResolvedValue(data("detailAdmin"));
    const peer = render(<AccountDetail userId={ids.admin} historyPage={1} />);
    expect(await screen.findByText(/managed by operators and cannot be restricted from here/)).toBeInTheDocument();
    peer.unmount();

    const own = data("detailMuted");
    asAdmin(String(own.id)); // viewing yourself, even when the record is not an Admin row
    mockEntry.mockResolvedValue(own);
    const self = render(<AccountDetail userId={String(own.id)} historyPage={1} />);
    expect(await screen.findByText(/managed by operators/)).toBeInTheDocument();
    self.unmount();

    asAdmin("someone-else");
    mockEntry.mockResolvedValue(own);
    render(<AccountDetail userId={String(own.id)} historyPage={1} />);
    await screen.findByRole("heading", { name: "Mira Muted" });
    expect(screen.queryByText(/managed by operators/)).not.toBeInTheDocument();
  });

  it("introduces no mutation capability", async () => {
    asAdmin();
    mockEntry.mockResolvedValue(data("detailMuted"));
    mockHistory.mockResolvedValue(data("history"));
    render(<AccountDetail userId={ids.muted} historyPage={1} />);
    await screen.findByRole("list", { name: "Governance history" });
    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const controls = [...screen.queryAllByRole("button"), ...screen.queryAllByRole("link")].map((e) => e.textContent ?? "");
    expect(controls.join("|")).not.toMatch(/\b(mute|suspend|lift|delete|revoke|restore|ban)\b/i);
  });
});

describe("governance history rendering", () => {
  it("renders the recorded events in API order with actor identity and SYSTEM clearly marked", async () => {
    asAdmin();
    mockEntry.mockResolvedValue(data("detailMuted"));
    mockHistory.mockResolvedValue(data("history"));
    render(<AccountDetail userId={ids.history} historyPage={1} />);
    const list = await screen.findByRole("list", { name: "Governance history" });
    const items = within(list).getAllByRole("listitem");
    const apiOrder = (data("history").items as { action: string }[]).map((e) => e.action);
    expect(apiOrder).toEqual(["HARD_SUSPEND", "MUTE_LIFTED", "MUTE", "SUSPENSION_LIFTED"]);
    expect(items.map((i) => i.querySelector("p")?.textContent)).toEqual(["Suspended", "Mute lifted", "Muted", "Suspension lifted"]);
    expect(items[0]).toHaveTextContent("Active to Suspended");
    expect(items[0]).toHaveTextContent("By Asha Admin");
    expect(items[2]).toHaveTextContent("Be civil");
    expect(items[3]).toHaveTextContent("By System (automatic)");
    expect(items[3]).toHaveTextContent("Suspended to Active");
    expect(items[0].querySelector("time")).toHaveAttribute("datetime");
  });

  it("never renders the private reason, references, idempotency key or actor email, even if present", async () => {
    asAdmin();
    mockEntry.mockResolvedValue(data("detailMuted"));
    const payload = data("history") as { items: Record<string, unknown>[] };
    mockHistory.mockResolvedValue({
      ...payload,
      items: payload.items.map((e) => ({
        ...e,
        reason: "LEAK-private-reason",
        references: [{ type: "APPEAL", id: "LEAK-ref" }],
        idempotencyKey: "LEAK-idem",
        actor: e.actor ? { ...(e.actor as object), email: "LEAK@actor.test" } : e.actor,
      })),
    });
    const { container } = render(<AccountDetail userId={ids.history} historyPage={1} />);
    await screen.findByRole("list", { name: "Governance history" });
    expect(container.innerHTML).not.toMatch(/LEAK/);
  });

  it("unknown actors, roles-as-states and unknown actions degrade safely", async () => {
    asAdmin();
    mockEntry.mockResolvedValue(data("detailMuted"));
    mockHistory.mockResolvedValue({
      items: [
        { id: "e1", action: "EXPERT_REVOKED", actorType: "USER", actor: { id: "a1", name: null }, previousState: "EXPERT", resultingState: "USER", safeReason: null, occurredAt: "2026-11-23T10:00:00.000Z" },
        { id: "e2", action: "BRAND_NEW_ACTION", actorType: "USER", actor: null, previousState: "ACTIVE", resultingState: "ACTIVE", safeReason: null, occurredAt: "2026-11-22T10:00:00.000Z" },
      ],
      page: 1, limit: 20, total: 2, totalPages: 1,
    });
    render(<AccountDetail userId={ids.muted} historyPage={1} />);
    const items = within(await screen.findByRole("list", { name: "Governance history" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Expert status revoked");
    expect(items[0]).toHaveTextContent("Expert to User");
    expect(items[0]).toHaveTextContent("By Unknown administrator");
    expect(items[1]).toHaveTextContent("Brand new action");
    expect(items[1]).toHaveTextContent("By Unknown actor");
  });

  it("history pagination is URL-driven and requests the right page", async () => {
    asAdmin();
    mockEntry.mockResolvedValue(data("detailMuted"));
    mockHistory.mockResolvedValue(data("historyPage2"));
    render(<AccountDetail userId={ids.history} historyPage={2} />);
    await screen.findByRole("list", { name: "Governance history" });
    expect(mockHistory).toHaveBeenCalledWith(ids.history, { page: 2 }, { signal: expect.any(AbortSignal) });
    const nav = screen.getByRole("navigation", { name: "History pages" });
    expect(nav).toHaveTextContent(/Page 2 of \d+/);
    expect(within(nav).getByRole("link", { name: "Previous" })).toHaveAttribute("href", `/admin/accounts/${ids.history}`);
  });
});
