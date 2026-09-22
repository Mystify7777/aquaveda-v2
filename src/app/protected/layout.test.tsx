import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import ProtectedLayout from "@/app/protected/layout";

/**
 * Proves the route-group layout actually wires RequireAuth in front of
 * its children — the "apply" half of Issue #43. See
 * require-auth.test.tsx for the full 5-state behavior; this file only
 * confirms the layout itself doesn't bypass or duplicate that logic.
 */
const mockUseAuth = vi.fn();

vi.mock("@/components/providers/auth-provider", () => ({
    useAuth: () => mockUseAuth(),
}));

describe("(protected) layout", () => {
    beforeEach(() => {
        mockUseAuth.mockReset();
    });

    it("does not render its children while anonymous", () => {
        mockUseAuth.mockReturnValue({ status: "anonymous", user: null, login: vi.fn(), register: vi.fn(), logout: vi.fn() });
        render(
            <ProtectedLayout>
                <div>Dashboard content</div>
            </ProtectedLayout>,
        );
        expect(screen.queryByText("Dashboard content")).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    });

    it("renders its children once authenticated", () => {
        mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role: "USER" }, login: vi.fn(), register: vi.fn(), logout: vi.fn() });
        render(
            <ProtectedLayout>
                <div>Dashboard content</div>
            </ProtectedLayout>,
        );
        expect(screen.getByText("Dashboard content")).toBeInTheDocument();
    });

    /**
     * Not full 5-state re-coverage — that's require-auth.test.tsx's
     * job, and duplicating it here would test the same thing twice.
     * This is a narrow structural check specifically for the two
     * states that were previously (before this correction pass)
     * conflated into one identical message: confirming the layout
     * doesn't accidentally leak protected children through either of
     * them is worth its own explicit assertion, given that exact bug
     * already happened once in this component.
     */
    it("does not render its children for session-failure", () => {
        mockUseAuth.mockReturnValue({ status: "session-failure", user: null, login: vi.fn(), register: vi.fn(), logout: vi.fn() });
        render(
            <ProtectedLayout>
                <div>Dashboard content</div>
            </ProtectedLayout>,
        );
        expect(screen.queryByText("Dashboard content")).not.toBeInTheDocument();
    });

    it("does not render its children for unavailable", () => {
        mockUseAuth.mockReturnValue({ status: "unavailable", user: null, login: vi.fn(), register: vi.fn(), logout: vi.fn() });
        render(
            <ProtectedLayout>
                <div>Dashboard content</div>
            </ProtectedLayout>,
        );
        expect(screen.queryByText("Dashboard content")).not.toBeInTheDocument();
    });
});
