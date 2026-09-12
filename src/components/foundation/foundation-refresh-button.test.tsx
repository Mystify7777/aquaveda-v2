import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FoundationRefreshButton } from "@/components/foundation/foundation-refresh-button";
import { getSystemSnapshot } from "@/lib/api/system";
import type { SystemSnapshot } from "@/lib/system";

vi.mock("@/lib/api/system", () => ({
  getSystemSnapshot: vi.fn(),
}));

const mockGetSystemSnapshot = vi.mocked(getSystemSnapshot);

const SNAPSHOT: SystemSnapshot = {
  status: "operational",
  uptimeSeconds: 42,
  timestamp: "2026-01-01T00:00:00.000Z",
  runtime: "nodejs",
};

/**
 * Deliberately does not assert on the transient "Checking..." pending
 * label — with a mocked promise resolving on the next microtask, that
 * intermediate state is timing-dependent rather than deterministic.
 * Only the settled outcomes (success/error) are asserted, per this
 * plan's own determinism requirement.
 */
describe("FoundationRefreshButton", () => {
  beforeEach(() => {
    mockGetSystemSnapshot.mockReset();
  });

  it("renders the Refresh trigger initially, with no error", () => {
    render(<FoundationRefreshButton onRefreshed={() => {}} />);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("calls onRefreshed with the resolved snapshot on success", async () => {
    mockGetSystemSnapshot.mockResolvedValueOnce(SNAPSHOT);
    const onRefreshed = vi.fn();
    const user = userEvent.setup();

    render(<FoundationRefreshButton onRefreshed={onRefreshed} />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(onRefreshed).toHaveBeenCalledWith(SNAPSHOT));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an alert with the error message on failure, without calling onRefreshed", async () => {
    mockGetSystemSnapshot.mockRejectedValueOnce(new Error("Network unreachable"));
    const onRefreshed = vi.fn();
    const user = userEvent.setup();

    render(<FoundationRefreshButton onRefreshed={onRefreshed} />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Network unreachable");
    });
    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockGetSystemSnapshot.mockRejectedValueOnce("not an Error instance");
    const user = userEvent.setup();

    render(<FoundationRefreshButton onRefreshed={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    });
  });
});
