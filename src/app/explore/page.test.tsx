import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import ExplorePage from "@/app/explore/page";

vi.mock("@/components/auth/require-auth", () => ({
    RequireAuth: ({ children }: { children: React.ReactNode }) => (
        <>{children}</>
    ),
}));

describe("Explore page", () => {
    it("renders the issue reporting section", () => {
        render(<ExplorePage />);

        expect(
            screen.getByRole("heading", {
                name: "Report an issue",
            }),
        ).toBeInTheDocument();

        expect(
            screen.getByText(
                "Help document an issue by providing a short description and its affected location.",
            ),
        ).toBeInTheDocument();

        expect(
            screen.getByRole("textbox", {
                name: "Title",
            }),
        ).toBeInTheDocument();

        expect(
            screen.getByRole("textbox", {
                name: "Description",
            }),
        ).toBeInTheDocument();

        expect(
            screen.getByRole("button", {
                name: "Use my current location",
            }),
        ).toBeInTheDocument();
    });
});