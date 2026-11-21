import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProtectedRouteBoundary } from "@/components/auth/protected-route-boundary";

const mockUseAuth = vi.fn();
const mockUsePathname = vi.fn();

vi.mock("@/components/providers/auth-provider", () => ({
    useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
    usePathname: () => mockUsePathname(),
}));

function setStatus(status: "anonymous" | "session-failure" | "unavailable" | "initializing") {
    mockUseAuth.mockReturnValue({
        status,
        user: null,
        retryInitialization: vi.fn(),
    });
}

describe("ProtectedRouteBoundary", () => {
    beforeEach(() => {
        mockUseAuth.mockReset();
        mockUsePathname.mockReset();
    });

    it("centers the Dashboard authentication gate for anonymous state", () => {
        mockUsePathname.mockReturnValue("/dashboard");
        setStatus("anonymous");

        render(
            <ProtectedRouteBoundary>
                <div>Protected content</div>
            </ProtectedRouteBoundary>,
        );

        const gate = screen.getByText("Sign in to continue with this contribution.").parentElement;
        expect(gate).toHaveClass("items-center", "justify-center", "text-center");
        expect(gate).toHaveClass("min-h-[calc(100dvh-12rem)]");
        expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
            "href",
            "/auth/login",
        );
        expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute(
            "href",
            "/auth/register",
        );
    });

    it("centers the Dashboard unavailable state shown in the production preview", () => {
        mockUsePathname.mockReturnValue("/dashboard");
        setStatus("unavailable");

        render(
            <ProtectedRouteBoundary>
                <div>Protected content</div>
            </ProtectedRouteBoundary>,
        );

        const gate = screen.getByRole("alert").parentElement;
        expect(gate).toHaveClass("items-center", "justify-center", "text-center");
        expect(gate).toHaveClass("min-h-[calc(100dvh-12rem)]");
        expect(screen.getByRole("button", { name: "Retry connection" })).toBeInTheDocument();
    });

    it("centers the Dashboard session-failure state", () => {
        mockUsePathname.mockReturnValue("/dashboard");
        setStatus("session-failure");

        render(
            <ProtectedRouteBoundary>
                <div>Protected content</div>
            </ProtectedRouteBoundary>,
        );

        const gate = screen.getByRole("alert").parentElement;
        expect(gate).toHaveClass("items-center", "justify-center", "text-center");
        expect(gate).toHaveClass("min-h-[calc(100dvh-12rem)]");
        expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    });

    it("keeps non-Dashboard protected routes on the existing gate presentation", () => {
        mockUsePathname.mockReturnValue("/learn/new");
        setStatus("unavailable");

        render(
            <ProtectedRouteBoundary>
                <div>Protected content</div>
            </ProtectedRouteBoundary>,
        );

        const gate = screen.getByRole("alert").parentElement;
        expect(gate).not.toHaveClass("items-center");
        expect(gate).not.toHaveClass("justify-center");
        expect(gate).not.toHaveClass("text-center");
        expect(screen.getByRole("button", { name: "Retry connection" })).toBeInTheDocument();
    });

    it("passes through authenticated content without a gate frame", () => {
        mockUsePathname.mockReturnValue("/dashboard");
        mockUseAuth.mockReturnValue({
            status: "authenticated",
            user: { id: "u1", role: "USER" },
            retryInitialization: vi.fn(),
        });

        render(
            <ProtectedRouteBoundary>
                <div>Protected content</div>
            </ProtectedRouteBoundary>,
        );

        expect(screen.getByText("Protected content")).toBeInTheDocument();
    });
});
