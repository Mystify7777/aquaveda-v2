import type { ReactNode } from "react";

export function WakeUpState({ action }: { action?: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-72 flex-col justify-between p-5"
    >
      <div className="space-y-3">
        <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          Taking a little longer
        </p>
        <p className="font-display text-base font-semibold">
          The service is taking a little longer to start.
        </p>
        <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
          The application is still working. You can keep browsing this page
          while the public issue data becomes available.
        </p>
      </div>

      {action ? <div>{action}</div> : null}
    </div>
  );
}
