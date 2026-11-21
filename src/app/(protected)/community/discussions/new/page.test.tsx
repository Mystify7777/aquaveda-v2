import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NewDiscussionPage from "@/app/(protected)/community/discussions/new/page";

const mockPush = vi.fn();
const mockCreateDiscussion = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/api/discussions", () => ({
  createDiscussion: (payload: unknown) => mockCreateDiscussion(payload),
}));

describe("new discussion route", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockCreateDiscussion.mockReset();
  });

  it("preserves entered content and distinguishes forbidden failure", async () => {
    const user = userEvent.setup();
    const { ApiError } = await import("@/lib/api/client");
    mockCreateDiscussion.mockRejectedValue(new ApiError("forbidden", "http", 403));

    render(<NewDiscussionPage />);

    await user.type(screen.getByLabelText("Title"), "Water quality");
    await user.selectOptions(screen.getByLabelText("Category"), "DISCUSSION");
    await user.type(screen.getByLabelText("Body"), "The supply has changed.");
    await user.click(screen.getByRole("button", { name: "Publish discussion" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your account is not permitted to create discussions.",
    );
    expect(screen.getByLabelText("Title")).toHaveValue("Water quality");
    expect(screen.getByLabelText("Category")).toHaveValue("DISCUSSION");
    expect(screen.getByLabelText("Body")).toHaveValue("The supply has changed.");
    expect(screen.getByRole("button", { name: "Publish discussion" })).toBeEnabled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not navigate until creation succeeds", async () => {
    const user = userEvent.setup();
    mockCreateDiscussion.mockResolvedValue({ _id: "d1" });

    render(<NewDiscussionPage />);
    await user.type(screen.getByLabelText("Title"), "Question");
    await user.type(screen.getByLabelText("Body"), "What changed?");
    await user.click(screen.getByRole("button", { name: "Publish discussion" }));

    expect(mockCreateDiscussion).toHaveBeenCalledWith({
      title: "Question",
      body: "What changed?",
      category: "QUESTION",
    });
    expect(mockPush).toHaveBeenCalledWith("/community/discussions/d1");
  });
});
