import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExpertApplicationPanel } from "@/components/expert/expert-application-panel";
import { ApiError } from "@/lib/api/client";
import type { MyExpertApplication } from "@/lib/api/types/expert-application";

const mockApply = vi.fn();
const mockMine = vi.fn();
vi.mock("@/lib/api/expert-application", () => ({
  applyForExpert: () => mockApply(),
  getMyExpertApplication: () => mockMine(),
}));
const mockUseAuth = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

const as = (role: string) => mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role } });
const none: MyExpertApplication = { status: "none", history: [] };
const pending: MyExpertApplication = {
  status: "pending",
  history: [{ fromStatus: null, toStatus: "pending", timestamp: "2026-03-05T10:00:00.000Z" }],
};
const rejected: MyExpertApplication = {
  status: "rejected",
  history: [
    { fromStatus: null, toStatus: "pending", timestamp: "2026-03-05T10:00:00.000Z" },
    { fromStatus: "pending", toStatus: "rejected", note: "Add more detail", timestamp: "2026-03-06T10:00:00.000Z" },
  ],
};
const approved: MyExpertApplication = {
  status: "approved",
  history: [
    { fromStatus: null, toStatus: "pending", timestamp: "2026-03-05T10:00:00.000Z" },
    { fromStatus: "pending", toStatus: "approved", timestamp: "2026-03-06T10:00:00.000Z" },
  ],
};
const apiError = (status: number, code: string, message = "x") => new ApiError(message, "http", status, code);

beforeEach(() => {
  mockApply.mockReset();
  mockMine.mockReset();
  mockUseAuth.mockReset();
});

describe("ExpertApplicationPanel — USER applies", () => {
  it("shows a loading status, then the Apply action for a USER who has not applied", async () => {
    as("USER");
    mockMine.mockResolvedValue(none);
    render(<ExpertApplicationPanel />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your application...");
    expect(await screen.findByRole("button", { name: "Apply to become an Expert" })).toBeEnabled();
    expect(screen.getByText("Not applied")).toBeInTheDocument();
  });

  it("submits once and switches to the pending state with history", async () => {
    as("USER");
    mockMine.mockResolvedValue(none);
    mockApply.mockResolvedValue(pending);
    render(<ExpertApplicationPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Apply to become an Expert" }));
    expect(await screen.findByText("Pending review")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/awaiting review/i);
    expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Application history" })).toHaveTextContent("Pending review");
    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it("a double click sends exactly one request and disables the button while in flight", async () => {
    as("USER");
    mockMine.mockResolvedValue(none);
    let resolve!: (v: MyExpertApplication) => void;
    mockApply.mockReturnValue(new Promise<MyExpertApplication>((r) => (resolve = r)));
    render(<ExpertApplicationPanel />);
    const button = await screen.findByRole("button", { name: "Apply to become an Expert" });
    await userEvent.dblClick(button);
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Submitting..." })).toBeDisabled();
    resolve(pending);
    expect(await screen.findByText("Pending review")).toBeInTheDocument();
    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it("an existing pending application shows status, no Apply button", async () => {
    as("USER");
    mockMine.mockResolvedValue(pending);
    render(<ExpertApplicationPanel />);
    expect(await screen.findByText("Pending review")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument();
  });

  it("rejected: shows the reviewer note and allows applying again", async () => {
    as("USER");
    mockMine.mockResolvedValue(rejected);
    mockApply.mockResolvedValue({ ...pending, history: [...rejected.history, { fromStatus: "rejected", toStatus: "pending", timestamp: "2026-03-07T10:00:00.000Z" }] });
    render(<ExpertApplicationPanel />);
    expect(await screen.findByText(/Your application was not approved/)).toBeInTheDocument();
    expect(screen.getByText(/Reviewer note:/)).toHaveTextContent("Add more detail");
    expect(screen.getByRole("region", { name: "Application history" })).toHaveTextContent("Rejected");
    await userEvent.click(screen.getByRole("button", { name: "Apply again" }));
    expect(await screen.findByText("Pending review")).toBeInTheDocument();
    expect(mockApply).toHaveBeenCalledTimes(1);
  });
});

describe("ExpertApplicationPanel — status for other situations", () => {
  it("approved EXPERT: confirmation and a link to the Knowledge review queue", async () => {
    as("EXPERT");
    mockMine.mockResolvedValue(approved);
    render(<ExpertApplicationPanel />);
    expect(await screen.findByText(/You are a verified Expert/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the review queue" })).toHaveAttribute("href", "/learn/review");
    expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument();
  });

  it("approved but the session still says USER: offers a reload to activate Expert tools", async () => {
    as("USER");
    mockMine.mockResolvedValue(approved);
    render(<ExpertApplicationPanel />);
    expect(await screen.findByText(/You are a verified Expert/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open the review queue" })).not.toBeInTheDocument();
  });

  it("EXPERT/ADMIN with no application are not offered Apply (applications are for members)", async () => {
    for (const role of ["EXPERT", "ADMIN"]) {
      as(role);
      mockMine.mockResolvedValue(none);
      const { unmount } = render(<ExpertApplicationPanel />);
      expect(await screen.findByText(/already has elevated access/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("ExpertApplicationPanel — failures", () => {
  it("load failure is an alert with Try again, which refetches", async () => {
    as("USER");
    mockMine.mockRejectedValueOnce(apiError(500, "INTERNAL")).mockResolvedValueOnce(none);
    render(<ExpertApplicationPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load your Expert application. Try again.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Apply to become an Expert" })).toBeInTheDocument();
    expect(mockMine).toHaveBeenCalledTimes(2);
  });

  it("401 on load offers sign-in", async () => {
    as("USER");
    mockMine.mockRejectedValue(apiError(401, "UNAUTHORIZED"));
    render(<ExpertApplicationPanel />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
  });

  it("submit failures: network, 403, validation, server — each message shown; the form stays usable", async () => {
    as("USER");
    mockMine.mockResolvedValue(none);
    render(<ExpertApplicationPanel />);
    const apply = async () => userEvent.click(await screen.findByRole("button", { name: "Apply to become an Expert" }));

    mockApply.mockRejectedValueOnce(new ApiError("down", "network"));
    await apply();
    expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i);

    mockApply.mockRejectedValueOnce(apiError(403, "FORBIDDEN"));
    await apply();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Only member accounts/i));

    mockApply.mockRejectedValueOnce(apiError(400, "VALIDATION_FAILED", "Invalid request"));
    await apply();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid request"));

    mockApply.mockRejectedValueOnce(apiError(500, "INTERNAL"));
    await apply();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("We could not submit your application. Try again."));
    expect(screen.getByRole("button", { name: "Apply to become an Expert" })).toBeEnabled();
  });

  it("a 401 on submit prompts sign-in", async () => {
    as("USER");
    mockMine.mockResolvedValue(none);
    mockApply.mockRejectedValue(apiError(401, "UNAUTHORIZED"));
    render(<ExpertApplicationPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Apply to become an Expert" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("duplicate/already-pending (INVALID_STATE) explains and refreshes to the real state", async () => {
    as("USER");
    mockMine.mockResolvedValueOnce(none).mockResolvedValueOnce(pending);
    mockApply.mockRejectedValue(apiError(409, "INVALID_STATE"));
    render(<ExpertApplicationPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Apply to become an Expert" }));
    expect(await screen.findByText("Pending review")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/already have an application in progress/i);
    expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument();
    expect(mockMine).toHaveBeenCalledTimes(2);
  });
});
