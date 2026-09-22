import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IssueReportForm } from "@/components/issues/issue-report-form";
import { createIssue } from "@/lib/api/issues";

vi.mock("@/lib/api/issues", () => ({
    createIssue: vi.fn(),
}));

const createIssueMock = vi.mocked(createIssue);

describe("IssueReportForm", () => {
    beforeEach(() => {
        createIssueMock.mockReset();
    });

    it("renders the issue reporting fields and actions", () => {
        render(<IssueReportForm />);

        expect(
            screen.getByLabelText("Title"),
        ).toBeInTheDocument();

        expect(
            screen.getByLabelText("Description"),
        ).toBeInTheDocument();

        expect(
            screen.getByRole("button", {
                name: "Use my current location",
            }),
        ).toBeInTheDocument();

        expect(
            screen.getByRole("button", {
                name: "Report Issue",
            }),
        ).toBeInTheDocument();
    });

    it("requires a location before submitting", async () => {
        const user = userEvent.setup();

        render(<IssueReportForm />);

        const titleInput = screen.getByLabelText("Title");
        const descriptionInput = screen.getByLabelText("Description");
        const submitButton = screen.getByRole("button", {
            name: "Report Issue",
        });

        await user.type(titleInput, "Leaking pipe");

        await user.type(
            descriptionInput,
            "Water pooling near the market",
        );

        await user.click(submitButton);

        expect(
            screen.getByRole("alert"),
        ).toHaveTextContent(
            "Please capture your location before reporting the issue.",
        );
    });

    it("captures the user's current location", async () => {
        const user = userEvent.setup();

        const getCurrentPosition = vi.fn((success) => {
            success({
                coords: {
                    latitude: 12.9,
                    longitude: 77.5,
                },
            });
        });

        Object.defineProperty(navigator, "geolocation", {
            value: {
                getCurrentPosition,
            },
            configurable: true,
        });

        render(<IssueReportForm />);

        const locationButton = screen.getByRole("button", {
            name: "Use my current location",
        });

        await user.click(locationButton);

        expect(getCurrentPosition).toHaveBeenCalled();

        expect(
            screen.getByText("Location captured."),
        ).toBeInTheDocument();
    });

    it("submits the correct issue data", async () => {
        const user = userEvent.setup();

        createIssueMock.mockResolvedValueOnce({} as never);

        const getCurrentPosition = vi.fn((success) => {
            success({
                coords: {
                    latitude: 12.9,
                    longitude: 77.5,
                },
            });
        });

        Object.defineProperty(navigator, "geolocation", {
            value: {
                getCurrentPosition,
            },
            configurable: true,
        });

        render(<IssueReportForm />);

        await user.type(
            screen.getByLabelText("Title"),
            "Leaking pipe",
        );

        await user.type(
            screen.getByLabelText("Description"),
            "Water pooling near the market",
        );

        await user.click(
            screen.getByRole("button", {
                name: "Use my current location",
            }),
        );

        await user.click(
            screen.getByRole("button", {
                name: "Report Issue",
            }),
        );

        expect(createIssueMock).toHaveBeenCalledWith({
            title: "Leaking pipe",
            description: "Water pooling near the market",
            location: {
                type: "Point",
                coordinates: [77.5, 12.9],
            },
        });
    });

    it("shows an error when issue submission fails", async () => {
        const user = userEvent.setup();

        createIssueMock.mockRejectedValueOnce(
            new Error("Request failed"),
        );

        const getCurrentPosition = vi.fn((success) => {
            success({
                coords: {
                    latitude: 12.9,
                    longitude: 77.5,
                },
            });
        });

        Object.defineProperty(navigator, "geolocation", {
            value: {
                getCurrentPosition,
            },
            configurable: true,
        });

        render(<IssueReportForm />);

        await user.type(
            screen.getByLabelText("Title"),
            "Leaking pipe",
        );

        await user.type(
            screen.getByLabelText("Description"),
            "Water pooling near the market",
        );

        await user.click(
            screen.getByRole("button", {
                name: "Use my current location",
            }),
        );

        await user.click(
            screen.getByRole("button", {
                name: "Report Issue",
            }),
        );

        expect(
            await screen.findByRole("alert"),
        ).toHaveTextContent(
            "Unable to report the issue. Please try again.",
        );

        expect(
            screen.queryByRole("status"),
        ).not.toBeInTheDocument();
    });
});