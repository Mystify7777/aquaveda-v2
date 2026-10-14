"use client";

import * as React from "react";

import { ApiError } from "./client";

export type ApiResource<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: ApiError };

type Settled<T> = { token: string; outcome: { data: T } | { error: ApiError } };

/**
 * Minimal client-side read for authenticated endpoints, which cannot be
 * fetched in a Server Component (the session cookie belongs to the API
 * origin). Not a cache or a data library: one fetch per `key`, stale
 * responses from a superseded key are dropped, `reload` re-runs it.
 * Loading is derived (no state set synchronously inside the effect).
 *
 * `key` must encode everything `fetcher` closes over (e.g. id, page,
 * status), since the fetcher itself is read through a ref.
 */
export function useApiResource<T>(fetcher: () => Promise<T>, key: string) {
  const fetcherRef = React.useRef(fetcher);
  React.useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [nonce, setNonce] = React.useState(0);
  const [settled, setSettled] = React.useState<Settled<T> | null>(null);
  const token = `${key}#${nonce}`;

  React.useEffect(() => {
    let active = true;
    fetcherRef
      .current()
      .then(
        (data) => ({ data }),
        (e: unknown) => ({
          error: e instanceof ApiError ? e : new ApiError("Unexpected error", "response"),
        }),
      )
      .then((outcome) => {
        if (active) setSettled({ token, outcome });
      });
    return () => {
      active = false;
    };
  }, [token]);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  let resource: ApiResource<T> = { status: "loading" };
  if (settled && settled.token === token) {
    resource =
      "data" in settled.outcome
        ? { status: "success", data: settled.outcome.data }
        : { status: "error", error: settled.outcome.error };
  }
  return { resource, reload };
}
