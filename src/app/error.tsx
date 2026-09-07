"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-16 sm:px-6 sm:py-24">
      <p
        role="alert"
        className="text-destructive font-mono text-xs tracking-widest uppercase"
      >
        Something broke
      </p>
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        This screen hit an error.
      </h1>
      <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
        Nothing you did caused this. Try again, and report it if it keeps
        happening.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
