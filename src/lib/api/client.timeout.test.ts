import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ApiError,
  DEFAULT_API_TIMEOUT_MS,
  apiRequest,
  isApiAbort,
  isApiTimeout,
} from "@/lib/api/client";

/**
 * Bounded lifetime and cancellation of the shared API boundary (#128).
 * Deterministic: fake timers drive the time limit (no real sleeping) and the
 * fetch doubles reject exactly the way a real fetch does when its signal aborts.
 */

const OK_BODY = JSON.stringify({ success: true, data: { hello: "world" }, message: "ok" });

const abortError = () => new DOMException("The operation was aborted.", "AbortError");

/** A fetch that never answers on its own and rejects when its signal aborts. */
function hangingFetch() {
  const fn = vi.fn((_url: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      // like a real fetch: an already-aborted signal rejects immediately
      if (init?.signal?.aborted) return reject(abortError());
      init?.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
    });
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** Headers arrive immediately; reading the body hangs until the signal aborts. */
function hangingBodyFetch() {
  const fn = vi.fn(async (_url: unknown, init?: RequestInit) => {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: () =>
        new Promise<string>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
        }),
    } as Response;
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function okFetch() {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => OK_BODY,
  } as Response);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const signalOf = (fn: ReturnType<typeof vi.fn>) => (fn.mock.calls[0][1] as RequestInit).signal as AbortSignal;

/** Settle a promise into an inspectable outcome without leaving it unhandled. */
function track<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false };
  promise.then(
    (value) => Object.assign(state, { done: true, value }),
    (error) => Object.assign(state, { done: true, error }),
  );
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("apiRequest: successful requests", () => {
  it("still succeeds and forwards every request option", async () => {
    const fetchMock = okFetch();
    const data = await apiRequest<{ hello: string }>("/x", {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ a: 1 }),
      headers: { "X-Test": "1" },
    });
    expect(data).toEqual({ hello: "world" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/x");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", credentials: "include", body: '{"a":1}' });
    expect(new Headers(init.headers).get("X-Test")).toBe("1");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    // internal option must not leak to fetch
    expect(init).not.toHaveProperty("timeoutMs");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("leaves no timer or listener behind after success", async () => {
    okFetch();
    const caller = new AbortController();
    await apiRequest("/x", { signal: caller.signal });
    expect(vi.getTimerCount()).toBe(0);
    // aborting later must be a no-op for the finished request
    expect(() => caller.abort()).not.toThrow();
  });

  it("a response that arrives before the limit is never reported as a timeout", async () => {
    okFetch();
    const outcome = track(apiRequest("/x"));
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toMatchObject({ done: true, value: { hello: "world" } });
    await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT_MS * 2);
    expect(outcome.error).toBeUndefined();
  });
});

describe("apiRequest: time limit", () => {
  it("documents a bounded default", () => {
    expect(DEFAULT_API_TIMEOUT_MS).toBe(15_000);
  });

  it("aborts a hanging request at the default limit and really cancels the underlying fetch", async () => {
    const fetchMock = hangingFetch();
    const outcome = track(apiRequest("/x"));

    await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT_MS - 1);
    expect(outcome.done).toBe(false);
    expect(signalOf(fetchMock).aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.done).toBe(true);
    expect(outcome.error).toBeInstanceOf(ApiError);
    expect(isApiTimeout(outcome.error)).toBe(true);
    expect(signalOf(fetchMock).aborted).toBe(true); // cancelled, not merely abandoned
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors a per-call timeoutMs", async () => {
    hangingFetch();
    const outcome = track(apiRequest("/x", { timeoutMs: 250 }));
    await vi.advanceTimersByTimeAsync(249);
    expect(outcome.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(isApiTimeout(outcome.error)).toBe(true);
  });

  it("a timeout is a network-kind error (existing 'unreachable' handling applies) with reason 'timeout'", async () => {
    hangingFetch();
    const outcome = track(apiRequest("/x", { timeoutMs: 10 }));
    await vi.advanceTimersByTimeAsync(10);
    expect(outcome.error).toMatchObject({ name: "ApiError", kind: "network", reason: "timeout", status: undefined });
    expect(isApiAbort(outcome.error)).toBe(false);
  });

  it("is distinguishable from an ordinary network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;
    const error: ApiError = await apiRequest<never>("/x").catch((e: ApiError) => e);
    expect(error).toMatchObject({ kind: "network", message: "Failed to fetch" });
    expect(error.reason).toBeUndefined();
    expect(isApiTimeout(error)).toBe(false);
    expect(isApiAbort(error)).toBe(false);
  });

  it("covers reading the response body: a body that hangs after the headers arrive times out", async () => {
    const fetchMock = hangingBodyFetch();
    const outcome = track(apiRequest("/x", { timeoutMs: 500 }));
    await vi.advanceTimersByTimeAsync(499);
    expect(outcome.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(isApiTimeout(outcome.error)).toBe(true);
    expect(signalOf(fetchMock).aborted).toBe(true);
  });
});

