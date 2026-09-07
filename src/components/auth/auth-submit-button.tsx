"use client";

import { Button } from "@/components/ui/button";

export function AuthSubmitButton({
    pending,
    children,
}: {
    pending: boolean;
    children: React.ReactNode;
}) {
    return (
        <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Please wait..." : children}
        </Button>
    );
}
