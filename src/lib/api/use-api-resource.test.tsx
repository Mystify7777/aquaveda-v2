import { describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { ApiError } from "@/lib/api/client";
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
