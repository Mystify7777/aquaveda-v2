"use client";

import * as React from "react";

import { ApiError, isApiAbort } from "./client";

export type ApiResource<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: ApiError };

type Settled<T> = { token: string; outcome: { data: T } | { error: ApiError } };

/**
 * Minimal client-side read for authenticated endpoints, which cannot be
 * fetched in a Server Component (the session cookie belongs to the API
 * origin). Not a cache or a data library: one fetch per `key`, `reload`
 * re-runs it. Loading is derived (no state set synchronously inside the effect).
 *
 * Cancellation and staleness are two separate defenses:
 *  - the fetcher receives an `AbortSignal` that is aborted when the component
 *    unmounts, the `key` changes or `reload` supersedes the request. A fetcher
 *    that forwards it to the API client (`getX({ signal })`) gets its request
 *    genuinely cancelled; one that ignores it still works, just uncancelled.
 *  - a response from a superseded request is dropped either way (`active`).
 * A cancellation is never a result: an aborted request never becomes a
 * visible error. (The hook aborts only requests it has already superseded; if
 * a fetcher aborts itself, the resource simply stays as it was and its owner
 * is responsible for the next request, e.g. `reload`.)
 *
 * `key` must encode everything `fetcher` closes over (e.g. id, page,
 * status), since the fetcher itself is read through a ref.
 */
export function useApiResource<T>(fetcher: (signal: AbortSignal) => Promise<T>, key: string) {
  const fetcherRef = React.useRef(fetcher);
  React.useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [nonce, setNonce] = React.useState(0);
  const [settled, setSettled] = React.useState<Settled<T> | null>(null);
  const token = `${key}#${nonce}`;

  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetcherRef
      .current(controller.signal)
      .then(
        (data) => ({ data }),
        (e: unknown) => ({
          error: e instanceof ApiError ? e : new ApiError("Unexpected error", "response"),
        }),
      )
      .then((outcome) => {
        if ("error" in outcome && isApiAbort(outcome.error)) return;
        if (active) setSettled({ token, outcome });
      });
    return () => {
      active = false;
      controller.abort();
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
