import type { Metadata } from "next";

import { RegisterForm } from "@/components/auth/register-form";
import { noIndexMetadata } from "@/lib/seo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Create account", ...noIndexMetadata() };

export default function RegisterPage() {
    return <div className="mx-auto flex max-w-6xl justify-center px-4 py-16 sm:px-6 sm:py-24"><Card className="w-full max-w-md"><CardHeader><CardTitle>Create your account</CardTitle><CardDescription>Join the people improving their communities.</CardDescription></CardHeader><CardContent><RegisterForm /></CardContent></Card></div>;
}