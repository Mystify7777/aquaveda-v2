import { ApiError } from "@/lib/api/client";

export function getAuthErrorMessage(error: unknown) {
    if (!(error instanceof ApiError)) return "Something went wrong. Try again.";

    if (error.code === "INVALID_CREDENTIALS") {
        return "We could not sign you in with those details.";
    }
    if (error.code === "EMAIL_ALREADY_REGISTERED") {
        return "An account with this email already exists. Try signing in instead.";
    }
    if (error.code === "VALIDATION_FAILED") {
        return error.message;
    }
    if (error.kind === "network") {
        return "The service is unavailable right now. Check your connection and try again.";
    }
    if (error.kind === "response") {
        return "The service returned an unexpected response. Try again.";
    }
    return "We could not complete that request. Try again.";
}

export function AuthError({ message }: { message: string }) {
    return (
        <p role="alert" className="text-destructive rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            {message}
        </p>
    );
}
