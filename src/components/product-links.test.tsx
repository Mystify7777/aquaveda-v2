import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ActProjectNotFound from "@/app/act/[projectId]/not-found";
import ExploreIssueNotFound from "@/app/explore/[issueId]/not-found";
import LearnArticleNotFound from "@/app/learn/[knowledgeId]/not-found";
import RootNotFound from "@/app/not-found";
import IssueMap from "@/components/issues/issue-map";
import { ApiError } from "@/lib/api/client";
import { IssueCard } from "@/components/issues/issue-card";
import { IssueDiscoveryFilters } from "@/components/issues/issue-discovery-filters";
import { SearchAreaControl } from "@/components/issues/issue-search-area";
import { IssueStatusFilter } from "@/components/issues/issue-status-filter";
import { IssueReportForm } from "@/components/issues/issue-report-form";
import { KnowledgeCard } from "@/components/knowledge/knowledge-card";
import { WorkflowArticle } from "@/components/knowledge/workflow-article";
import { MyKnowledgeList, ReviewQueueList } from "@/components/knowledge/workflow-list";
import { WorkflowSummaryCard } from "@/components/knowledge/workflow-summary-card";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectCreateForm } from "@/components/projects/project-create-form";
import { findBrokenLinks, internalHrefs } from "@/test-utils/app-routes";

/**
 * Issue #81 — link-bearing product components in Explore / Learn / Act.
 * Dynamic hrefs (`/explore/${id}` ...) resolve through their [param] route.
 * Scope: links that render in these states; see docs/engineering/testing.md.
 */

const mockUseAuth = vi.fn();
const mockCreateIssue = vi.fn();
const mockCreateProject = vi.fn();
const mockGetWorkflow = vi.fn();
const mockMine = vi.fn();
const mockQueue = vi.fn();

vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/lib/api/issues", () => ({ createIssue: (p: unknown) => mockCreateIssue(p) }));
vi.mock("@/lib/api/projects", () => ({ createProject: (p: unknown) => mockCreateProject(p) }));
vi.mock("@/lib/api/knowledge", () => ({
  getKnowledgeWorkflow: (id: string) => mockGetWorkflow(id),
  getMyKnowledge: (q: unknown) => mockMine(q),
  getReviewQueue: (q: unknown) => mockQueue(q),
}));

const actor = { _id: "u1", name: "Asha", role: "USER" as const };
const ID = "507f1f77bcf86cd799439011";
const ts = "2026-03-05T10:00:00.000Z";
const expectResolves = (container: ParentNode, expected: string[]) => {
  const hrefs = internalHrefs(container);
  expect([...new Set(hrefs)].sort()).toEqual([...expected].sort());
  expect(findBrokenLinks(hrefs)).toEqual([]);
};

const unauthorized = () => new ApiError("Authentication required", "http", 401, "UNAUTHORIZED");

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role: "USER" } });
});

describe("Explore links", () => {
  it("IssueCard -> /explore/[issueId]", () => {
    const issue = { _id: "i1", title: "Leak", description: "d", status: "open", category: "", severity: "", reportedBy: actor, createdAt: ts };
    const { container } = render(<IssueCard issue={issue as never} />);
    expectResolves(container, ["/explore/i1"]);
  });

  it("IssueMap popup -> /explore/[issueId]", async () => {
    render(
      <div style={{ height: 300, width: 300 }}>
        <IssueMap issues={[{ id: "i1", title: "Leak", position: [12.9, 77.5] }]} />
      </div>,
    );
    await userEvent.setup().click(screen.getByTitle("Leak"));
    const link = await screen.findByRole("link", { name: "Leak" });
    expect(link).toHaveAttribute("href", "/explore/i1");
    expect(findBrokenLinks([link.getAttribute("href")!])).toEqual([]);
  });

  it.each([
    ["success", () => mockCreateIssue.mockResolvedValue({ _id: "i1" }), "Issue reported", ["/explore/i1"]],
    ["401 sign-in prompt", () => mockCreateIssue.mockRejectedValue(unauthorized()), "Sign in", ["/auth/login"]],
  ])("IssueReportForm %s", async (_n, arrange, marker, expected) => {
    const user = userEvent.setup();
    arrange();
    const { container } = render(<IssueReportForm />);
    await user.type(screen.getByLabelText(/^title/i), "Leak");
    await user.type(screen.getByLabelText(/^description/i), "Burst");
    await user.type(screen.getByLabelText(/^latitude/i), "12.9");
    await user.type(screen.getByLabelText(/^longitude/i), "77.5");
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    await screen.findByText(marker);
    expectResolves(container, expected);
  });

  it("Explore filters (status nav, clear links, search-area link) all target /explore", () => {
    const filters = { status: "open", category: "other", q: "pump", bbox: "77.5,12.8,77.7,13.1" } as const;
    const { container } = render(
      <>
        <IssueStatusFilter filters={filters} />
        <IssueDiscoveryFilters filters={filters} invalid={{}} />
        <SearchAreaControl viewport={[77.5, 12.8, 77.7, 13.1]} filters={filters} />
      </>,
    );
    const hrefs = internalHrefs(container);
    expect(hrefs.length).toBeGreaterThan(6);
    expect(hrefs.every((h) => h === "/explore" || h.startsWith("/explore?"))).toBe(true);
    expect(findBrokenLinks(hrefs)).toEqual([]);
  });

  it("not-found -> /explore", () => {
    expectResolves(render(<ExploreIssueNotFound />).container, ["/explore"]);
  });
});

