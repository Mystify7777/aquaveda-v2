import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AccountDirectory } from "@/components/admin/account-directory";
import { parseDirectoryQuery } from "@/lib/accounts/directory";
import { ApiError } from "@/lib/api/client";
import envelopes from "@/test-utils/fixtures/account-directory-envelopes.json";

const mockGetDirectory = vi.fn();
const mockUseAuth = vi.fn();
vi.mock("@/lib/api/accounts", () => ({ getAccountDirectory: (...a: unknown[]) => mockGetDirectory(...a) }));
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

type Env = { body: { data: unknown } };
const data = (name: keyof typeof envelopes) => (envelopes[name] as unknown as Env).body.data as {
  items: Record<string, unknown>[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
const q = (params: Record<string, string> = {}) => parseDirectoryQuery(params);
const asAdmin = () => mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "admin-1", role: "ADMIN" } });
const rowFor = (name: string) => screen.getByRole("link", { name }).closest("tr") as HTMLElement;

beforeEach(() => {
  mockGetDirectory.mockReset();
  mockUseAuth.mockReset();
});

describe("authorization", () => {
  it.each(["USER", "EXPERT"])("%s: access message, NO request, no search form", (role) => {
    mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u", role } });
    render(<AccountDirectory query={q()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Administrator access required");
    expect(mockGetDirectory).not.toHaveBeenCalled();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("non-authenticated session states render nothing here (RequireAuth owns them)", () => {
    for (const status of ["initializing", "anonymous", "suspended", "session-failure", "unavailable"]) {
      mockUseAuth.mockReturnValue({ status, user: null });
      const { container, unmount } = render(<AccountDirectory query={q()} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    expect(mockGetDirectory).not.toHaveBeenCalled();
  });

  it("ADMIN: requests with the parsed query and an AbortSignal", async () => {
    asAdmin();
    mockGetDirectory.mockResolvedValue(data("directory"));
    render(<AccountDirectory query={q({ role: "USER", accountState: "MUTED", q: "mira", page: "2" })} />);
    await screen.findByRole("table");
    expect(mockGetDirectory).toHaveBeenCalledWith(
      { page: 2, role: "USER", accountState: "MUTED", q: "mira" },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("the backend's own refusal is still rendered (403), and 401 offers sign-in", async () => {
    asAdmin();
    mockGetDirectory.mockRejectedValue(new ApiError("Forbidden", "http", 403, "FORBIDDEN"));
    const { unmount } = render(<AccountDirectory query={q()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account is not permitted to view accounts.");
    unmount();
    mockGetDirectory.mockRejectedValue(new ApiError("x", "http", 401, "UNAUTHORIZED"));
    render(<AccountDirectory query={q()} />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("loading, error, empty", () => {
  it("loading state", () => {
    asAdmin();
    mockGetDirectory.mockReturnValue(new Promise(() => {}));
    render(<AccountDirectory query={q()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading accounts...");
  });

  it("error then retry re-requests", async () => {
    asAdmin();
    mockGetDirectory.mockRejectedValueOnce(new ApiError("x", "http", 500)).mockResolvedValueOnce(data("directory"));
    render(<AccountDirectory query={q()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load accounts. Try again.");
    await userEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(mockGetDirectory).toHaveBeenCalledTimes(2);
  });

  it("network failure is not a session message", async () => {
    asAdmin();
    mockGetDirectory.mockRejectedValue(new ApiError("x", "network"));
    render(<AccountDirectory query={q()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i);
  });

  it("empty: unfiltered vs filtered wording", async () => {
    asAdmin();
    mockGetDirectory.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    const { unmount } = render(<AccountDirectory query={q()} />);
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    unmount();
    render(<AccountDirectory query={q({ q: "zzzz" })} />);
    expect(await screen.findByText("No accounts match")).toBeInTheDocument();
  });

  it("past-the-end page: explains and links back to page 1 with the filters kept", async () => {
    asAdmin();
    mockGetDirectory.mockResolvedValue({ items: [], page: 9, limit: 20, total: 9, totalPages: 1 });
    render(<AccountDirectory query={q({ role: "USER", page: "9" })} />);
    expect(await screen.findByText("No accounts on this page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to first page" })).toHaveAttribute("href", "/admin/accounts?role=USER");
  });
});

describe("rendering the recorded directory (privacy-safe, read-only)", () => {
  it("renders every row with identity, role, state, restriction and deletion indicators", async () => {
    asAdmin();
    mockGetDirectory.mockResolvedValue(data("directory"));
    render(<AccountDirectory query={q()} />);
    await screen.findByRole("table");
    expect(screen.getByRole("status")).toHaveTextContent("9 accounts");
    expect(screen.getAllByRole("row")).toHaveLength(10); // header + 9

    const muted = rowFor("Mira Muted");
    expect(muted).toHaveTextContent("mira.muted@example.test");
    expect(within(muted).getByText("Muted")).toBeInTheDocument();
    expect(muted).toHaveTextContent(/Until Nov \d+, 2026/);

    const suspended = rowFor("Sam Suspended");
    expect(within(suspended).getByText("Suspended")).toBeInTheDocument();
    expect(suspended).toHaveTextContent("No end date");

    const lapsed = rowFor("Lena Lapsed");
    expect(within(lapsed).getByText("Lapsed")).toBeInTheDocument();
    expect(lapsed).toHaveTextContent("not yet lifted");

    const deletion = rowFor("Dev Deleting");
    expect(within(deletion).getByText("Deletion pending")).toBeInTheDocument();
    expect(deletion).toHaveTextContent("Deletion requested");

    expect(within(rowFor("Peer Admin")).getByText("Admin")).toBeInTheDocument();
    expect(within(rowFor("Eli Expert")).getByText("Expert")).toBeInTheDocument();
    expect(within(rowFor("Uma User")).getByText("Active")).toBeInTheDocument();
  });

  it("rows keep the API's order and link to the detail view by id", async () => {
    asAdmin();
    const payload = data("directory");
    mockGetDirectory.mockResolvedValue(payload);
    render(<AccountDirectory query={q()} />);
    await screen.findByRole("table");
    const rowNames = within(screen.getByRole("table")).getAllByRole("rowheader").map((c) => c.querySelector("a")?.textContent);
    expect(rowNames).toEqual(payload.items.map((i) => i.name));
    const hrefs = screen.getAllByRole("link", { name: /^[A-Z]/ }).filter((l) => l.getAttribute("href")?.startsWith("/admin/accounts/"));
    expect(hrefs.map((l) => l.getAttribute("href"))).toEqual(payload.items.map((i) => `/admin/accounts/${i.id}`));
  });

  it("never renders a field the API excludes, even if a payload carried it", async () => {
    asAdmin();
    const payload = data("directory");
    payload.items[0] = {
      ...payload.items[0],
      reason: "LEAK-private-reason",
      references: [{ type: "X", id: "LEAK-ref" }],
      idempotencyKey: "LEAK-idem",
      passwordHash: "LEAK-hash",
      bio: "LEAK-bio",
      authGeneration: 99,
      expertApplication: { details: "LEAK-expert" },
    };
    mockGetDirectory.mockResolvedValue(payload);
    const { container } = render(<AccountDirectory query={q()} />);
    await screen.findByRole("table");
    expect(container.innerHTML).not.toMatch(/LEAK/);
  });

  it("introduces no mutation capability: no buttons in the results, only a GET search form", async () => {
    asAdmin();
    mockGetDirectory.mockResolvedValue(data("directory"));
    render(<AccountDirectory query={q()} />);
    await screen.findByRole("table");
    const forms = document.querySelectorAll("form");
    expect(forms).toHaveLength(1);
    expect(forms[0].getAttribute("method")).toBe("get");
    expect(forms[0].getAttribute("action")).toBe("/admin/accounts");
    const names = [...screen.queryAllByRole("button"), ...screen.queryAllByRole("link")].map((e) => e.textContent ?? "");
    expect(names.join("|")).not.toMatch(/\b(mute|suspend|lift|delete|revoke|restore|ban)\b/i);
  });
});

describe("filters and search", () => {
  it("shows the current values, a Clear link only when active, and a GET form without page", async () => {
    asAdmin();
    mockGetDirectory.mockResolvedValue(data("directoryFiltered"));
    render(<AccountDirectory query={q({ role: "USER", accountState: "MUTED", q: "mira", page: "3" })} />);
    await screen.findByRole("table");
    expect(screen.getByLabelText("Search")).toHaveValue("mira");
    expect(screen.getByLabelText("Role")).toHaveValue("USER");
    expect(screen.getByLabelText("Account state")).toHaveValue("MUTED");
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/admin/accounts");
    expect(document.querySelector('form input[name="page"]')).toBeNull();
  });

  it("offers exactly the backend's roles and states, with human labels", () => {
    asAdmin();
    mockGetDirectory.mockReturnValue(new Promise(() => {}));
    render(<AccountDirectory query={q()} />);
    const roles = within(screen.getByLabelText("Role")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(roles).toEqual(["", "USER", "EXPERT", "ADMIN"]);
    const states = within(screen.getByLabelText("Account state")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(states).toEqual(["", "ACTIVE", "MUTED", "HARD_SUSPENDED", "DELETION_PENDING", "PERMANENTLY_DELETED"]);
    expect(screen.queryByRole("link", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it.each([
    ["an unknown parameter", { junk: "x" }, /Unknown parameter: junk\./],
    ["an invalid role", { role: "ADMN" }, /Role "ADMN" is not recognised\. Use User, Expert or Admin\./],
    ["an invalid accountState", { accountState: "BANNED" }, /Account state "BANNED" is not recognised\./],
    ["an invalid page", { page: "0" }, /Page must be a positive whole number\./],
  ])("%s: surfaced as an alert, NO request, no results (never silently broadened)", (_label, params, message) => {
    asAdmin();
    render(<AccountDirectory query={q(params as Record<string, string>)} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This link can't be applied as written, so no results are shown");
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveTextContent("Fix or clear the filters to continue.");
    expect(mockGetDirectory).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("No accounts match")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/admin/accounts");
  });

  it("a repeated parameter and several problems are all listed, still with no request", () => {
    asAdmin();
    render(<AccountDirectory query={q({ junk: "1", role: ["USER", "ADMIN"] as unknown as string, q: "a" })} />);
    const items = within(screen.getByRole("alert")).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Unknown parameter: junk.", "Only one value is allowed for: role.", "Search needs at least 2 characters."]);
    expect(mockGetDirectory).not.toHaveBeenCalled();
  });

  it("a valid query still sends exactly the same API parameters as before", async () => {
    asAdmin();
    mockGetDirectory.mockResolvedValue(data("directory"));
    render(<AccountDirectory query={q({ role: "EXPERT", accountState: "HARD_SUSPENDED", q: "  sam  ", page: "2" })} />);
    await screen.findByRole("table");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockGetDirectory).toHaveBeenCalledTimes(1);
    expect(mockGetDirectory).toHaveBeenCalledWith(
      { page: 2, role: "EXPERT", accountState: "HARD_SUSPENDED", q: "sam" },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("blank filter values from the GET form are valid and send only the page", async () => {
    asAdmin();
    mockGetDirectory.mockResolvedValue(data("directory"));
    render(<AccountDirectory query={q({ q: "", role: "", accountState: "" })} />);
    await screen.findByRole("table");
    expect(mockGetDirectory).toHaveBeenCalledWith({ page: 1 }, { signal: expect.any(AbortSignal) });
  });

  it("an invalid search is explained, kept in the field, and never sent", () => {
    asAdmin();
    render(<AccountDirectory query={q({ q: "a" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Search needs at least 2 characters.");
    expect(screen.getByLabelText("Search")).toHaveValue("a");
    expect(screen.getByLabelText("Search")).toHaveAttribute("aria-invalid", "true");
    expect(mockGetDirectory).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("pagination matches the backend (offset pages, filters preserved)", () => {
  it("page 2 of 3: previous drops to the bare page, next adds page=3, in the fixed parameter order", async () => {
    asAdmin();
    mockGetDirectory.mockResolvedValue(data("directoryPage2"));
    render(<AccountDirectory query={q({ role: "USER", accountState: "ACTIVE", q: "ab", page: "2" })} />);
    await screen.findByRole("table");
    const nav = screen.getByRole("navigation", { name: "Accounts pages" });
    expect(nav).toHaveTextContent("Page 2 of 3");
    expect(within(nav).getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/admin/accounts?role=USER&accountState=ACTIVE&q=ab");
    expect(within(nav).getByRole("link", { name: "Next" })).toHaveAttribute("href", "/admin/accounts?role=USER&accountState=ACTIVE&q=ab&page=3");
  });

  it("a single page renders no pagination", async () => {
    asAdmin();
    mockGetDirectory.mockResolvedValue({ ...data("directory"), totalPages: 1 });
    render(<AccountDirectory query={q()} />);
    await screen.findByRole("table");
    expect(screen.queryByRole("navigation", { name: "Accounts pages" })).not.toBeInTheDocument();
  });
});
