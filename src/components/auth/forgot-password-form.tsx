"use client";

import * as React from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api/client";
import { requestPasswordReset } from "@/lib/api/auth";
import { AuthError } from "@/components/auth/auth-error";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import { Input } from "@/components/ui/input";

export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    setPending(true);
    try {
      await requestPasswordReset(normalizedEmail);
      setSent(true);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 429
        ? "Too many requests. Wait a little and try again."
        : "We could not send the request. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (sent) return <div role="status" aria-live="polite" className="space-y-4 text-sm">
    <p>If an account exists for that email, a password reset link will be sent.</p>
    <Link href="/auth/login" className="text-primary font-medium hover:underline">Back to sign in</Link>
  </div>;

  return <form className="space-y-5" onSubmit={handleSubmit} noValidate>
    {error && <AuthError message={error} />}
    <div className="space-y-2"><label htmlFor="forgot-email" className="text-sm font-medium">Email</label><Input id="forgot-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
    <AuthSubmitButton pending={pending}>Send reset link</AuthSubmitButton>
    <p className="text-center text-sm"><Link href="/auth/login" className="text-primary font-medium hover:underline">Back to sign in</Link></p>
  </form>;
}
