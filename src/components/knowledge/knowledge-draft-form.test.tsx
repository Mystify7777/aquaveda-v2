import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ProtectedLayout from "@/app/protected/layout";
import NewKnowledgeDraftPage from "@/app/protected/learn/new/page";
import { KnowledgeDraftForm } from "@/components/knowledge/knowledge-draft-form";
import { ApiError } from "@/lib/api/client";

const mockCreateKnowledge = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("@/lib/api/knowledge", () => ({ createKnowledge: (p: unknown) => mockCreateKnowledge(p) }));
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

const CREATED = { _id: "k1", title: "Drip irrigation", status: "draft" };

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^title/i), "Drip irrigation");
  await user.type(screen.getByLabelText(/^body/i), "Steps to set it up");
}

const submit = () => screen.getByRole("button", { name: "Save draft" });

describe("KnowledgeDraftForm", () => {
  beforeEach(() => {
    mockCreateKnowledge.mockReset();
    mockUseAuth.mockReturnValue({ status: "authenticated" });
  });

  it("idle: renders labelled title/body fields and an enabled submit, with no region field", () => {
    render(<KnowledgeDraftForm />);
    expect(screen.getByLabelText(/^title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^body/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/region/i)).not.toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });

  it("required fields: shows errors, focuses first invalid, never calls the API", async () => {
    const user = userEvent.setup();
    render(<KnowledgeDraftForm />);
    await user.click(submit());
    expect(mockCreateKnowledge).not.toHaveBeenCalled();
    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByText("Body is required.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^title/i)).toHaveFocus();
    expect(screen.getByLabelText(/^title/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("valid submission sends the exact backend payload and shows the completion state", async () => {
    const user = userEvent.setup();
    mockCreateKnowledge.mockResolvedValue(CREATED);
    render(<KnowledgeDraftForm />);
    await fill(user);
    await user.click(submit());
    expect(mockCreateKnowledge).toHaveBeenCalledTimes(1);
    expect(mockCreateKnowledge).toHaveBeenCalledWith({ title: "Drip irrigation", body: "Steps to set it up" });
    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/not been submitted for review/i);
    await user.click(screen.getByRole("button", { name: "Write another" }));
    expect(screen.getByLabelText(/^title/i)).toHaveValue("");
  });

  it("pending: disables controls and blocks duplicate submission", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    mockCreateKnowledge.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<KnowledgeDraftForm />);
    await fill(user);
    const form = submit().closest("form")!;
    await user.click(submit());
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(form).toHaveAttribute("aria-busy", "true");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(mockCreateKnowledge).toHaveBeenCalledTimes(1);
    resolve(CREATED);
    await screen.findByText("Draft saved");
  });

  it("backend validation failure: shows the message and preserves input", async () => {
    const user = userEvent.setup();
    mockCreateKnowledge.mockRejectedValue(new ApiError("title is required", "http", 400, "VALIDATION_FAILED"));
    render(<KnowledgeDraftForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("title is required");
    expect(screen.getByLabelText(/^title/i)).toHaveValue("Drip irrigation");
  });

  it("session failure (401): prompts sign-in", async () => {
    const user = userEvent.setup();
    mockCreateKnowledge.mockRejectedValue(new ApiError("Authentication required", "http", 401, "UNAUTHORIZED"));
    render(<KnowledgeDraftForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
  });

  it("forbidden (403): shows permission message and no sign-in link", async () => {
    const user = userEvent.setup();
    mockCreateKnowledge.mockRejectedValue(new ApiError("Forbidden", "http", 403, "FORBIDDEN"));
    render(<KnowledgeDraftForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account is not permitted to create drafts.");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("network failure: unavailable message (not a session message); retry succeeds", async () => {
    const user = userEvent.setup();
    mockCreateKnowledge.mockRejectedValueOnce(new ApiError("Failed to fetch", "network"));
    mockCreateKnowledge.mockResolvedValueOnce(CREATED);
    render(<KnowledgeDraftForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i);
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    await user.click(submit());
    await waitFor(() => expect(screen.getByText("Draft saved")).toBeInTheDocument());
  });

  it("unexpected API failure: generic message, input preserved", async () => {
    const user = userEvent.setup();
    mockCreateKnowledge.mockRejectedValue(new ApiError("boom", "http", 500));
    render(<KnowledgeDraftForm />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save your draft/i);
    expect(screen.getByLabelText(/^body/i)).toHaveValue("Steps to set it up");
  });
});

describe("/learn/new under the (protected) layout", () => {
  function renderRoute() {
    return render(
      <ProtectedLayout>
        <NewKnowledgeDraftPage />
      </ProtectedLayout>,
    );
  }

  it("authenticated: renders the page and form", () => {
    mockUseAuth.mockReturnValue({ status: "authenticated" });
    renderRoute();
    expect(screen.getByRole("heading", { name: "New knowledge draft" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^title/i)).toBeInTheDocument();
  });

  it("anonymous: shows the established sign-in UX, not the form", () => {
    mockUseAuth.mockReturnValue({ status: "anonymous" });
    renderRoute();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.queryByLabelText(/^title/i)).not.toBeInTheDocument();
  });
});
