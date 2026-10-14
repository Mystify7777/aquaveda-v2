import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CopyIssueId } from "@/components/issues/copy-issue-id";
import type { IssueStatus } from "@/lib/api/types/issue";
import {
  ISSUE_STATUSES,
  PROJECT_ELIGIBLE_ISSUE_STATUSES,
  isProjectEligible,
} from "@/lib/issues/status";

const ID = "64b7f0c2a1b2c3d4e5f60718";

function stubClipboard(writeText: ReturnType<typeof vi.fn> | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isProjectEligible", () => {
  it("allows exactly the backend-eligible statuses (project.service ELIGIBLE_ISSUE_STATUSES)", () => {
    const eligible = ["acknowledged", "in_progress", "resolved", "verified"];
    expect([...PROJECT_ELIGIBLE_ISSUE_STATUSES]).toEqual(eligible);
    for (const s of ISSUE_STATUSES) {
      expect(isProjectEligible(s)).toBe(eligible.includes(s));
    }
    expect(isProjectEligible("open")).toBe(false);
  });

  it("rejects a status outside the allow-list (no default-allow)", () => {
    expect(isProjectEligible("archived" as IssueStatus)).toBe(false);
  });
});

describe("CopyIssueId", () => {
  it("renders the canonical ID and copies exactly that value", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CopyIssueId issueId={ID} showId />);
    expect(screen.getByText(ID)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /copy id/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(ID);
    expect(await screen.findByRole("status")).toHaveTextContent("Issue ID copied");
  });

  it("compact variant has an accessible name and is keyboard-activatable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CopyIssueId issueId={ID} />);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Copy issue ID" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(writeText).toHaveBeenCalledWith(ID);
  });

  it("rejected write reports failure, keeps the ID visible, and stays usable", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    stubClipboard(writeText);
    render(<CopyIssueId issueId={ID} showId />);
    await userEvent.click(screen.getByRole("button", { name: /copy id/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/could not copy/i);
    expect(screen.getByText(ID)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /copy id/i }));
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it("missing navigator.clipboard is handled as failure, not a crash", async () => {
    stubClipboard(undefined);
    render(<CopyIssueId issueId={ID} showId />);
    await userEvent.click(screen.getByRole("button", { name: /copy id/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/could not copy/i);
  });
});
