import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_API_WAKE_UP_THRESHOLD_MS,
  useApiWakeUpState,
} from "@/hooks/use-api-wake-up-state";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useApiWakeUpState", () => {
  it("enters the wake-up state after the configured threshold", () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useApiWakeUpState(true));

    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(DEFAULT_API_WAKE_UP_THRESHOLD_MS - 1);
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  it("clears the timer and resets when loading ends", () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(
      ({ loading }: { loading: boolean }) => useApiWakeUpState(loading),
      { initialProps: { loading: true } },
    );

    act(() => {
      vi.advanceTimersByTime(DEFAULT_API_WAKE_UP_THRESHOLD_MS);
    });
    expect(result.current).toBe(true);

    rerender({ loading: false });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(DEFAULT_API_WAKE_UP_THRESHOLD_MS);
    });
    expect(result.current).toBe(false);
  });
});
