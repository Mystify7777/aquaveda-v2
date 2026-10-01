import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { ApiError } from "@/lib/api/client";

describe("loadErrorMessage", () => {
  it("distinguishes network, session, permission and generic failures", () => {
    expect(loadErrorMessage(new ApiError("x", "network"), "things")).toMatch(/unreachable/);
    expect(loadErrorMessage(new ApiError("x", "http", 401), "things")).toMatch(/session is no longer valid/);
    expect(loadErrorMessage(new ApiError("x", "http", 403), "things")).toBe("Your account is not permitted to view things.");
    expect(loadErrorMessage(new ApiError("x", "http", 500), "things")).toBe("We could not load things. Try again.");
  });
});

describe("LoadError", () => {
  it("retryHref renders a link; onRetry renders a button that calls back; signIn adds a link", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<LoadError message="m" retryHref="/x" />);
    expect(screen.getByRole("alert")).toHaveTextContent("m");
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/x");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();

    rerender(<LoadError message="m" onRetry={onRetry} signIn />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
  });
});

describe("PaginationNav params", () => {
  it("preserves extra params on every link; page 1 drops only page", () => {
    render(<PaginationNav page={2} totalPages={3} basePath="/l" label="L" params={{ status: "draft" }} />);
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/l?status=draft");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/l?status=draft&page=3");
  });
});
