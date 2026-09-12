"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AuthError, getAuthErrorMessage } from "@/components/auth/auth-error";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import { useAuth } from "@/components/providers/auth-provider";
import { Input } from "@/components/ui/input";

export function RegisterForm() {
    const { register } = useAuth();
    const router = useRouter();
    const [name, setName] = React.useState("");
    const [email, setEmail] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [pending, setPending] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        const normalizedName = name.trim();
        const normalizedEmail = email.trim();
        if (!normalizedName || !normalizedEmail || !password) {
            setError("Enter your name, email, and password.");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            setError("Enter a valid email address.");
            return;
        }
        if (password.length < 8 || password.length > 128) {
            setError("Password must be between 8 and 128 characters.");
            return;
        }

        setPending(true);
        try {
            await register({ name: normalizedName, email: normalizedEmail, password });
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
            <div className="space-y-2"><label htmlFor="register-name" className="text-sm font-medium">Name</label><Input id="register-name" name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
            <div className="space-y-2"><label htmlFor="register-email" className="text-sm font-medium">Email</label><Input id="register-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            <div className="space-y-2"><label htmlFor="register-password" className="text-sm font-medium">Password</label><Input id="register-password" name="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><p className="text-muted-foreground text-xs">Use 8 to 128 characters.</p></div>
            <AuthSubmitButton pending={pending}>Create account</AuthSubmitButton>
            <p className="text-muted-foreground text-center text-sm">Already have an account? <Link href="/login" className="text-primary font-medium hover:underline">Sign in</Link></p>
        </form>
    );
}