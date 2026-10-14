"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { RequireAuth } from "@/components/auth/require-auth";
import { IssueReportForm } from "@/components/issues/issue-report-form";
import { Button } from "@/components/ui/button";

/**
 * Explore's contribution entry point. The trigger is always public;
 * RequireAuth gates only the dialog *content*, so /explore itself stays
 * anonymous-accessible. Backend authorization remains authoritative.
 */
export function ReportIssueButton() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button>Report an issue</Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="bg-background fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border p-5 shadow-xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogPrimitive.Title className="font-display text-lg font-semibold">
                Report a water issue
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-muted-foreground text-sm">
                Describe what you found and where.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <RequireAuth>
            {/* The server-rendered list is stale after a report; re-run it. */}
            <IssueReportForm onDone={() => setOpen(false)} onCreated={() => router.refresh()} />
          </RequireAuth>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
