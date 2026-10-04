import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IssueReportForm } from "@/components/issues/issue-report-form";
import { ReportIssueButton } from "@/components/issues/report-issue-button";
import { ApiError } from "@/lib/api/client";
import { ISSUE_CATEGORIES, ISSUE_SEVERITIES } from "@/lib/issues/classification";

const mockCreateIssue = vi.fn();
const mockUseAuth = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/lib/api/issues", () => ({ createIssue: (p: unknown) => mockCreateIssue(p) }));
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

const CREATED = { _id: "i1", title: "Leak", status: "open" };

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^title/i), "Leak");
  await user.type(screen.getByLabelText(/^description/i), "Pipe burst");
  await user.type(screen.getByLabelText(/^latitude/i), "12.9");
  await user.type(screen.getByLabelText(/^longitude/i), "77.5");
}

describe("IssueReportForm", () => {
  beforeEach(() => {
    mockCreateIssue.mockReset();
    mockUseAuth.mockReturnValue({ status: "authenticated" });
  });

  it("idle: renders labelled fields and an enabled submit", () => {
    render(<IssueReportForm />);
    expect(screen.getByRole("button", { name: "Submit report" })).toBeEnabled();
    expect(screen.getByLabelText(/^title/i)).toBeInTheDocument();
  });

  it("valid submission sends the contract payload and shows success", async () => {
    const user = userEvent.setup();
    mockCreateIssue.mockResolvedValue(CREATED);
    render(<IssueReportForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(mockCreateIssue).toHaveBeenCalledWith({
      title: "Leak",
      description: "Pipe burst",
      location: { type: "Point", coordinates: [77.5, 12.9] },
    });
    expect(await screen.findByText("Issue reported")).toBeInTheDocument();
  });

  it("invalid input: shows field errors, focuses first invalid, never calls API", async () => {
    const user = userEvent.setup();
    render(<IssueReportForm />);
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(mockCreateIssue).not.toHaveBeenCalled();
    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^title/i)).toHaveFocus();
    expect(screen.getByLabelText(/^title/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("submitting: disables controls and blocks duplicate submission", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    mockCreateIssue.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<IssueReportForm />);
    await fill(user);
    const form = screen.getByRole("button", { name: "Submit report" }).closest("form")!;
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
    expect(form).toHaveAttribute("aria-busy", "true");
    await user.type(screen.getByLabelText(/^title/i), "x"); // disabled, no-op
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(mockCreateIssue).toHaveBeenCalledTimes(1);
    resolve(CREATED);
    await screen.findByText("Issue reported");
  });

  it("API/domain failure: shows message, preserves input", async () => {
    const user = userEvent.setup();
    mockCreateIssue.mockRejectedValue(new ApiError("title is required", "http", 400, "VALIDATION_FAILED"));
    render(<IssueReportForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("title is required");
    expect(screen.getByLabelText(/^title/i)).toHaveValue("Leak");
  });

  it("network failure: unavailable message, not a session message; retry works", async () => {
    const user = userEvent.setup();
    mockCreateIssue.mockRejectedValueOnce(new ApiError("Failed to fetch", "network"));
    mockCreateIssue.mockResolvedValueOnce(CREATED);
    render(<IssueReportForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unreachable/i);
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() => expect(screen.getByText("Issue reported")).toBeInTheDocument());
  });

  it("backend 401: prompts sign-in", async () => {
    const user = userEvent.setup();
    mockCreateIssue.mockRejectedValue(new ApiError("Authentication required", "http", 401, "UNAUTHORIZED"));
    render(<IssueReportForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
  });
});

describe("IssueReportForm classification", () => {
  beforeEach(() => {
    mockCreateIssue.mockReset();
    mockUseAuth.mockReturnValue({ status: "authenticated" });
  });

  function optionValues(select: HTMLElement) {
    return Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"));
  }

  it("presents exactly the canonical values (plus 'Not specified') as selects", () => {
    render(<IssueReportForm />);
    const category = screen.getByLabelText(/^category/i);
    const severity = screen.getByLabelText(/^severity/i);
    expect(category.tagName).toBe("SELECT");
    expect(severity.tagName).toBe("SELECT");
    expect(optionValues(category)).toEqual(["", ...ISSUE_CATEGORIES.map((c) => c.value)]);
    expect(optionValues(severity)).toEqual(["", ...ISSUE_SEVERITIES.map((s) => s.value)]);
    expect(screen.getByRole("option", { name: ISSUE_CATEGORIES[0].label })).toBeInTheDocument();
  });

  it("submits without category/severity (both optional)", async () => {
    const user = userEvent.setup();
    mockCreateIssue.mockResolvedValue(CREATED);
    render(<IssueReportForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    const payload = mockCreateIssue.mock.calls[0][0];
    expect(payload).not.toHaveProperty("category");
    expect(payload).not.toHaveProperty("severity");
  });

  it("submits selected canonical category/severity and shows guidance", async () => {
    const user = userEvent.setup();
    mockCreateIssue.mockResolvedValue(CREATED);
    render(<IssueReportForm />);
    await fill(user);
    await user.selectOptions(screen.getByLabelText(/^category/i), "water_quality");
    await user.selectOptions(screen.getByLabelText(/^severity/i), "high");
    expect(screen.getByText(ISSUE_SEVERITIES.find((s) => s.value === "high")!.description)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ category: "water_quality", severity: "high" }),
    );
  });

  it("cannot introduce a non-canonical value through the UI", async () => {
    const user = userEvent.setup();
    render(<IssueReportForm />);
    await expect(user.selectOptions(screen.getByLabelText(/^category/i), "infrastructure")).rejects.toThrow();
    expect(screen.getByLabelText(/^category/i)).toHaveValue("");
  });
});

describe("IssueReportForm geolocation", () => {
  beforeEach(() => {
    mockCreateIssue.mockReset();
    mockUseAuth.mockReturnValue({ status: "authenticated" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubGeolocation(impl: (ok: PositionCallback, err: PositionErrorCallback) => void) {
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition: impl } });
  }

  it("success: populates latitude and longitude; manual edit and submit still work", async () => {
    const user = userEvent.setup();
    stubGeolocation((ok) =>
      ok({ coords: { latitude: 25.594095, longitude: 85.137566 } } as GeolocationPosition),
    );
    mockCreateIssue.mockResolvedValue(CREATED);
    render(<IssueReportForm />);
    await user.click(screen.getByRole("button", { name: "Use my current location" }));
    expect(screen.getByLabelText(/^latitude/i)).toHaveValue("25.594095");
    expect(screen.getByLabelText(/^longitude/i)).toHaveValue("85.137566");
    await user.type(screen.getByLabelText(/^title/i), "Leak");
    await user.type(screen.getByLabelText(/^description/i), "Pipe burst");
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ location: { type: "Point", coordinates: [85.137566, 25.594095] } }),
    );
  });

  it("failure: shows manual-entry fallback and leaves coordinates untouched", async () => {
    const user = userEvent.setup();
    stubGeolocation((_ok, err) => err({ code: 1, message: "denied" } as GeolocationPositionError));
    render(<IssueReportForm />);
    await user.click(screen.getByRole("button", { name: "Use my current location" }));
    expect(screen.getByRole("status")).toHaveTextContent(/enter coordinates manually/i);
    expect(screen.getByLabelText(/^latitude/i)).toHaveValue("");
  });

  it("unavailable: shows manual-entry fallback when geolocation is unsupported", async () => {
    const user = userEvent.setup();
    const { geolocation: _omit, ...rest } = navigator as Navigator & { geolocation?: unknown };
    void _omit;
    vi.stubGlobal("navigator", rest);
    render(<IssueReportForm />);
    await user.click(screen.getByRole("button", { name: "Use my current location" }));
    expect(screen.getByRole("status")).toHaveTextContent(/enter coordinates manually/i);
  });
});

