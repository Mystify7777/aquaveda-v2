import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FoundationStatusCard } from "@/components/foundation/foundation-status-card";
import { getSystemSnapshot } from "@/lib/api/system";
import type { SystemSnapshot } from "@/lib/system";

vi.mock("@/lib/api/system", () => ({
  getSystemSnapshot: vi.fn(),
}));

const mockGetSystemSnapshot = vi.mocked(getSystemSnapshot);

const INITIAL: SystemSnapshot = {
  status: "operational",
  uptimeSeconds: 65,
  timestamp: "2026-01-01T00:00:00.000Z",
  runtime: "nodejs",
};

const REFRESHED: SystemSnapshot = {
  status: "operational",
  uptimeSeconds: 130,
  timestamp: "2026-01-01T00:05:00.000Z",
  runtime: "nodejs",
};

describe("FoundationStatusCard", () => {
  beforeEach(() => {
    mockGetSystemSnapshot.mockReset();
  });

  it("renders the initial snapshot's status and formatted uptime", () => {
    render(<FoundationStatusCard initial={INITIAL} />);
    expect(screen.getByText("operational")).toBeInTheDocument();
    // 65 seconds -> "1m 5s", per formatUptime's floor(m)/remainder(s) logic
    expect(screen.getByText("1m 5s")).toBeInTheDocument();
  });

  it("updates the displayed uptime after a successful refresh, without a page reload", async () => {
    mockGetSystemSnapshot.mockResolvedValueOnce(REFRESHED);
    const user = userEvent.setup();

    render(<FoundationStatusCard initial={INITIAL} />);
    expect(screen.getByText("1m 5s")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      // 130 seconds -> "2m 10s"
      expect(screen.getByText("2m 10s")).toBeInTheDocument();
    });
    expect(screen.queryByText("1m 5s")).not.toBeInTheDocument();
  });
});
