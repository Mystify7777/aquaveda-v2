import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ResetPasswordPage() {
  return <div className="mx-auto flex max-w-6xl justify-center px-4 py-16 sm:px-6 sm:py-24"><Card className="w-full max-w-md"><CardHeader><CardTitle>Choose a new password</CardTitle><CardDescription>Use your reset link to update your password.</CardDescription></CardHeader><CardContent><Suspense fallback={<p role="status">Loading reset link…</p>}><ResetPasswordForm /></Suspense></CardContent></Card></div>;
}
