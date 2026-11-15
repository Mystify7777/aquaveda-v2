import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IssueReportForm } from "@/components/issues/issue-report-form";
import { AuthError } from "@/components/auth/auth-error";
import { LoadError } from "@/components/ui/load-error";

vi.mock("@/lib/api/issues", () => ({
  createIssue: vi.fn(),
}));

describe("accessibility regression baseline", () => {
  describe("IssueReportForm", () => {
    it("keeps every primary field associated with its visible label", () => {
      render(<IssueReportForm />);

      expect(screen.getByLabelText("Title")).toHaveAttribute("id", "report-title");
      expect(screen.getByLabelText("Description")).toHaveAttribute("id", "report-description");
      expect(screen.getByLabelText("Place")).toBeInTheDocument();
      expect(screen.getByLabelText("Category (optional)")).toHaveAttribute("id", "report-category");
      expect(screen.getByLabelText("Severity (optional)")).toHaveAttribute("id", "report-severity");
    });

    it("exposes validation errors through invalid state and described-by relationships", async () => {
      const user = userEvent.setup();
      render(<IssueReportForm />);

      await user.click(screen.getByRole("button", { name: "Submit report" }));

      const title = screen.getByLabelText("Title");
      const description = screen.getByLabelText("Description");

      expect(title).toHaveAttribute("aria-invalid", "true");
      expect(title).toHaveAttribute("aria-describedby", "report-title-error");
      expect(screen.getByText("Title is required.")).toHaveAttribute("id", "report-title-error");

      expect(description).toHaveAttribute("aria-invalid", "true");
      expect(description).toHaveAttribute("aria-describedby", "report-description-error");
      expect(screen.getByText("Description is required.")).toHaveAttribute("id", "report-description-error");
    });

    it("allows keyboard traversal to reach the primary submit action", async () => {
      const user = userEvent.setup();
      render(<IssueReportForm />);

      for (let i = 0; i < 9; i += 1) {
        await user.tab();
      }

      expect(screen.getByRole("button", { name: "Submit report" })).toHaveFocus();
    });
  });

  describe("announcement primitives", () => {
    it("keeps authentication failures in an alert region", () => {
      render(<AuthError message="Sign-in failed." />);
      expect(screen.getByRole("alert")).toHaveTextContent("Sign-in failed.");
    });

    it("keeps retryable load failures in an alert with a keyboard-reachable retry action", async () => {
      const onRetry = vi.fn();
      const user = userEvent.setup();

      render(<LoadError message="The service is unavailable." onRetry={onRetry} />);

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("The service is unavailable.");

      const retry = screen.getByRole("button", { name: "Try again" });
      retry.focus();
      expect(retry).toHaveFocus();

      await user.keyboard("{Enter}");
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });
});
