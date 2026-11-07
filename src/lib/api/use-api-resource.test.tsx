import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { ApiError, DEFAULT_API_TIMEOUT_MS, apiRequest } from "@/lib/api/client";
import { useApiResource } from "@/lib/api/use-api-resource";

describe("useApiResource", () => {
  it("loading -> success", async () => {
    const { result } = renderHook(() => useApiResource(() => Promise.resolve("data"), "k"));
    expect(result.current.resource.status).toBe("loading");
    await waitFor(() => expect(result.current.resource).toEqual({ status: "success", data: "data" }));
  });

  it("surfaces an ApiError, and wraps anything else in one", async () => {
    const api = renderHook(() => useApiResource(() => Promise.reject(new ApiError("x", "http", 403)), "a"));
    await waitFor(() => expect(api.result.current.resource.status).toBe("error"));
    expect(api.result.current.resource).toMatchObject({ error: { status: 403 } });

    const other = renderHook(() => useApiResource(() => Promise.reject(new TypeError("bug")), "b"));
    await waitFor(() => expect(other.result.current.resource.status).toBe("error"));
    expect(other.result.current.resource).toMatchObject({ error: expect.any(ApiError) });
  });

  it("reload re-runs the fetcher and passes back through loading", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce("one").mockResolvedValueOnce("two");
    const { result } = renderHook(() => useApiResource(fetcher, "k"));
    await waitFor(() => expect(result.current.resource).toMatchObject({ data: "one" }));
    act(() => result.current.reload());
    expect(result.current.resource.status).toBe("loading");
    await waitFor(() => expect(result.current.resource).toMatchObject({ data: "two" }));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("a new key refetches and a superseded response is dropped", async () => {
    let resolveFirst!: (v: string) => void;
    const first = new Promise<string>((r) => (resolveFirst = r));
    const fetcher = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce("second");
    const { result, rerender } = renderHook(({ k }) => useApiResource(fetcher, k), { initialProps: { k: "1" } });
    rerender({ k: "2" });
    await waitFor(() => expect(result.current.resource).toMatchObject({ data: "second" }));
    await act(async () => resolveFirst("stale"));
    expect(result.current.resource).toMatchObject({ data: "second" });
  });
});

describe("useApiResource: cancellation (#128)", () => {
  /** A fetcher that records each signal it was given and never settles on its own. */
  function recordingFetcher() {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>(() => {});
    });
    return { fetcher, signals };
  }

  it("hands the fetcher a live signal while the request is current", async () => {
    const { fetcher, signals } = recordingFetcher();
    renderHook(() => useApiResource(fetcher, "k"));
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0].aborted).toBe(false);
  });

  it("unmount aborts the in-flight request", async () => {
    const { fetcher, signals } = recordingFetcher();
    const { unmount } = renderHook(() => useApiResource(fetcher, "k"));
    await waitFor(() => expect(signals).toHaveLength(1));
    unmount();
    expect(signals[0].aborted).toBe(true);
  });

  it("changing the key aborts the previous request and starts a fresh, live one", async () => {
    const { fetcher, signals } = recordingFetcher();
    const { rerender } = renderHook(({ k }) => useApiResource(fetcher, k), { initialProps: { k: "1" } });
    await waitFor(() => expect(signals).toHaveLength(1));
    rerender({ k: "2" });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("reload supersedes the earlier request by aborting it", async () => {
    const { fetcher, signals } = recordingFetcher();
    const { result } = renderHook(() => useApiResource(fetcher, "k"));
    await waitFor(() => expect(signals).toHaveLength(1));
    act(() => result.current.reload());
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("the cancellation of a superseded request is never shown as an error", async () => {
    const rejectors: Array<(e: unknown) => void> = [];
    const fetcher = vi.fn((signal: AbortSignal) => {
      return new Promise<string>((resolve, reject) => {
        rejectors.push(reject);
        signal.addEventListener("abort", () => reject(new ApiError("Request was cancelled", "aborted")), { once: true });
        if (rejectors.length === 2) resolve("current");
      });
    });
    const { result, rerender } = renderHook(({ k }) => useApiResource(fetcher, k), { initialProps: { k: "1" } });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    rerender({ k: "2" }); // aborts request 1, whose promise now rejects with an abort
    await waitFor(() => expect(result.current.resource).toEqual({ status: "success", data: "current" }));
  });

  it("an abort that reaches an ACTIVE request is not turned into a visible error", async () => {
    const fetcher = vi.fn(() => Promise.reject(new ApiError("Request was cancelled", "aborted")));
    const { result } = renderHook(() => useApiResource(fetcher, "k"));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(result.current.resource.status).toBe("loading");
  });

  it("a genuine failure is still shown (cancellation handling does not swallow errors)", async () => {
    const { result } = renderHook(() => useApiResource(() => Promise.reject(new ApiError("down", "network")), "k"));
    await waitFor(() => expect(result.current.resource).toMatchObject({ status: "error", error: { kind: "network" } }));
  });

  it("a stale response is still dropped when the fetcher ignores the signal (second line of defense)", async () => {
    let resolveFirst!: (v: string) => void;
    const first = new Promise<string>((r) => (resolveFirst = r));
    const fetcher = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce("second");
    const { result, rerender } = renderHook(({ k }) => useApiResource(fetcher, k), { initialProps: { k: "1" } });
    rerender({ k: "2" });
    await waitFor(() => expect(result.current.resource).toMatchObject({ data: "second" }));
    await act(async () => resolveFirst("late"));
    expect(result.current.resource).toMatchObject({ data: "second" });
  });
});

describe("useApiResource with the real API client (#128)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function hangingFetch() {
    const fn = vi.fn((_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    });
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  it("unmounting really cancels the underlying network request", async () => {
    const fetchMock = hangingFetch();
    const { unmount } = renderHook(() => useApiResource((signal) => apiRequest("/x", { signal }), "k"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("a hanging request ends in a timeout error state instead of loading forever", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const { result } = renderHook(() => useApiResource((signal) => apiRequest("/x", { signal }), "k"));
    expect(result.current.resource.status).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT_MS);
    });
    expect(result.current.resource).toMatchObject({ status: "error", error: { kind: "network", reason: "timeout" } });
  });
});
