import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { IssueDetail } from "@/components/issues/issue-detail";
import { IssueTimeline } from "@/components/issues/issue-timeline";
import type { IssueActivityEntry } from "@/lib/api/types/issue";
import { makeIssueDetail, reportedEntry } from "@/test-utils/issue-detail";

vi.mock("@/components/issues/issue-map-loader", () => ({
  IssueMapLoader: ({ label }: { label: string }) => <div role="region" aria-label={label} />,
}));

const EXPERT = { _id: "u2", name: "Ed", role: "EXPERT" as const };
const GRANTEE = { _id: "u3", name: "Gus", role: "USER" as const };

const FULL: IssueActivityEntry[] = [
  reportedEntry(),
  { id: "h:1", type: "status_changed", timestamp: "2026-03-06T10:00:00.000Z", actor: EXPERT, note: null, fromStatus: "open", toStatus: "acknowledged" },
  { id: "r:0", type: "responsibility_offered", timestamp: "2026-03-06T11:00:00.000Z", actor: null, note: null },
  { id: "r:1", type: "responsibility_accepted", timestamp: "2026-03-06T12:00:00.000Z", actor: GRANTEE, note: null },
  { id: "h:2", type: "status_changed", timestamp: "2026-03-07T09:00:00.000Z", actor: GRANTEE, note: "Replaced the pipe.", fromStatus: "in_progress", toStatus: "resolved" },
  { id: "r:2", type: "responsibility_released", timestamp: "2026-03-08T09:00:00.000Z", actor: null, note: null },
];

const items = () => within(screen.getByRole("region", { name: "Timeline" })).getAllByRole("listitem");
/** Paragraph order inside an entry: kind label, title, meta line, then an optional note. */
const titleOf = (li: HTMLElement) => li.querySelectorAll("p")[1]?.textContent;

describe("IssueTimeline: renders the server's events", () => {
  it("renders every event with its title, in an ordered list", () => {
    render(<IssueTimeline activity={FULL} />);
    expect(screen.getByRole("list")).toBeInstanceOf(HTMLOListElement);
    expect(items().map(titleOf)).toEqual([
      "Issue reported",
      "Open → Acknowledged",
      "Responsibility offered",
      "Responsibility accepted",
      "In progress → Resolved",
      "Responsibility released",
    ]);
  });

  it("preserves the order supplied by the API, even when timestamps are not monotonic (never re-sorted)", () => {
    const shuffled = [FULL[3], FULL[0], FULL[5], FULL[1]];
    render(<IssueTimeline activity={shuffled} />);
    expect(items().map(titleOf)).toEqual([
      "Responsibility accepted",
      "Issue reported",
      "Responsibility released",
      "Open → Acknowledged",
    ]);
  });

  it("distinguishes lifecycle from responsibility events with a TEXT label (not color)", () => {
    render(<IssueTimeline activity={FULL} />);
    const kinds = items().map((li) => li.querySelector("p")?.textContent);
    expect(kinds).toEqual(["Status", "Status", "Responsibility", "Responsibility", "Status", "Responsibility"]);
  });

  it("shows date and time (UTC) and a machine-readable datetime for each event", () => {
    render(<IssueTimeline activity={FULL} />);
    const t = items()[1].querySelector("time")!;
    expect(t).toHaveTextContent("Mar 6, 2026, 10:00 AM UTC");
    expect(t).toHaveAttribute("datetime", "2026-03-06T10:00:00.000Z");
  });

  it("names the public actor (with an Expert/Admin role label) and never an id", () => {
    const { container } = render(<IssueTimeline activity={FULL} />);
    expect(items()[1]).toHaveTextContent("by Ed (Expert)");
    expect(items()[3]).toHaveTextContent("by Gus");
    expect(items()[3]).not.toHaveTextContent("(User)");
    expect(items()[2]).not.toHaveTextContent("by"); // a pending offer has no public actor
    for (const id of ["u2", "u3", "h:1", "r:1"]) expect(container).not.toHaveTextContent(id);
  });

  it("shows a public transition note, and none when absent", () => {
    render(<IssueTimeline activity={FULL} />);
    expect(items()[4]).toHaveTextContent("Replaced the pipe.");
    expect(items()[1].querySelectorAll("p")).toHaveLength(3); // kind, title, meta: no note paragraph
    expect(items()[4].querySelectorAll("p")).toHaveLength(4); // ...plus the note
  });

  it("renders a note as inert plain text: no markup, no headings, no links, outline intact", () => {
    const hostile = '<script>window.__x=1</script>\n## Fake heading\n[a](javascript:1) <img src=x onerror=window.__x=1>';
    const { container } = render(
      <IssueTimeline activity={[{ ...FULL[4], note: hostile }]} />,
    );
    expect(container.querySelector("script, img, a, [onerror]")).toBeNull();
    expect(container.querySelectorAll("h2")).toHaveLength(1); // only the section heading
    expect(container.querySelector("h3, h4")).toBeNull();
    expect(container).toHaveTextContent("<script>window.__x=1</script>");
    expect(container).toHaveTextContent("## Fake heading");
  });

  it("an empty log shows an explicit empty state, not an empty list", () => {
    render(<IssueTimeline activity={[]} />);
    expect(screen.getByText("No activity recorded.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Timeline" })).toBeInTheDocument();
  });

  it("an event type this client does not know still renders honestly instead of disappearing", () => {
    render(<IssueTimeline activity={[{ ...FULL[2], id: "r:9", type: "responsibility_future" as never }]} />);
    expect(items()).toHaveLength(1);
    expect(items()[0]).toHaveTextContent("Responsibility update");
  });
});

describe("IssueDetail composes Progress and Timeline from the detail payload only", () => {
  it("shows both sections, in a sensible outline, and no second history list", () => {
    render(<IssueDetail issue={makeIssueDetail({ activity: FULL, status: "resolved", nextAction: "awaiting_verification" })} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Progress", "Timeline"]);
    expect(screen.queryByRole("region", { name: "Status history" })).not.toBeInTheDocument();
  });

  it("builds the timeline from `activity`, not from `statusHistory` (no second client-side history model)", () => {
    render(
      <IssueDetail
        issue={makeIssueDetail({
          activity: [],
          statusHistory: [
            { fromStatus: null, toStatus: "open", actor: "u1", timestamp: "2026-03-05T10:00:00.000Z" },
            { fromStatus: "open", toStatus: "acknowledged", actor: "u2", timestamp: "2026-03-06T10:00:00.000Z" },
          ],
        })}
      />,
    );
    expect(screen.getByText("No activity recorded.")).toBeInTheDocument();
    expect(screen.queryByText(/Open → Acknowledged/)).not.toBeInTheDocument();
  });

  it("adds no lifecycle, progress-note, dispute or escalation controls (even for a disputed resolution)", () => {
    render(
      <IssueDetail
        issue={makeIssueDetail({ status: "resolved", nextAction: "awaiting_verification", resolutionDisputed: true, activity: FULL })}
      />,
    );
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Copy ID"]);
    for (const name of [/acknowledge/i, /resolve/i, /verify/i, /progress/i, /dispute/i, /challenge/i, /escalate/i, /dismiss/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});
