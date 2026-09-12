import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RouteError from "@/app/error";

/**
 * Imported as `RouteError`, not `Error` — `error.tsx`'s default export
 * is named `Error`, which would otherwise shadow the global `Error`
 * constructor throughout this file. `new Error("boom")` below needs to
 * construct a real Error object; if the import shadowed it, that call
 * would instead try to `new`-invoke the *component* (a functional
 * component invoked via `new` has no hook dispatcher, producing a
 * "Cannot read properties of null" crash from the first hook call
 * rather than a useful error pointing at the actual cause).
 */

describe("Error (route-level error.tsx)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders an alert region describing the failure", () => {
    render(<RouteError error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something broke");
  });

  it("logs the error to the console for diagnostics", () => {
    const err = new Error("boom");
    render(<RouteError error={err} reset={() => {}} />);
    expect(consoleErrorSpy).toHaveBeenCalledWith(err);
  });

  it("calls reset when 'Try again' is clicked, enabling recovery without a full reload", async () => {
    const reset = vi.fn();
    const user = userEvent.setup();
    render(<RouteError error={new Error("boom")} reset={reset} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
