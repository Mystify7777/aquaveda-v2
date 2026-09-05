"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { getSystemSnapshot } from "@/lib/api/system";
import type { SystemSnapshot } from "@/lib/system";


export function FoundationRefreshButton({
  onRefreshed,
}: {
  onRefreshed: (snapshot: SystemSnapshot) => void;
}) {
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const handleRefresh = () => {
    setError(null);

    startTransition(async () => {
      try {
        const snapshot = await getSystemSnapshot();

        onRefreshed(snapshot);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Something went wrong",
        );
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={handleRefresh}
        disabled={isPending}
      >
        {isPending ? "Checking..." : "Refresh"}
      </Button>

      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}