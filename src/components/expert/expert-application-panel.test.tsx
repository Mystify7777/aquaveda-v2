import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExpertApplicationPanel } from "@/components/expert/expert-application-panel";
import { ExpertStatusProvider } from "@/components/expert/expert-status-provider";
import { ApiError } from "@/lib/api/client";
import type { ExpertSubmission, MyExpertApplication } from "@/lib/api/types/expert-application";

const mockApply = vi.fn();
const mockMine = vi.fn();
const mockList = vi.fn();
vi.mock("@/lib/api/expert-application", () => ({
  applyForExpert: (r: unknown) => mockApply(r),
  getMyExpertApplication: () => mockMine(),
  getPendingExpertApplications: (q: unknown) => mockList(q),
}));
const mockUseAuth = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));
const mockRefreshUser = vi.fn();

const as = (role: string) =>
  mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role }, refreshUser: mockRefreshUser });

const EXPERIENCE = "Ten years of borewell recharge monitoring across three districts, with community training.";
const sub = (over: Partial<ExpertSubmission> = {}): ExpertSubmission => ({
  expertiseAreas: ["groundwater_wells"],
  experience: EXPERIENCE,
  references: ["https://example.org/a"],
  acknowledgement: { version: 1, acceptedAt: "2026-03-05T10:00:00.000Z" },
  ...over,
});
const none: MyExpertApplication = { status: "none", history: [] };
const pendingApp = (submission: ExpertSubmission | null = sub()): MyExpertApplication => ({
  status: "pending",
  history: [{ fromStatus: null, toStatus: "pending", submission, timestamp: "2026-03-05T10:00:00.000Z" }],
});
const rejectedApp: MyExpertApplication = {
  status: "rejected",
  history: [
    { fromStatus: null, toStatus: "pending", submission: sub(), timestamp: "2026-03-05T10:00:00.000Z" },
    { fromStatus: "pending", toStatus: "rejected", note: "Add more detail", timestamp: "2026-03-06T10:00:00.000Z" },
  ],
};
const approvedApp: MyExpertApplication = {
  status: "approved",
  history: [
    { fromStatus: null, toStatus: "pending", submission: sub(), timestamp: "2026-03-05T10:00:00.000Z" },
    { fromStatus: "pending", toStatus: "approved", timestamp: "2026-03-06T10:00:00.000Z" },
  ],
};

const ui = () => (
  <ExpertStatusProvider>
    <ExpertApplicationPanel />
  </ExpertStatusProvider>
);

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, label = /^submit application/i) {
  await user.click(screen.getByRole("checkbox", { name: /groundwater and wells/i }));
  await user.type(screen.getByLabelText(/what have you worked on/i), EXPERIENCE);
  await user.click(screen.getByRole("checkbox", { name: /i confirm that the information/i }));
  await user.click(screen.getByRole("button", { name: label }));
}

beforeEach(() => {
  mockApply.mockReset();
  mockMine.mockReset();
  mockList.mockReset();
  mockUseAuth.mockReset();
  mockRefreshUser.mockReset();
  mockRefreshUser.mockResolvedValue({ id: "u1", role: "EXPERT" });
});

describe("loading and load failure", () => {
  it("shows a loading status first", () => {
    as("USER");
    mockMine.mockReturnValue(new Promise(() => {}));
    render(ui());
    expect(screen.getByRole("status")).toHaveTextContent(/loading your application/i);
  });

  it("a load failure is a retryable alert; retry re-reads; 401 offers sign-in", async () => {
    as("USER");
    mockMine.mockRejectedValueOnce(new ApiError("down", "network"));
    const user = userEvent.setup();
    render(ui());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    mockMine.mockResolvedValueOnce(none);
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("button", { name: /submit application/i })).toBeInTheDocument();
  });

  it("an expired session offers sign-in", async () => {
    as("USER");
    mockMine.mockRejectedValue(new ApiError("x", "http", 401));
    render(ui());
    expect(await screen.findByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/auth/login");
  });
});

