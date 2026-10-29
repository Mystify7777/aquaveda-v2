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
const mockSearch = vi.fn();

vi.mock("@/lib/api/geocode", () => ({ searchLocations: (q: string, init?: unknown) => mockSearch(q, init) }));
vi.mock("@/lib/api/issues", () => ({ createIssue: (p: unknown) => mockCreateIssue(p) }));
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

const CREATED = { _id: "i1", title: "Leak", status: "open" };

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^title/i), "Leak");
  await user.type(screen.getByLabelText(/^description/i), "Pipe burst");
  await user.click(screen.getByRole("button", { name: "Enter coordinates" }));
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

const ATTRIBUTION = { text: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" };
const PATNA = { label: "Kankarbagh, Patna, Bihar, India", latitude: 25.5941, longitude: 85.1376 };

async function searchFor(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText("Place"), text);
  await user.click(screen.getByRole("button", { name: "Search" }));
}

describe("IssueReportForm place search (#134)", () => {
  beforeEach(() => {
    mockCreateIssue.mockReset();
    mockSearch.mockReset();
    mockUseAuth.mockReturnValue({ status: "authenticated" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("coordinates are collapsed by default; place search is the primary input", () => {
    render(<IssueReportForm />);
    expect(screen.getByLabelText("Place")).toBeVisible();
    expect(screen.getByRole("button", { name: "Enter coordinates" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText(/^latitude/i)).not.toBeVisible();
  });

  it("search -> select fills coordinates and submits label + [lng, lat] without typing any coordinate", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ results: [PATNA], attribution: ATTRIBUTION });
    mockCreateIssue.mockResolvedValue(CREATED);
    render(<IssueReportForm />);
    await user.type(screen.getByLabelText(/^title/i), "Leak");
    await user.type(screen.getByLabelText(/^description/i), "Pipe burst");
    await searchFor(user, "Kankarbagh");
    expect(mockSearch).toHaveBeenCalledWith("Kankarbagh", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByRole("link", { name: ATTRIBUTION.text })).toHaveAttribute("href", ATTRIBUTION.url);
    await user.click(await screen.findByRole("button", { name: PATNA.label }));
    expect(screen.getByText(PATNA.label)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /search results/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^latitude/i)).toHaveValue("25.594100");
    expect(screen.getByLabelText(/^longitude/i)).toHaveValue("85.137600");
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(mockCreateIssue).toHaveBeenCalledWith({
      title: "Leak",
      description: "Pipe burst",
      location: { type: "Point", coordinates: [85.1376, 25.5941] },
      locationLabel: PATNA.label,
    });
  });

  it("Enter in the place field searches and does not submit the report", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ results: [PATNA], attribution: ATTRIBUTION });
    render(<IssueReportForm />);
    await user.type(screen.getByLabelText("Place"), "Kankarbagh{Enter}");
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockCreateIssue).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: PATNA.label })).toBeInTheDocument();
  });

  it("searches only on submit, never per keystroke, and rejects too-short input locally", async () => {
    const user = userEvent.setup();
    render(<IssueReportForm />);
    await user.type(screen.getByLabelText("Place"), "Pa");
    expect(mockSearch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(mockSearch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 3 characters/i);
  });

  it("no-results state is explained and leaves manual entry available", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ results: [], attribution: ATTRIBUTION });
    render(<IssueReportForm />);
    await searchFor(user, "zzzzzz");
    expect(await screen.findByText(/no places found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter coordinates" })).toBeEnabled();
  });

  it.each([
    ["provider unavailable (503)", new ApiError("x", "http", 503, "GEOCODER_UNAVAILABLE"), /unavailable right now/i],
    ["rate limited (429)", new ApiError("x", "http", 429, "TOO_MANY_REQUESTS"), /too many searches/i],
    ["network failure", new ApiError("x", "network"), /could not reach the service/i],
  ])("%s: shows a clear error and the report is still submittable by coordinates", async (_n, error, text) => {
    const user = userEvent.setup();
    mockSearch.mockRejectedValue(error);
    mockCreateIssue.mockResolvedValue(CREATED);
    render(<IssueReportForm />);
    await searchFor(user, "Kankarbagh");
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(mockCreateIssue).toHaveBeenCalledWith({
      title: "Leak",
      description: "Pipe burst",
      location: { type: "Point", coordinates: [77.5, 12.9] },
    });
  });

  it("401 from search offers sign-in", async () => {
    const user = userEvent.setup();
    mockSearch.mockRejectedValue(new ApiError("x", "http", 401, "UNAUTHORIZED"));
    render(<IssueReportForm />);
    await searchFor(user, "Kankarbagh");
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
  });

  it("Enter while a search is in flight does not restart it (same rule as the disabled Search button)", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    let signal: AbortSignal | undefined;
    mockSearch.mockImplementation((_q: string, init?: { signal?: AbortSignal }) => {
      signal = init?.signal;
      return new Promise((r) => (resolve = r));
    });
    render(<IssueReportForm />);
    await searchFor(user, "Kankarbagh");
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
    await user.type(screen.getByLabelText("Place"), "{Enter}{Enter}");
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);
    resolve({ results: [PATNA], attribution: ATTRIBUTION });
    expect(await screen.findByRole("button", { name: PATNA.label })).toBeInTheDocument();
  });

  it("a new search after the previous one finished is allowed (Enter), replacing the results", async () => {
    const user = userEvent.setup();
    mockSearch
      .mockResolvedValueOnce({ results: [{ ...PATNA, label: "First" }], attribution: ATTRIBUTION })
      .mockResolvedValueOnce({ results: [{ ...PATNA, label: "Second" }], attribution: ATTRIBUTION });
    render(<IssueReportForm />);
    await searchFor(user, "one");
    expect(await screen.findByRole("button", { name: "First" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Place"), "{Enter}");
    expect(await screen.findByRole("button", { name: "Second" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "First" })).not.toBeInTheDocument();
  });

  it("unmounting aborts an in-flight search and never updates state afterwards", async () => {
    const user = userEvent.setup();
    let signal: AbortSignal | undefined;
    mockSearch.mockImplementation((_q: string, init?: { signal?: AbortSignal }) => {
      signal = init?.signal;
      return new Promise(() => {});
    });
    const { unmount } = render(<IssueReportForm />);
    await searchFor(user, "Kankarbagh");
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("discloses, at the point of use, that the search text goes to a third-party service and device location does not", () => {
    render(<IssueReportForm />);
    expect(screen.getByText(/search for is sent to a third-party place-search service/i)).toBeInTheDocument();
    expect(screen.getByText(/your device location is not/i)).toBeInTheDocument();
  });

  it("editing coordinates by hand after choosing a place drops the label", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ results: [PATNA], attribution: ATTRIBUTION });
    mockCreateIssue.mockResolvedValue(CREATED);
    render(<IssueReportForm />);
    await user.type(screen.getByLabelText(/^title/i), "Leak");
    await user.type(screen.getByLabelText(/^description/i), "Pipe burst");
    await searchFor(user, "Kankarbagh");
    await user.click(await screen.findByRole("button", { name: PATNA.label }));
    await user.click(screen.getByRole("button", { name: "Enter coordinates" }));
    await user.clear(screen.getByLabelText(/^latitude/i));
    await user.type(screen.getByLabelText(/^latitude/i), "10.5");
    expect(screen.queryByText(PATNA.label)).not.toBeInTheDocument();
    expect(screen.getByText(/no place name will be saved/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(mockCreateIssue.mock.calls[0][0]).not.toHaveProperty("locationLabel");
  });

  it("GPS after choosing a place drops the label and never calls the geocoder", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 1.5, longitude: 2.5 } } as GeolocationPosition) },
    });
    mockSearch.mockResolvedValue({ results: [PATNA], attribution: ATTRIBUTION });
    mockCreateIssue.mockResolvedValue(CREATED);
    render(<IssueReportForm />);
    await user.type(screen.getByLabelText(/^title/i), "Leak");
    await user.type(screen.getByLabelText(/^description/i), "Pipe burst");
    await searchFor(user, "Kankarbagh");
    await user.click(await screen.findByRole("button", { name: PATNA.label }));
    expect(mockSearch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Use my current location" }));
    expect(mockSearch).toHaveBeenCalledTimes(1); // device position is never sent to the geocoder
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    const payload = mockCreateIssue.mock.calls[0][0];
    expect(payload.location.coordinates).toEqual([2.5, 1.5]);
    expect(payload).not.toHaveProperty("locationLabel");
  });

  it("place search does not request browser geolocation", async () => {
    const user = userEvent.setup();
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });
    mockSearch.mockResolvedValue({ results: [PATNA], attribution: ATTRIBUTION });
    render(<IssueReportForm />);
    await searchFor(user, "Kankarbagh");
    await user.click(await screen.findByRole("button", { name: PATNA.label }));
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("Clear removes the selected place and its coordinates", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ results: [PATNA], attribution: ATTRIBUTION });
    render(<IssueReportForm />);
    await searchFor(user, "Kankarbagh");
    await user.click(await screen.findByRole("button", { name: PATNA.label }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText(PATNA.label)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^latitude/i)).toHaveValue("");
    expect(screen.getByLabelText("Place")).toHaveFocus();
  });

  it("submitting with no location guides to the place field (coordinates stay collapsed)", async () => {
    const user = userEvent.setup();
    render(<IssueReportForm />);
    await user.type(screen.getByLabelText(/^title/i), "Leak");
    await user.type(screen.getByLabelText(/^description/i), "Pipe burst");
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(mockCreateIssue).not.toHaveBeenCalled();
    expect(screen.getByText(/choose a place, use your current location, or enter coordinates/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Place")).toHaveFocus();
  });

  it("invalid typed coordinates expand the section and focus the offending field", async () => {
    const user = userEvent.setup();
    render(<IssueReportForm />);
    await user.type(screen.getByLabelText(/^title/i), "Leak");
    await user.type(screen.getByLabelText(/^description/i), "Pipe burst");
    await user.click(screen.getByRole("button", { name: "Enter coordinates" }));
    await user.type(screen.getByLabelText(/^latitude/i), "95");
    await user.click(screen.getByRole("button", { name: "Enter coordinates" })); // collapse again
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(screen.getByRole("button", { name: "Enter coordinates" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(/^latitude/i)).toHaveFocus();
    expect(screen.getByText(/latitude must be between/i)).toBeInTheDocument();
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });
});
