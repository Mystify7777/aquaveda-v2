import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  return <div className="mx-auto flex max-w-6xl justify-center px-4 py-16 sm:px-6 sm:py-24"><Card className="w-full max-w-md"><CardHeader><CardTitle>Reset your password</CardTitle><CardDescription>Enter the email address associated with your account.</CardDescription></CardHeader><CardContent><ForgotPasswordForm /></CardContent></Card></div>;
}