describe("apiRequest: caller cancellation", () => {
  it("a caller abort cancels the underlying fetch and rejects as an abort, not a timeout or failure", async () => {
    const fetchMock = hangingFetch();
    const caller = new AbortController();
    const outcome = track(apiRequest("/x", { signal: caller.signal }));

    await vi.advanceTimersByTimeAsync(100);
    expect(outcome.done).toBe(false);

    caller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome.done).toBe(true);
    expect(isApiAbort(outcome.error)).toBe(true);
    expect(outcome.error).toMatchObject({ kind: "aborted" });
    expect(isApiTimeout(outcome.error)).toBe(false);
    expect(signalOf(fetchMock).aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0); // the time limit is released, so it can never fire later
  });

  it("an already-aborted caller signal rejects as an abort without waiting", async () => {
    hangingFetch();
    const caller = new AbortController();
    caller.abort();
    const outcome = track(apiRequest("/x", { signal: caller.signal }));
    await vi.advanceTimersByTimeAsync(0);
    expect(isApiAbort(outcome.error)).toBe(true);
  });

  it("a caller abort while the body is being read is also an abort", async () => {
    hangingBodyFetch();
    const caller = new AbortController();
    const outcome = track(apiRequest("/x", { signal: caller.signal }));
    await vi.advanceTimersByTimeAsync(10);
    expect(outcome.done).toBe(false);
    caller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(isApiAbort(outcome.error)).toBe(true);
  });

  it("cancellation and timeout are distinguishable, in both orders", async () => {
    hangingFetch();
    const first = new AbortController();
    const abortedFirst = track(apiRequest("/x", { signal: first.signal, timeoutMs: 1000 }));
    await vi.advanceTimersByTimeAsync(10);
    first.abort();
    await vi.advanceTimersByTimeAsync(2000);
    expect(isApiAbort(abortedFirst.error)).toBe(true);
    expect(isApiTimeout(abortedFirst.error)).toBe(false);

    const second = new AbortController();
    const timedOutFirst = track(apiRequest("/x", { signal: second.signal, timeoutMs: 1000 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(isApiTimeout(timedOutFirst.error)).toBe(true);
    second.abort(); // late abort of a request that already timed out changes nothing
    await vi.advanceTimersByTimeAsync(0);
    expect(isApiTimeout(timedOutFirst.error)).toBe(true);
    expect(isApiAbort(timedOutFirst.error)).toBe(false);
  });

  it("independent requests do not share a time limit or cancellation", async () => {
    hangingFetch();
    const a = new AbortController();
    const first = track(apiRequest("/a", { signal: a.signal }));
    const second = track(apiRequest("/b", { timeoutMs: 60_000 }));
    a.abort();
    await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT_MS + 1);
    expect(isApiAbort(first.error)).toBe(true);
    expect(second.done).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(isApiTimeout(second.error)).toBe(true);
  });
});

describe("apiRequest: existing semantics are unchanged", () => {
  it("HTTP/API failures keep their ApiError shape and release the timer", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify({ success: false, data: null, message: "nope", code: "UNAUTHORIZED" }),
    } as Response) as unknown as typeof fetch;
    const error: ApiError = await apiRequest<never>("/x").catch((e: ApiError) => e);
    expect(error).toMatchObject({ name: "ApiError", kind: "http", status: 401, code: "UNAUTHORIZED", message: "nope" });
    expect(error.reason).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a non-abort failure while reading the body propagates unchanged", async () => {
    const boom = new TypeError("body stream broke");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => {
        throw boom;
      },
    } as unknown as Response) as unknown as typeof fetch;
    await expect(apiRequest("/x")).rejects.toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the type guards reject unrelated values", () => {
    for (const v of [undefined, null, new Error("x"), new ApiError("x", "network"), new ApiError("x", "http", 500)]) {
      expect(isApiTimeout(v)).toBe(false);
      expect(isApiAbort(v)).toBe(false);
    }
  });
});
