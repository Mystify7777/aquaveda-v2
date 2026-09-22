"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createIssue } from "@/lib/api/issues";
import type { IssueLocation } from "@/lib/api/types/issue";

export function IssueReportForm() {
    const [title, setTitle] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [location, setLocation] = React.useState<IssueLocation | null>(null);
    const [locationStatus, setLocationStatus] = React.useState<string | null>(
        null,
    );
    const [pending, setPending] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [success, setSuccess] = React.useState(false);

    const handleGetLocation = () => {
        setLocationStatus("Getting your location...");

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;

                setLocation({
                    type: "Point",
                    coordinates: [longitude, latitude],
                });

                setLocationStatus("Location captured.");
            },
            (error) => {
                if (error.code === error.PERMISSION_DENIED) {
                    setLocationStatus("Location permission was denied.");
                } else if (error.code === error.POSITION_UNAVAILABLE) {
                    setLocationStatus("Location is currently unavailable.");
                } else if (error.code === error.TIMEOUT) {
                    setLocationStatus("Location request timed out.");
                } else {
                    setLocationStatus("Unable to get your location.");
                }
            },
        );
    };

    const handleSubmit = async (
        event: React.FormEvent<HTMLFormElement>,
    ) => {
        event.preventDefault();

        setError(null);
        setSuccess(false);

        if (!title.trim()) {
            setError("Please enter a title.");
            return;
        }

        if (!description.trim()) {
            setError("Please describe what you observed.");
            return;
        }

        if (!location) {
            setError(
                "Please capture your location before reporting the issue.",
            );
            return;
        }

        setPending(true);

        try {
            await createIssue({
                title,
                description,
                location,
            });

            setSuccess(true);
        } catch {
            setError("Unable to report the issue. Please try again.");
        } finally {
            setPending(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
                <p role="alert" className="text-destructive text-sm">
                    {error}
                </p>
            )}

            {success && (
                <p role="status" className="text-sm">
                    Your issue was reported successfully.
                </p>
            )}

            <div className="space-y-2">
                <label
                    htmlFor="issue-title"
                    className="text-sm font-medium"
                >
                    Title
                </label>

                <Input
                    id="issue-title"
                    name="title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Briefly describe the issue"
                    required
                />
            </div>

            <div className="space-y-2">
                <label
                    htmlFor="issue-description"
                    className="text-sm font-medium"
                >
                    Description
                </label>

                <Textarea
                    id="issue-description"
                    name="description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Describe what you observed"
                    required
                />
            </div>

            <div className="space-y-2">
                <button
                    type="button"
                    onClick={handleGetLocation}
                    className="rounded-md border px-4 py-2 text-sm font-medium"
                >
                    Use my current location
                </button>

                {locationStatus && (
                    <p className="text-sm text-muted-foreground">
                        {locationStatus}
                    </p>
                )}
            </div>

            <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
                {pending ? "Submitting..." : "Report Issue"}
            </button>
        </form>
    );
}