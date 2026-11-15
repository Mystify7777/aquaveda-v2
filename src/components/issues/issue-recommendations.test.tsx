import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IssueRecommendations } from "@/components/issues/issue-recommendations";
import { ApiError } from "@/lib/api/client";

const mockGet = vi.fn();

vi.mock("@/lib/api/recommendations", () => ({
  getIssueRecommendations: (issueId: string, options: { signal?: AbortSignal }) =>
    mockGet(issueId, options),
}));

const populated = {
  issueId: "i1",
  contextStatus: "classified" as const,
  recommendations: [
    {
      id: "leakage-wastage",
      suggestion: "Inspect the reported area.",
      reason: 'The Issue is classified as "leakage_wastage".',
    },
  ],
};

describe("IssueRecommendations", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("shows an accessible loading status and authority disclaimer", () => {
    mockGet.mockReturnValue(new Promise(() => {}));

    render(<IssueRecommendations issueId="i1" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading AI-assisted guidance...");
    expect(screen.getByText(/not verified Knowledge/i)).toBeInTheDocument();
    expect(screen.getByText(/Approved Knowledge remains authoritative/i)).toBeInTheDocument();
  });

  it("renders suggestions and reasons for successful recommendations", async () => {
    mockGet.mockResolvedValue(populated);

    render(<IssueRecommendations issueId="i1" />);

    expect(await screen.findByText("Inspect the reported area.")).toBeInTheDocument();
    expect(screen.getByText('The Issue is classified as "leakage_wastage".')).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI-assisted guidance" })).toBeInTheDocument();
  });

  it("renders insufficient context without inventing guidance", async () => {
    mockGet.mockResolvedValue({
      issueId: "i1",
      contextStatus: "insufficient_context",
      recommendations: [],
    });

    render(<IssueRecommendations issueId="i1" />);

    expect(await screen.findByText(/not enough classification context/i)).toBeInTheDocument();
    expect(screen.getByText(/do not infer facts from the title or description/i)).toBeInTheDocument();
  });

  it("renders classified context with no matches as a successful empty state", async () => {
    mockGet.mockResolvedValue({
      issueId: "i1",
      contextStatus: "classified",
      recommendations: [],
    });

    render(<IssueRecommendations issueId="i1" />);

    expect(await screen.findByText(/no matching guidance is currently available/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a retryable timeout error without exposing the raw error", async () => {
    mockGet.mockRejectedValueOnce(new ApiError("database details", "network", undefined, undefined, "timeout"));
    mockGet.mockResolvedValueOnce(populated);
    const user = userEvent.setup();

    render(<IssueRecommendations issueId="i1" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/taking longer than usual/i);
    expect(alert).not.toHaveTextContent("database details");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Inspect the reported area.")).toBeInTheDocument());
  });

  it("forwards a live signal and does not show expected cancellation as an error", async () => {
    let signal: AbortSignal | undefined;
    mockGet.mockImplementation((_id: string, options: { signal?: AbortSignal }) => {
      signal = options.signal;
      return new Promise(() => {});
    });

    const { unmount } = render(<IssueRecommendations issueId="i1" />);
    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
    unmount();

    expect(signal?.aborted).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
