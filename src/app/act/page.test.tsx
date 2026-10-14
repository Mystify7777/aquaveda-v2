import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import ActPage from "@/app/act/page";
import ActLoading from "@/app/act/loading";
import { ApiError } from "@/lib/api/client";
import type { Project } from "@/lib/api/types/project";

const mockGetProjects = vi.fn();

vi.mock("@/lib/api/projects", () => ({ getProjects: (q: unknown) => mockGetProjects(q) }));
vi.mock("@/components/projects/new-project-button", () => ({
  NewProjectButton: () => <button>New project</button>,
}));

function project(n: number): Project {
  return {
    _id: `p${n}`,
    title: `Project ${n}`,
    description: `Description ${n}`,
    originIssue: "507f1f77bcf86cd799439011",
    creator: { _id: "u1", name: "Asha", role: "USER" },
    contributors: [],
    createdAt: "2026-03-05T10:00:00.000Z",
    updatedAt: "2026-03-05T10:00:00.000Z",
  };
}

async function renderPage(sp: { page?: string | string[] } = {}) {
  render(await ActPage({ searchParams: Promise.resolve(sp) }));
}

describe("/act", () => {
  beforeEach(() => {
    mockGetProjects.mockReset();
  });

  it("lists projects as links to their detail pages, with creator and date", async () => {
    mockGetProjects.mockResolvedValue({ items: [project(1), project(2)], page: 1, limit: 20, total: 2, totalPages: 1 });
    await renderPage();
    expect(mockGetProjects).toHaveBeenCalledWith({ page: 1 });
    expect(screen.getByRole("heading", { level: 1, name: "Act" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Project 1" })).toHaveAttribute("href", "/act/p1");
    expect(screen.getByRole("link", { name: "Project 2" })).toHaveAttribute("href", "/act/p2");
    expect(screen.getAllByText(/Started by Asha/)).toHaveLength(2);
    expect(screen.getAllByText("Mar 5, 2026")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Project pages" })).not.toBeInTheDocument();
  });

  it("empty: shows the empty state and keeps the creation entry point", async () => {
    mockGetProjects.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    await renderPage();
    expect(screen.getByRole("heading", { name: "No projects yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
  });

  it("page past the end: distinct empty state linking back to page 1", async () => {
    mockGetProjects.mockResolvedValue({ items: [], page: 9, limit: 20, total: 3, totalPages: 1 });
    await renderPage({ page: "9" });
    expect(mockGetProjects).toHaveBeenCalledWith({ page: 9 });
    expect(screen.getByRole("link", { name: "Back to first page" })).toHaveAttribute("href", "/act");
  });

  it("pagination: URL-driven prev/next links", async () => {
    mockGetProjects.mockResolvedValue({ items: [project(1)], page: 2, limit: 1, total: 3, totalPages: 3 });
    await renderPage({ page: "2" });
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/act");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/act?page=3");
  });

  it.each([["abc"], ["0"], ["-2"], ["1.5"]])("invalid page %s falls back to page 1", async (raw) => {
    mockGetProjects.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    await renderPage({ page: raw });
    expect(mockGetProjects).toHaveBeenCalledWith({ page: 1 });
  });

  it("network failure: accessible alert with retry, no fabricated empty state", async () => {
    mockGetProjects.mockRejectedValue(new ApiError("Failed to fetch", "network"));
    await renderPage({ page: "2" });
    expect(screen.getByRole("alert")).toHaveTextContent(/unreachable/i);
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/act?page=2");
    expect(screen.queryByRole("heading", { name: "No projects yet" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
  });

  it("HTTP failure: generic alert", async () => {
    mockGetProjects.mockRejectedValue(new ApiError("boom", "http", 500));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load projects/i);
  });

  it("unexpected non-API errors propagate to the error boundary", async () => {
    mockGetProjects.mockRejectedValue(new TypeError("bug"));
    await expect(ActPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("bug");
  });
});

describe("/act loading", () => {
  it("is an announced status region", () => {
    render(<ActLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects...");
  });
});
