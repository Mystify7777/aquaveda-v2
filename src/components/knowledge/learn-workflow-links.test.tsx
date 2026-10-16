import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { LearnWorkflowLinks } from "@/components/knowledge/learn-workflow-links";

const mockUseAuth = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

describe("LearnWorkflowLinks", () => {
  it("renders nothing for anonymous and initializing sessions", () => {
    for (const status of ["anonymous", "initializing", "unavailable", "session-failure"]) {
      mockUseAuth.mockReturnValue({ status, user: null });
      const { container, unmount } = render(<LearnWorkflowLinks />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("signed-in USER: My articles and the Expert application entry; no review queue", () => {
    mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role: "USER" } });
    render(<LearnWorkflowLinks />);
    expect(screen.getByRole("link", { name: "My articles" })).toHaveAttribute("href", "/learn/mine");
    expect(screen.getByRole("link", { name: "Become an Expert" })).toHaveAttribute("href", "/learn/expert-application");
    expect(screen.queryByRole("link", { name: "Review queue" })).not.toBeInTheDocument();
  });

  it("ADMIN: My articles only — no Knowledge review entry, no application entry (governance is under /admin)", () => {
    mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "a1", role: "ADMIN" } });
    render(<LearnWorkflowLinks />);
    expect(screen.getByRole("link", { name: "My articles" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review queue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Become an Expert" })).not.toBeInTheDocument();
  });

  it("EXPERT: both links", () => {
    mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role: "EXPERT" } });
    render(<LearnWorkflowLinks />);
    expect(screen.getByRole("link", { name: "Review queue" })).toHaveAttribute("href", "/learn/review");
    expect(screen.queryByRole("link", { name: "Become an Expert" })).not.toBeInTheDocument();
  });
});
