import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { ReferenceLink, SubmissionDetails } from "@/components/expert/submission-details";
import type { ExpertSubmission } from "@/lib/api/types/expert-application";

const sub = (over: Partial<ExpertSubmission> = {}): ExpertSubmission => ({
  expertiseAreas: ["groundwater_wells", "community_field_practice"],
  experience: "Ten years of borewell monitoring.\nSecond line.",
  references: [],
  ...over,
});

describe("SubmissionDetails", () => {
  it("shows labelled areas, experience (line breaks kept), affiliation and the acknowledgement date", () => {
    render(
      <SubmissionDetails
        submission={sub({ affiliation: "River Trust", acknowledgement: { version: 1, acceptedAt: "2026-03-05T10:00:00.000Z" } })}
        legacyMessage="legacy"
      />,
    );
    expect(screen.getByText("Groundwater and wells")).toBeInTheDocument();
    expect(screen.getByText("Community and field practice")).toBeInTheDocument();
    expect(screen.getByText(/Ten years of borewell monitoring\./)).toBeInTheDocument();
    expect(screen.getByText("River Trust")).toBeInTheDocument();
    expect(screen.getByText(/^Accepted /)).toBeInTheDocument();
    expect(screen.queryByTestId("legacy-submission")).not.toBeInTheDocument();
  });

  it("null (legacy) shows the explicit message, never an empty submission", () => {
    render(<SubmissionDetails submission={null} legacyMessage="Submitted before details were collected." />);
    expect(screen.getByTestId("legacy-submission")).toHaveTextContent("Submitted before details were collected.");
    expect(screen.queryByText("Areas of expertise")).not.toBeInTheDocument();
  });

  it("an unknown expertise key is shown verbatim, not hidden", () => {
    render(<SubmissionDetails submission={sub({ expertiseAreas: ["future_key"] })} legacyMessage="" />);
    expect(screen.getByText("future_key")).toBeInTheDocument();
  });

  it("optional sections are omitted when empty", () => {
    render(<SubmissionDetails submission={sub()} legacyMessage="" />);
    expect(screen.queryByText("Affiliation")).not.toBeInTheDocument();
    expect(screen.queryByText("References")).not.toBeInTheDocument();
    expect(screen.queryByText("Acknowledgement")).not.toBeInTheDocument();
  });

  it("renders user text as PLAIN TEXT: markup in the experience never becomes elements", () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script><b>bold</b>';
    const { container } = render(<SubmissionDetails submission={sub({ experience: evil, affiliation: "<i>x</i>" })} legacyMessage="" />);
    expect(container.querySelector("script, img, b, i")).toBeNull();
    expect(container).toHaveTextContent("<script>alert(2)</script>");
  });

  it("references are links showing the hostname, opening safely in a new tab", () => {
    render(<SubmissionDetails submission={sub({ references: ["https://example.org/paper?id=1"] })} legacyMessage="" />);
    const link = screen.getByRole("link", { name: "example.org (opens in a new tab)" });
    expect(link).toHaveAttribute("href", "https://example.org/paper?id=1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(link.getAttribute("rel")).toContain("nofollow");
    expect(link).toHaveTextContent("example.org");
    expect(link).not.toHaveTextContent("paper");
  });
});

describe("ReferenceLink defence in depth", () => {
  it.each([
    "javascript:alert(1)",
    "http://example.org",
    "https://user:pw@example.org",
    "data:text/html,<script>1</script>",
    "not a url",
  ])("never renders %s as a link", (href) => {
    const { container } = render(<ReferenceLink href={href} />);
    expect(within(container).queryByRole("link")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent(href);
  });
});
