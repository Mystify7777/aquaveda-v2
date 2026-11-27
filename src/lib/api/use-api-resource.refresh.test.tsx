import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { ApiError } from "@/lib/api/client";
import { useApiResource } from "@/lib/api/use-api-resource";

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

describe("useApiResource.refresh (keep-data re-fetch)", () => {
  it("keeps the current data on screen while refreshing, then swaps in the new data", async () => {
    const second = deferred<string>();
    const fetcher = vi.fn().mockResolvedValueOnce("v1").mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useApiResource(fetcher, "k"));
    await waitFor(() => expect(result.current.resource).toEqual({ status: "success", data: "v1" }));

    act(() => result.current.refresh());
    expect(result.current.resource).toEqual({ status: "success", data: "v1" }); // never "loading"
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.resource.status).toBe("success");

    await act(async () => second.resolve("v2"));
    await waitFor(() => expect(result.current.resource).toEqual({ status: "success", data: "v2" }));
    expect(result.current.refreshing).toBe(false);
    expect(result.current.refreshError).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("a failed refresh keeps the data and reports refreshError (never replaces it with an error state)", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce("v1").mockRejectedValueOnce(new ApiError("boom", "http", 500));
    const { result } = renderHook(() => useApiResource(fetcher, "k"));
    await waitFor(() => expect(result.current.resource.status).toBe("success"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.refreshError).toBeInstanceOf(ApiError));
    expect(result.current.resource).toEqual({ status: "success", data: "v1" });
    expect(result.current.refreshing).toBe(false);
  });

  it("a later successful refresh clears the refreshError", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce("v1").mockRejectedValueOnce(new ApiError("x", "network")).mockResolvedValueOnce("v3");
    const { result } = renderHook(() => useApiResource(fetcher, "k"));
    await waitFor(() => expect(result.current.resource.status).toBe("success"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.refreshError).not.toBeNull());
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.resource).toEqual({ status: "success", data: "v3" }));
    expect(result.current.refreshError).toBeNull();
  });

  it("a superseded refresh is dropped: only the newest result lands", async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const fetcher = vi.fn().mockResolvedValueOnce("v1").mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const { result } = renderHook(() => useApiResource(fetcher, "k"));
    await waitFor(() => expect(result.current.resource.status).toBe("success"));
    act(() => result.current.refresh());
    act(() => result.current.refresh());
    await act(async () => fast.resolve("newest"));
    await act(async () => slow.resolve("stale"));
    await waitFor(() => expect(result.current.resource).toEqual({ status: "success", data: "newest" }));
    expect(result.current.refreshing).toBe(false);
  });

  it("a new key is still a foreground load (loading, then new data)", async () => {
    const fetcher = vi.fn(() => Promise.resolve("x"));
    const { result, rerender } = renderHook(({ k }) => useApiResource(fetcher, k), { initialProps: { k: "a" } });
    await waitFor(() => expect(result.current.resource.status).toBe("success"));
    rerender({ k: "b" });
    expect(result.current.resource.status).toBe("loading");
    await waitFor(() => expect(result.current.resource.status).toBe("success"));
  });

  it("a key change WHILE a refresh is in flight: the new key loads in the foreground, refreshing clears, and the old refresh's late result is ignored", async () => {
    const lateOldRefresh = deferred<string>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("a1") // key a, first load
      .mockReturnValueOnce(lateOldRefresh.promise) // key a, refresh (stays pending)
      .mockResolvedValueOnce("b1"); // key b, first load
    const { result, rerender } = renderHook(({ k }) => useApiResource(fetcher, k), { initialProps: { k: "a" } });
    await waitFor(() => expect(result.current.resource).toEqual({ status: "success", data: "a1" }));

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.refreshing).toBe(true));

    rerender({ k: "b" });
    expect(result.current.resource.status).toBe("loading"); // a different resource: never shows a's data
    await waitFor(() => expect(result.current.resource).toEqual({ status: "success", data: "b1" }));
    expect(result.current.refreshing).toBe(false);
    expect(result.current.refreshError).toBeNull();

    await act(async () => lateOldRefresh.resolve("a-late")); // the aborted refresh settles late
    expect(result.current.resource).toEqual({ status: "success", data: "b1" });
    expect(result.current.refreshing).toBe(false);
  });

  it("refresh() and reload() in the same tick: one foreground load wins, no stuck refreshing state", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce("v1").mockResolvedValue("v2");
    const { result } = renderHook(() => useApiResource(fetcher, "k"));
    await waitFor(() => expect(result.current.resource.status).toBe("success"));
    act(() => {
      result.current.refresh();
      result.current.reload();
    });
    await waitFor(() => expect(result.current.resource).toEqual({ status: "success", data: "v2" }));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.refreshError).toBeNull();
  });

  it("reload keeps its original semantics: a full foreground load", async () => {
    const second = deferred<string>();
    const fetcher = vi.fn().mockResolvedValueOnce("v1").mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useApiResource(fetcher, "k"));
    await waitFor(() => expect(result.current.resource.status).toBe("success"));
    act(() => result.current.reload());
    expect(result.current.resource.status).toBe("loading");
    await act(async () => second.resolve("v2"));
    await waitFor(() => expect(result.current.resource).toEqual({ status: "success", data: "v2" }));
  });

  it("a refresh that fails when no data was shown yet is an ordinary error", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new ApiError("x", "http", 500)).mockRejectedValueOnce(new ApiError("y", "http", 500));
    const { result } = renderHook(() => useApiResource(fetcher, "k"));
    await waitFor(() => expect(result.current.resource.status).toBe("error"));
    act(() => result.current.refresh());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.resource.status).toBe("error");
  });
});
