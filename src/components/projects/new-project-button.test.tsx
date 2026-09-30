import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NewProjectButton } from "@/components/projects/new-project-button";

const mockUseAuth = vi.fn();
const mockRefresh = vi.fn();
const mockCreateProject = vi.fn();

vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/api/projects", () => ({ createProject: (p: unknown) => mockCreateProject(p) }));

describe("NewProjectButton", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockRefresh.mockReset();
    mockCreateProject.mockReset();
  });

  it("trigger is public; the form is not rendered until opened", () => {
    mockUseAuth.mockReturnValue({ status: "anonymous" });
    render(<NewProjectButton />);
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^title/i)).not.toBeInTheDocument();
  });

  it("anonymous: the dialog shows the established sign-in UX, not the form", async () => {
    mockUseAuth.mockReturnValue({ status: "anonymous" });
    const user = userEvent.setup();
    render(<NewProjectButton />);
    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByRole("dialog", { name: "New project" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.queryByLabelText(/^title/i)).not.toBeInTheDocument();
  });

  it("authenticated: shows the form; a successful creation refreshes the list", async () => {
    mockUseAuth.mockReturnValue({ status: "authenticated" });
    mockCreateProject.mockResolvedValue({ _id: "p1", title: "T", originIssue: "507f1f77bcf86cd799439011" });
    const user = userEvent.setup();
    render(<NewProjectButton />);
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByLabelText(/^title/i), "T");
    await user.type(screen.getByLabelText(/^description/i), "D");
    await user.type(screen.getByLabelText(/^origin issue id/i), "507f1f77bcf86cd799439011");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByText("Project created");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
