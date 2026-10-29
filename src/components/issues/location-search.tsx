"use client";

import * as React from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GeocodeResult } from "@/lib/api/geocode";
import { useLocationSearch } from "@/lib/issues/use-location-search";

export interface SelectedPlace {
  label: string;
}

/**
 * Place search for the report form (#134). Submit-driven (button or Enter),
 * never per keystroke. It only proposes candidates; the parent decides what a
 * selection means. No geolocation permission is involved, and nothing here
 * sends device coordinates anywhere.
 *
 * Must not render a <form>: it lives inside the report form, so Enter is
 * intercepted on the input instead.
 */
export const LocationSearch = React.forwardRef<
  HTMLInputElement,
  {
    selected: SelectedPlace | null;
    onSelect: (result: GeocodeResult) => void;
    onClear: () => void;
    error?: string;
    disabled?: boolean;
  }
>(function LocationSearch({ selected, onSelect, onClear, error, disabled }, ref) {
  const id = React.useId();
  const inputId = `${id}-place`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [query, setQuery] = React.useState("");
  const { state, search, reset } = useLocationSearch();

  function submit() {
    // Same rule as the Search button: no restart while a search is in flight.
    if (disabled || state.status === "loading") return;
    void search(query);
  }

  function choose(result: GeocodeResult) {
    onSelect(result);
    reset();
  }

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        Place
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          ref={ref}
          type="search"
          value={query}
          maxLength={200}
          autoComplete="off"
          placeholder="Locality, landmark, street or address"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : hintId}
        />
        <Button type="button" variant="outline" onClick={submit} disabled={disabled || state.status === "loading"}>
          Search
        </Button>
      </div>
      {error ? (
        <p id={errorId} className="text-destructive text-xs">
          {error}
        </p>
      ) : (
        <p id={hintId} className="text-muted-foreground text-xs">
          Search, then choose a result. No location permission needed. The text you search for is sent to a
          third-party place-search service; your device location is not.
        </p>
      )}

      <div aria-live="polite" className="space-y-2">
        {state.status === "loading" && <p className="text-muted-foreground text-sm">Searching…</p>}

        {state.status === "empty" && (
          <p className="text-muted-foreground text-sm">
            No places found. Try a different spelling, a nearby landmark, or enter coordinates.
          </p>
        )}

        {state.status === "error" && (
          <div role="alert" className="text-destructive space-y-1 text-sm">
            <p>{state.message}</p>
            {state.signIn && (
              <Button asChild size="sm" variant="outline">
                <Link href="/auth/login">Sign in</Link>
              </Button>
            )}
          </div>
        )}

        {state.status === "results" && (
          <ul aria-label="Place search results" className="divide-y rounded-md border text-sm">
            {state.results.map((r) => (
              <li key={`${r.latitude},${r.longitude},${r.label}`}>
                <button
                  type="button"
                  onClick={() => choose(r)}
                  className="hover:bg-muted focus-visible:ring-ring flex w-full items-start gap-2 px-3 py-2 text-left outline-none focus-visible:ring-2"
                >
                  <MapPin aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span>{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {(state.status === "results" || state.status === "empty") && (
          <p className="text-muted-foreground text-xs">
            Results:{" "}
            <a
              href={state.attribution.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {state.attribution.text}
            </a>
          </p>
        )}
      </div>

      {selected && (
        <div role="status" className="bg-muted/50 flex items-start justify-between gap-2 rounded-md border p-2 text-sm">
          <p>
            <span className="text-muted-foreground">Selected place: </span>
            {selected.label}
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </div>
      )}
    </div>
  );
});
