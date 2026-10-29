"use client";

import * as React from "react";

import { ApiError } from "@/lib/api/client";
import {
  searchLocations,
  type GeocodeAttribution,
  type GeocodeResult,
} from "@/lib/api/geocode";

/** Mirrors the server's sanity floor (geocode.validation.js); the server stays authoritative. */
const MIN_QUERY_LENGTH = 3;

export type LocationSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "results"; results: GeocodeResult[]; attribution: GeocodeAttribution }
  | { status: "empty"; attribution: GeocodeAttribution }
  | { status: "error"; message: string; signIn?: boolean };

function toErrorState(error: unknown): LocationSearchState {
  const fallback = "Place search is unavailable right now. Use your current location or enter coordinates.";
  if (error instanceof ApiError) {
    if (error.kind === "network") {
      return { status: "error", message: "Could not reach the service. Check your connection and try again." };
    }
    if (error.status === 401) {
      return { status: "error", message: "Sign in again to search for places.", signIn: true };
    }
    if (error.status === 429) {
      return { status: "error", message: "Too many searches. Wait a moment and try again." };
    }
    if (error.status === 400) {
      return { status: "error", message: "Enter between 3 and 200 characters." };
    }
  }
  return { status: "error", message: fallback };
}

/**
 * Submit-driven place search. Exactly one request is in flight: starting a
 * new search or calling reset()/unmounting aborts the previous one, and a
 * superseded response can never overwrite newer state.
 */
export function useLocationSearch() {
  const [state, setState] = React.useState<LocationSearchState>({ status: "idle" });
  const controllerRef = React.useRef<AbortController | null>(null);

  const reset = React.useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ status: "idle" });
  }, []);

  const search = React.useCallback(async (rawQuery: string) => {
    const query = rawQuery.replace(/\s+/g, " ").trim();
    controllerRef.current?.abort();
    if (query.length < MIN_QUERY_LENGTH) {
      controllerRef.current = null;
      setState({ status: "error", message: `Enter at least ${MIN_QUERY_LENGTH} characters to search.` });
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading" });
    try {
      const { results, attribution } = await searchLocations(query, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setState(results.length === 0 ? { status: "empty", attribution } : { status: "results", results, attribution });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState(toErrorState(error));
    }
  }, []);

  React.useEffect(() => () => controllerRef.current?.abort(), []);

  return { state, search, reset };
}
