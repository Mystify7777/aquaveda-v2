"use client";

import * as React from "react";

import { useAuth } from "@/components/providers/auth-provider";
import { ApiError } from "@/lib/api/client";
import { getMyExpertApplication, getPendingExpertApplications } from "@/lib/api/expert-application";
import type { MyExpertApplication } from "@/lib/api/types/expert-application";

/** A tab that becomes visible again refreshes only if the last success is older than this. */
export const EXPERT_STATUS_STALE_AFTER_MS = 60_000;

type Scope = "user" | "admin";

type Snapshot = {
  key: string;
  application: MyExpertApplication | null;
  pendingCount: number | null;
  at: number;
};

export type ExpertStatusValue = {
  /** Which read applies to the signed-in role. USER: own status; ADMIN: pending count; others: none. */
  scope: Scope | "none";
  status: "idle" | "loading" | "ready" | "error";
  application: MyExpertApplication | null;
  pendingCount: number | null;
  /** A refresh failed but earlier data for this SAME identity is kept: show it as possibly out of date. */
  stale: boolean;
  error: ApiError | null;
  /** Force a fresh read (supersedes any in-flight one). Call after your own mutation. */
  refresh: () => Promise<void>;
  /** Install an authoritative result you just received (e.g. the apply response). */
  setApplication: (application: MyExpertApplication) => void;
};

const IDLE: ExpertStatusValue = {
  scope: "none",
  status: "idle",
  application: null,
  pendingCount: null,
  stale: false,
  error: null,
  refresh: async () => {},
  setApplication: () => {},
};

const ExpertStatusContext = React.createContext<ExpertStatusValue>(IDLE);

function scopeFor(role: string | undefined): Scope | null {
  if (role === "USER") return "user";
  if (role === "ADMIN") return "admin";
  return null;
}

/**
 * The SOLE fetcher of Expert-application status for the signed-in session
 * (nav chip, status page, admin badge all read it; nobody fetches it
 * independently). Not a cache or a data library, and no polling.
 *
 * - USER: `GET /me`. ADMIN: queue `limit=1`, reading `total` (independent of the
 *   page size). EXPERT/anonymous: nothing is fetched.
 * - State is keyed by `userId:role`. Any identity or role change makes the old
 *   data invisible at once and drops results of requests started for the old
 *   identity, so a late response can never leak into a new session.
 * - One in-flight request per key on mount/identity change (React Strict Mode's
 *   double effect shares it). An explicit `refresh()`/`setApplication()` starts a
 *   newer request generation, so an older response can never overwrite it.
 * - Refreshes: identity change, the caller's own mutations, and a tab becoming
 *   visible when the last success is older than a minute. Otherwise a change made
 *   elsewhere is not seen until one of these; consumers say so ("may be out of date").
 * - Failure: no prior data -> `error`; prior data for the same identity ->
 *   `ready` + `stale` so UIs can qualify it. Never shown as current.
 */
export function ExpertStatusProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus, user } = useAuth();
  const scope = authStatus === "authenticated" ? scopeFor(user?.role) : null;
  const key = scope && user ? `${user.id}:${user.role}` : null;

  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [failure, setFailure] = React.useState<{ key: string; error: ApiError } | null>(null);

  const keyRef = React.useRef<string | null>(key);
  const seqRef = React.useRef(0);
  const lastSuccessAt = React.useRef(0);
  const inFlight = React.useRef<{ key: string; promise: Promise<void> } | null>(null);

  React.useEffect(() => {
    keyRef.current = key;
  }, [key]);

  const load = React.useCallback((k: string, s: Scope, force: boolean): Promise<void> => {
    if (!force && inFlight.current?.key === k) return inFlight.current.promise;

    const seq = ++seqRef.current;
    const entry: { key: string; promise: Promise<void> | null } = { key: k, promise: null };
    entry.promise = (async () => {
      await null; // always async, so `inFlight` is registered before anything can settle
      try {
        let application: MyExpertApplication | null = null;
        let pendingCount: number | null = null;
        if (s === "user") application = await getMyExpertApplication();
        else pendingCount = (await getPendingExpertApplications({ page: 1, limit: 1 })).total;
        if (keyRef.current !== k || seqRef.current !== seq) return; // superseded or identity changed
        const at = Date.now();
        lastSuccessAt.current = at;
        setSnapshot({ key: k, application, pendingCount, at });
        setFailure(null);
      } catch (e) {
        if (keyRef.current !== k || seqRef.current !== seq) return;
        setFailure({ key: k, error: e instanceof ApiError ? e : new ApiError("Unexpected error", "response") });
      } finally {
        if (inFlight.current === entry) inFlight.current = null;
      }
    })();
    inFlight.current = entry as { key: string; promise: Promise<void> };
    return entry.promise;
  }, []);

  // Load on mount and whenever the identity changes.
  React.useEffect(() => {
    if (key && scope) void load(key, scope, false);
  }, [key, scope, load]);

  // A tab that comes back after a while re-reads once.
  React.useEffect(() => {
    if (!key || !scope) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSuccessAt.current < EXPERT_STATUS_STALE_AFTER_MS) return;
      void load(key, scope, false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [key, scope, load]);

  const refresh = React.useCallback(
    () => (key && scope ? load(key, scope, true) : Promise.resolve()),
    [key, scope, load],
  );

  const setApplication = React.useCallback(
    (application: MyExpertApplication) => {
      if (!key || scope !== "user") return;
      seqRef.current++; // drop any older in-flight read
      const at = Date.now();
      lastSuccessAt.current = at;
      setSnapshot({ key, application, pendingCount: null, at });
      setFailure(null);
    },
    [key, scope],
  );

  const value = React.useMemo<ExpertStatusValue>(() => {
    if (!key || !scope) return IDLE;
    const current = snapshot && snapshot.key === key ? snapshot : null;
    const error = failure && failure.key === key ? failure.error : null;
    return {
      scope,
      status: current ? "ready" : error ? "error" : "loading",
      application: current?.application ?? null,
      pendingCount: current?.pendingCount ?? null,
      stale: Boolean(current && error),
      error,
      refresh,
      setApplication,
    };
  }, [key, scope, snapshot, failure, refresh, setApplication]);

  return <ExpertStatusContext.Provider value={value}>{children}</ExpertStatusContext.Provider>;
}

/** Idle (no chip, no data) when used outside the provider, so surfaces stay usable in isolation. */
export function useExpertStatus(): ExpertStatusValue {
  return React.useContext(ExpertStatusContext);
}
