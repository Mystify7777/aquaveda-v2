import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ProtectedLayout from "@/app/protected/layout";
import NewProjectPage from "@/app/protected/act/new/page";
import { ProjectCreateForm } from "@/components/projects/project-create-form";
import { ApiError } from "@/lib/api/client";

const mockCreateProject = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("@/lib/api/projects", () => ({ createProject: (p: unknown) => mockCreateProject(p) }));
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

const ID = "507f1f77bcf86cd799439011";
const CREATED = { _id: "p1", title: "Pipe repair", originIssue: ID };

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^title/i), "Pipe repair");
  await user.type(screen.getByLabelText(/^description/i), "Coordinated fix");
  await user.type(screen.getByLabelText(/^origin issue id/i), ID);
}

const submit = () => screen.getByRole("button", { name: "Create project" });

describe("ProjectCreateForm", () => {
  beforeEach(() => {
    mockCreateProject.mockReset();
    mockUseAuth.mockReturnValue({ status: "authenticated" });
  });

  it("idle: renders labelled fields and an enabled submit", () => {
    render(<ProjectCreateForm />);
    expect(screen.getByLabelText(/^title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^origin issue id/i)).toHaveAccessibleDescription(/existing issue/i);
    expect(submit()).toBeEnabled();
  });

  it("required fields: shows errors, focuses first invalid, never calls the API", async () => {
    const user = userEvent.setup();
    render(<ProjectCreateForm />);
    await user.click(submit());
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByText("Description is required.")).toBeInTheDocument();
    expect(screen.getByText("Origin issue ID is required.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^title/i)).toHaveFocus();
    expect(screen.getByLabelText(/^title/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("malformed originIssue: shows format error, never calls the API", async () => {
    const user = userEvent.setup();
    render(<ProjectCreateForm />);
    await user.type(screen.getByLabelText(/^title/i), "T");
    await user.type(screen.getByLabelText(/^description/i), "D");
    await user.type(screen.getByLabelText(/^origin issue id/i), "not-an-id");
    await user.click(submit());
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^origin issue id/i)).toHaveAccessibleDescription(/24-character/i);
  });

  it("valid submission sends the exact backend payload and shows the completion state", async () => {
    const user = userEvent.setup();
    mockCreateProject.mockResolvedValue(CREATED);
    render(<ProjectCreateForm />);
    await fill(user);
    await user.click(submit());
    expect(mockCreateProject).toHaveBeenCalledTimes(1);
    expect(mockCreateProject).toHaveBeenCalledWith({
      title: "Pipe repair",
      description: "Coordinated fix",
      originIssue: ID,
    });
    expect(await screen.findByText("Project created")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(ID);
    await user.click(screen.getByRole("button", { name: "Create another" }));
    expect(screen.getByLabelText(/^title/i)).toHaveValue("");
  });

  it("pending: disables controls and blocks duplicate submission", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    mockCreateProject.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ProjectCreateForm />);
    await fill(user);
    const form = submit().closest("form")!;
    await user.click(submit());
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
    expect(form).toHaveAttribute("aria-busy", "true");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(mockCreateProject).toHaveBeenCalledTimes(1);
    resolve(CREATED);
    await screen.findByText("Project created");
  });

  it("backend validation failure: shows the message and preserves input", async () => {
    const user = userEvent.setup();
    mockCreateProject.mockRejectedValue(new ApiError("title is required", "http", 400, "VALIDATION_FAILED"));
    render(<ProjectCreateForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("title is required");
    expect(screen.getByLabelText(/^title/i)).toHaveValue("Pipe repair");
  });

  it("origin issue not found (404): specific message, input preserved", async () => {
    const user = userEvent.setup();
    mockCreateProject.mockRejectedValue(new ApiError("Issue x not found", "http", 404, "NOT_FOUND"));
    render(<ProjectCreateForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/no issue was found/i);
    expect(screen.getByLabelText(/^origin issue id/i)).toHaveValue(ID);
  });

  it("ineligible origin issue (INVALID_STATE): surfaces the backend message", async () => {
    const user = userEvent.setup();
    mockCreateProject.mockRejectedValue(
      new ApiError('a Project cannot be created from an Issue with status "open"', "http", 409, "INVALID_STATE"),
    );
    render(<ProjectCreateForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/status "open"/);
  });

  it("session failure (401): prompts sign-in", async () => {
    const user = userEvent.setup();
    mockCreateProject.mockRejectedValue(new ApiError("Authentication required", "http", 401, "UNAUTHORIZED"));
    render(<ProjectCreateForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
  });

  it("forbidden (403): permission message and no sign-in link", async () => {
    const user = userEvent.setup();
    mockCreateProject.mockRejectedValue(new ApiError("Forbidden", "http", 403, "FORBIDDEN"));
    render(<ProjectCreateForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account is not permitted to create projects.");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("network failure: unavailable message (not a session message); retry succeeds", async () => {
    const user = userEvent.setup();
    mockCreateProject.mockRejectedValueOnce(new ApiError("Failed to fetch", "network"));
    mockCreateProject.mockResolvedValueOnce(CREATED);
    render(<ProjectCreateForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i);
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    await user.click(submit());
    await waitFor(() => expect(screen.getByText("Project created")).toBeInTheDocument());
  });

  it("unexpected API failure: generic message, input preserved", async () => {
    const user = userEvent.setup();
    mockCreateProject.mockRejectedValue(new ApiError("boom", "http", 500));
    render(<ProjectCreateForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not create your project/i);
    expect(screen.getByLabelText(/^description/i)).toHaveValue("Coordinated fix");
  });
});

describe("/protected/act/new under the protected layout", () => {
  function renderRoute() {
    return render(
      <ProtectedLayout>
        <NewProjectPage />
      </ProtectedLayout>,
    );
  }

  it("authenticated: renders the page and form", () => {
    mockUseAuth.mockReturnValue({ status: "authenticated" });
    renderRoute();
    expect(screen.getByRole("heading", { name: "New project" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^title/i)).toBeInTheDocument();
  });

  it("anonymous: shows the established sign-in UX, not the form", () => {
    mockUseAuth.mockReturnValue({ status: "anonymous" });
    renderRoute();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.queryByLabelText(/^title/i)).not.toBeInTheDocument();
  });
});
