"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AuthError, getAuthErrorMessage } from "@/components/auth/auth-error";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import { useAuth } from "@/components/providers/auth-provider";
import { Input } from "@/components/ui/input";

export function LoginForm() {
    const { login } = useAuth();
    const router = useRouter();
    const [email, setEmail] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [pending, setPending] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        const normalizedEmail = email.trim();
        if (!normalizedEmail || !password) {
            setError("Enter your email and password.");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            setError("Enter a valid email address.");
            return;
        }

        setPending(true);
        try {
            await login({ email: normalizedEmail, password });
            router.replace("/");
        } catch (submitError) {
            setError(getAuthErrorMessage(submitError));
        } finally {
            setPending(false);
        }
    }

    return (
        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            {error && <AuthError message={error} />}
            <div className="space-y-2">
                <label htmlFor="login-email" className="text-sm font-medium">Email</label>
                <Input id="login-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <div className="space-y-2">
                <label htmlFor="login-password" className="text-sm font-medium">Password</label>
                <Input id="login-password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </div>
            <AuthSubmitButton pending={pending}>Sign in</AuthSubmitButton>
            <p className="text-muted-foreground text-center text-sm">
                New to AquaVeda? <Link href="/register" className="text-primary font-medium hover:underline">Create an account</Link>
            </p>
        </form>
    );
}