"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError } from "@/lib/api/client";
import { resetPassword } from "@/lib/api/auth";
import { AuthError } from "@/components/auth/auth-error";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import { PasswordInput } from "@/components/auth/password-input";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8 || password.length > 128) {
      setError("Password must be between 8 and 128 characters.");
      return;
    }
    if (password !== confirmation) {
      return;
    }
    if (!token) return;
    setPending(true);
    try {
      await resetPassword({ token, password });
      setSuccess(true);
      window.history.replaceState({}, "", "/auth/reset-password");
      window.setTimeout(() => router.replace("/auth/login?passwordReset=success"), 1400);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "PASSWORD_RESET_INVALID") {
        setError("This reset link is invalid or has expired. Request a new one.");
      } else if (cause instanceof ApiError && cause.status === 429) {
        setError("Too many attempts. Wait a little and try again.");
      } else {
        setError("We could not update your password. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  if (success) return <div role="status" aria-live="polite" className="space-y-4 text-sm"><p>Your password has been updated. Redirecting you to sign in…</p><Link href="/auth/login" className="text-primary font-medium hover:underline">Sign in now</Link></div>;
  if (!token) return <div role="alert" className="space-y-4 text-sm"><p>This reset link is missing or invalid.</p><Link href="/auth/forgot-password" className="text-primary font-medium hover:underline">Request a new reset link</Link></div>;

  const mismatch = Boolean(confirmation && confirmation !== password);
  return <form className="space-y-5" onSubmit={handleSubmit} noValidate>
    {error && <AuthError message={error} />}
    <div className="space-y-2"><label htmlFor="reset-password" className="text-sm font-medium">New password</label><PasswordInput id="reset-password" name="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><p className="text-muted-foreground text-xs">Use 8 to 128 characters.</p></div>
    <div className="space-y-2"><label htmlFor="reset-confirm-password" className="text-sm font-medium">Confirm new password</label><PasswordInput id="reset-confirm-password" name="confirmPassword" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-invalid={mismatch} aria-describedby={mismatch ? "reset-confirm-error" : undefined} required />{mismatch && <p id="reset-confirm-error" role="alert" aria-live="polite" className="text-destructive text-xs">Passwords do not match.</p>}</div>
    <AuthSubmitButton pending={pending}>Update password</AuthSubmitButton>
    <p className="text-center text-sm"><Link href="/auth/login" className="text-primary font-medium hover:underline">Back to sign in</Link></p>
  </form>;
}
