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

  it("signed-in USER: My articles only", () => {
    mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role: "USER" } });
    render(<LearnWorkflowLinks />);
    expect(screen.getByRole("link", { name: "My articles" })).toHaveAttribute("href", "/protected/learn/mine");
    expect(screen.queryByRole("link", { name: "Review queue" })).not.toBeInTheDocument();
  });

  it("EXPERT: both links", () => {
    mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role: "EXPERT" } });
    render(<LearnWorkflowLinks />);
    expect(screen.getByRole("link", { name: "Review queue" })).toHaveAttribute("href", "/protected/learn/review");
  });
});
