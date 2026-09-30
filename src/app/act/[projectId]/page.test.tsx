import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import ProjectPage from "@/app/act/[projectId]/page";
import ProjectNotFound from "@/app/act/[projectId]/not-found";
import { ApiError } from "@/lib/api/client";
import type { Project } from "@/lib/api/types/project";

const mockGetProject = vi.fn();

vi.mock("@/lib/api/projects", () => ({ getProject: (id: string) => mockGetProject(id) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const PROJECT: Project = {
  _id: "p1",
  title: "Pipe repair",
  description: "Line one\nLine two",
  originIssue: "507f1f77bcf86cd799439011",
  creator: { _id: "u1", name: "Asha", role: "USER" },
  contributors: [{ _id: "u2", name: "Ravi", role: "EXPERT" }],
  createdAt: "2026-03-05T10:00:00.000Z",
  updatedAt: "2026-03-05T10:00:00.000Z",
};

const call = (projectId = "p1") => ProjectPage({ params: Promise.resolve({ projectId }) });

describe("/act/[projectId]", () => {
  beforeEach(() => {
    mockGetProject.mockReset();
  });

  it("renders the project read-only: title, creator, date, description, origin issue, contributors", async () => {
    mockGetProject.mockResolvedValue(PROJECT);
    render(await call());
    expect(mockGetProject).toHaveBeenCalledWith("p1");
    expect(screen.getByRole("heading", { level: 1, name: "Pipe repair" })).toBeInTheDocument();
    expect(screen.getByText(/Started by Asha/)).toBeInTheDocument();
    expect(screen.getByText("Mar 5, 2026")).toBeInTheDocument();
    expect(screen.getByText(/Line one/)).toBeInTheDocument();
    expect(screen.getByText("507f1f77bcf86cd799439011")).toBeInTheDocument();
    expect(screen.getByText("Ravi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All projects/ })).toHaveAttribute("href", "/act");
    // No edit/delete/join affordances.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("no contributors: explicit empty text", async () => {
    mockGetProject.mockResolvedValue({ ...PROJECT, contributors: [] });
    render(await call());
    expect(screen.getByText("No contributors yet.")).toBeInTheDocument();
  });

  it("404 -> notFound()", async () => {
    mockGetProject.mockRejectedValue(new ApiError("not found", "http", 404, "NOT_FOUND"));
    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("malformed id (400 VALIDATION_FAILED) -> notFound()", async () => {
    mockGetProject.mockRejectedValue(new ApiError("bad id", "http", 400, "VALIDATION_FAILED"));
    await expect(call("nope")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("VALIDATION_FAILED with a non-400 status is not treated as not-found", async () => {
    mockGetProject.mockRejectedValue(new ApiError("odd", "http", 500, "VALIDATION_FAILED"));
    render(await call());
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("network failure: alert with retry to the same project", async () => {
    mockGetProject.mockRejectedValue(new ApiError("Failed to fetch", "network"));
    render(await call());
    expect(screen.getByRole("alert")).toHaveTextContent(/unreachable/i);
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/act/p1");
  });

  it("server error: generic alert, not a 404", async () => {
    mockGetProject.mockRejectedValue(new ApiError("boom", "http", 500));
    render(await call());
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("not-found UI links back to the list", () => {
    render(<ProjectNotFound />);
    expect(screen.getByRole("heading", { name: "Project not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to projects" })).toHaveAttribute("href", "/act");
  });
});