describe("ReportIssueButton authentication boundary", () => {
  it("anonymous: dialog shows sign-in guidance, not the form", async () => {
    mockUseAuth.mockReturnValue({ status: "anonymous" });
    const user = userEvent.setup();
    render(<ReportIssueButton />);
    await user.click(screen.getByRole("button", { name: "Report an issue" }));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.queryByLabelText(/^title/i)).not.toBeInTheDocument();
  });

  it("authenticated: dialog shows the form", async () => {
    mockUseAuth.mockReturnValue({ status: "authenticated" });
    const user = userEvent.setup();
    render(<ReportIssueButton />);
    await user.click(screen.getByRole("button", { name: "Report an issue" }));
    expect(screen.getByLabelText(/^title/i)).toBeInTheDocument();
  });
});

describe("report flow → Explore list integration (#50)", () => {
  beforeEach(() => {
    mockCreateIssue.mockReset();
    mockRefresh.mockReset();
    mockUseAuth.mockReturnValue({ status: "authenticated" });
  });

  it("IssueReportForm calls onCreated once on success only, and offers a link to the new issue", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    mockCreateIssue.mockRejectedValueOnce(new ApiError("boom", "http", 500));
    mockCreateIssue.mockResolvedValueOnce(CREATED);
    render(<IssueReportForm onCreated={onCreated} />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    await screen.findByRole("alert");
    expect(onCreated).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(await screen.findByText("Issue reported")).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(CREATED);
    expect(screen.getByRole("link", { name: "View issue" })).toHaveAttribute("href", "/explore/i1");
  });

  it("ReportIssueButton refreshes the server-rendered list after a successful report", async () => {
    const user = userEvent.setup();
    mockCreateIssue.mockResolvedValue(CREATED);
    render(<ReportIssueButton />);
    await user.click(screen.getByRole("button", { name: "Report an issue" }));
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    await screen.findByText("Issue reported");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("ReportIssueButton does not refresh when the report fails", async () => {
    const user = userEvent.setup();
    mockCreateIssue.mockRejectedValue(new ApiError("boom", "http", 500));
    render(<ReportIssueButton />);
    await user.click(screen.getByRole("button", { name: "Report an issue" }));
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    await screen.findByRole("alert");
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
