"use client";

import * as React from "react";
import { Input, type InputProps } from "@/components/ui/input";

export function PasswordInput(props: Omit<InputProps, "type">) {
  const [visible, setVisible] = React.useState(false);
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  const mounted = React.useRef(false);
  React.useLayoutEffect(() => {
    if (mounted.current) toggleRef.current?.focus();
    else mounted.current = true;
  }, [visible]);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={`pr-24 ${props.className ?? ""}`} />
      <button
        ref={toggleRef}
        type="button"
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-2 my-auto h-8 rounded px-2 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