describe("never applied", () => {
  it("explains what Experts do and what approval grants, then shows the form", async () => {
    as("USER");
    mockMine.mockResolvedValue(none);
    render(ui());
    expect(await screen.findByText(/Experts review the Knowledge articles/i)).toBeInTheDocument();
    expect(screen.getByText(/not administrator powers/i)).toBeInTheDocument();
    expect(screen.getAllByText(/not shown publicly/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /submit application/i })).toBeInTheDocument();
  });

  it("an invalid form sends nothing; a valid one sends the contract request and then shows pending with the submission and timeline", async () => {
    as("USER");
    mockMine.mockResolvedValue(none);
    const user = userEvent.setup();
    render(ui());
    await user.click(await screen.findByRole("button", { name: /submit application/i }));
    expect(mockApply).not.toHaveBeenCalled();

    mockApply.mockResolvedValue(pendingApp());
    await fillAndSubmit(user);
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(mockApply).toHaveBeenCalledWith({
      expertiseAreas: ["groundwater_wells"],
      experience: EXPERIENCE,
      references: [],
      acknowledgement: { version: 1 },
    });
    expect(await screen.findByText(/awaiting review by an administrator/i)).toBeInTheDocument();
    expect(screen.getByText("What you submitted")).toBeInTheDocument();
    expect(screen.getByText("Groundwater and wells")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /example\.org/ })).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.getByText(/no fixed review time/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit application/i })).not.toBeInTheDocument();
    expect(mockMine).toHaveBeenCalledTimes(1); // the apply response is authoritative; no extra read
  });

  it("double-submitting sends ONE request while it is in flight", async () => {
    as("USER");
    mockMine.mockResolvedValue(none);
    let finish!: (v: unknown) => void;
    mockApply.mockReturnValue(new Promise((r) => (finish = r)));
    const user = userEvent.setup();
    render(ui());
    await user.click(await screen.findByRole("checkbox", { name: /groundwater and wells/i }));
    await user.type(screen.getByLabelText(/what have you worked on/i), EXPERIENCE);
    await user.click(screen.getByRole("checkbox", { name: /i confirm that the information/i }));
    await user.dblClick(screen.getByRole("button", { name: /^submit application/i }));
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /^submitting/i })).toBeDisabled();
    finish(pendingApp());
    expect(await screen.findByText(/awaiting review/i, { selector: "p" })).toBeInTheDocument();
  });

  it("a 409 'already in progress' tells the user and re-reads the REAL state", async () => {
    as("USER");
    mockMine.mockResolvedValueOnce(none);
    const user = userEvent.setup();
    render(ui());
    await screen.findByRole("button", { name: /submit application/i });
    mockApply.mockRejectedValue(new ApiError("x", "http", 409, "INVALID_STATE"));
    mockMine.mockResolvedValueOnce(pendingApp());
    await fillAndSubmit(user);
    await waitFor(() => expect(mockMine).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/awaiting review by an administrator/i)).toBeInTheDocument();
  });

  it("429 shows a calm retry-later message and keeps the form (and answers) intact", async () => {
    as("USER");
    mockMine.mockResolvedValue(none);
    mockApply.mockRejectedValue(new ApiError("x", "http", 429));
    const user = userEvent.setup();
    render(ui());
    await screen.findByRole("button", { name: /submit application/i });
    await fillAndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/too many attempts/i);
    expect(screen.getByLabelText(/what have you worked on/i)).toHaveValue(EXPERIENCE);
    expect(screen.getByRole("button", { name: /^submit application/i })).toBeEnabled();
  });
});

describe("pending", () => {
  it("a legacy application (no details) says so instead of showing an empty submission", async () => {
    as("USER");
    mockMine.mockResolvedValue(pendingApp(null));
    render(ui());
    expect(await screen.findByTestId("legacy-submission")).toHaveTextContent(/before application details were collected/i);
    expect(screen.queryByText("Areas of expertise")).not.toBeInTheDocument();
  });
});