describe("Learn links", () => {
  it("KnowledgeCard -> /learn/[knowledgeId]", () => {
    const a = { _id: "k1", title: "T", body: "b", author: actor, createdAt: ts };
    expectResolves(render(<KnowledgeCard article={a as never} />).container, ["/learn/k1"]);
  });

  it("WorkflowSummaryCard -> /learn/review/[id]", () => {
    const item = { _id: "k1", title: "T", status: "draft", region: "", author: actor, createdAt: ts, updatedAt: ts };
    expectResolves(render(<WorkflowSummaryCard item={item as never} />).container, ["/learn/review/k1"]);
  });

  it("My articles list: items, status filters, empty-state CTA", async () => {
    const item = { _id: "k1", title: "T", status: "draft", region: "", author: actor, createdAt: ts, updatedAt: ts };
    mockMine.mockResolvedValue({ items: [item], page: 1, limit: 20, total: 1, totalPages: 1 });
    const filled = render(<MyKnowledgeList page={1} />);
    await screen.findByRole("link", { name: "T" });
    const hrefs = internalHrefs(filled.container);
    expect(hrefs).toContain("/learn/review/k1");
    expect(hrefs).toContain("/learn/mine");
    expect(findBrokenLinks(hrefs)).toEqual([]);
    filled.unmount();

    mockMine.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    const empty = render(<MyKnowledgeList page={1} />);
    await screen.findByRole("link", { name: "Write an article" });
    expect(internalHrefs(empty.container)).toContain("/learn/new");
    expect(findBrokenLinks(internalHrefs(empty.container))).toEqual([]);
  });

  it("Review queue list", async () => {
    const item = { _id: "k2", title: "Q", status: "pending_review", region: "", author: actor, createdAt: ts, updatedAt: ts };
    mockQueue.mockResolvedValue({ items: [item], page: 1, limit: 20, total: 1, totalPages: 1 });
    const { container } = render(<ReviewQueueList page={1} />);
    await screen.findByRole("link", { name: "Q" });
    expect(findBrokenLinks(internalHrefs(container))).toEqual([]);
  });

  it("WorkflowArticle: approved -> published article; missing -> My articles", async () => {
    const base = { _id: "k1", title: "T", body: "b", region: "", author: actor, reviewHistory: [], createdAt: ts, updatedAt: ts };
    mockGetWorkflow.mockResolvedValue({ ...base, status: "approved" });
    const { container, unmount } = render(<WorkflowArticle knowledgeId="k1" />);
    await screen.findByRole("link", { name: "View published article" });
    expectResolves(container, ["/learn/k1"]);
    unmount();

    mockGetWorkflow.mockRejectedValue(new ApiError("Not found", "http", 404, "NOT_FOUND"));
    const missing = render(<WorkflowArticle knowledgeId="k1" />);
    await screen.findByRole("link", { name: "Back to your articles" });
    expectResolves(missing.container, ["/learn/mine"]);
  });

  it("not-found -> /learn", () => {
    expectResolves(render(<LearnArticleNotFound />).container, ["/learn"]);
  });
});

describe("Act links", () => {
  it("ProjectCard -> /act/[projectId]", () => {
    const p = { _id: "p1", title: "T", description: "d", creator: actor, createdAt: ts };
    expectResolves(render(<ProjectCard project={p as never} />).container, ["/act/p1"]);
  });

  it.each([
    ["success", () => mockCreateProject.mockResolvedValue({ _id: "p1", originIssue: ID }), "Project created", ["/act/p1"]],
    ["401 sign-in prompt", () => mockCreateProject.mockRejectedValue(unauthorized()), "Sign in", ["/auth/login"]],
  ])("ProjectCreateForm %s", async (_n, arrange, marker, expected) => {
    const user = userEvent.setup();
    arrange();
    const { container } = render(<ProjectCreateForm />);
    await user.type(screen.getByLabelText(/^title/i), "Fix");
    await user.type(screen.getByLabelText(/^description/i), "Desc");
    await user.type(screen.getByLabelText(/^origin issue id/i), ID);
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByText(marker);
    expectResolves(container, expected);
  });

  it("not-found -> /act", () => {
    expectResolves(render(<ActProjectNotFound />).container, ["/act"]);
  });
});

describe("Root", () => {
  it("not-found -> /", () => {
    expectResolves(render(<RootNotFound />).container, ["/"]);
  });
});