describe("rejected", () => {
  it("shows the reviewer note, the timeline, and re-opens the form PREFILLED but with the acknowledgement unaccepted", async () => {
    as("USER");
    mockMine.mockResolvedValue(rejectedApp);
    const user = userEvent.setup();
    render(ui());
    expect(await screen.findByText(/was not approved/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Add more detail/).length).toBeGreaterThan(0);
    expect(screen.getByText("Not approved", { selector: "span.font-medium" })).toBeInTheDocument();
    expect(screen.getByLabelText(/what have you worked on/i)).toHaveValue(EXPERIENCE);
    expect(screen.getByRole("checkbox", { name: /groundwater and wells/i })).toBeChecked();
    expect(screen.getByLabelText("Reference 1")).toHaveValue("https://example.org/a");
    expect(screen.getByRole("checkbox", { name: /i confirm that the information/i })).not.toBeChecked();

    mockApply.mockResolvedValue({ ...pendingApp(), history: [...rejectedApp.history, { fromStatus: "rejected", toStatus: "pending", submission: sub(), timestamp: "2026-03-07T10:00:00.000Z" }] });
    await user.click(screen.getByRole("checkbox", { name: /i confirm that the information/i }));
    await user.click(screen.getByRole("button", { name: /^apply again/i }));
    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({ experience: EXPERIENCE, references: ["https://example.org/a"] }));
    expect(await screen.findByText(/awaiting review by an administrator/i)).toBeInTheDocument();
  });

  it("a legacy rejected application re-opens an EMPTY form", async () => {
    as("USER");
    mockMine.mockResolvedValue({
      status: "rejected",
      history: [
        { fromStatus: null, toStatus: "pending", submission: null, timestamp: "2026-03-05T10:00:00.000Z" },
        { fromStatus: "pending", toStatus: "rejected", note: "No details", timestamp: "2026-03-06T10:00:00.000Z" },
      ],
    });
    render(ui());
    expect(await screen.findByLabelText(/what have you worked on/i)).toHaveValue("");
  });
});

describe("approved: no reload instruction, the session user is refreshed", () => {
  it("while the role is still USER it refreshes the user ONCE and shows 'activating'", async () => {
    as("USER");
    mockMine.mockResolvedValue(approvedApp);
    render(ui());
    expect(await screen.findByText(/Activating your Expert tools/i)).toBeInTheDocument();
    await waitFor(() => expect(mockRefreshUser).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/reload/i)).not.toBeInTheDocument();
  });

  it("if the refresh fails it offers a retry, which tries again", async () => {
    as("USER");
    mockMine.mockResolvedValue(approvedApp);
    mockRefreshUser.mockResolvedValueOnce(null);
    const user = userEvent.setup();
    render(ui());
    expect(await screen.findByText(/could not activate your Expert tools/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(mockRefreshUser).toHaveBeenCalledTimes(2));
  });

  it("once the role is EXPERT it shows the review-queue entry point and fetches nothing", () => {
    as("EXPERT");
    render(ui());
    expect(screen.getByText(/verified Expert/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review queue/i })).toHaveAttribute("href", "/learn/review");
    expect(mockMine).not.toHaveBeenCalled();
  });
});

describe("other roles and staleness", () => {
  it("ADMIN sees a plain message and nothing is fetched for the application", () => {
    as("ADMIN");
    mockList.mockResolvedValue({ items: [], page: 1, limit: 1, total: 0, totalPages: 0 });
    render(ui());
    expect(screen.getByText(/elevated access/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit application/i })).not.toBeInTheDocument();
    expect(mockMine).not.toHaveBeenCalled();
  });

  it("a failed re-read after a good load keeps the data but says it may be out of date; Try again recovers", async () => {
    as("USER");
    mockMine.mockResolvedValueOnce(none);
    const user = userEvent.setup();
    render(ui());
    await screen.findByRole("button", { name: /submit application/i });

    // the apply is refused as stale, and the follow-up re-read fails
    mockApply.mockRejectedValue(new ApiError("x", "http", 409, "INVALID_STATE"));
    mockMine.mockRejectedValueOnce(new ApiError("down", "network"));
    await fillAndSubmit(user);
    const notice = await screen.findByText(/this may be out of date/i);
    expect(notice).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^submit application/i })).toBeInTheDocument(); // data kept

    mockMine.mockResolvedValueOnce(pendingApp());
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText(/awaiting review by an administrator/i)).toBeInTheDocument();
    expect(screen.queryByText(/this may be out of date/i)).not.toBeInTheDocument();
  });
});
