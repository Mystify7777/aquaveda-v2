import * as React from "react";

/**
 * A UX threshold, not a claim about backend infrastructure.
 *
 * Requests that remain pending beyond this point are noticeably slower than
 * normal interactive loading, so the UI can explain that the service may be
 * taking longer to start. The API client still owns the hard 15s request
 * timeout; this threshold only changes presentation.
 */
export const DEFAULT_API_WAKE_UP_THRESHOLD_MS = 3_000;

export function useApiWakeUpState(
  loading: boolean,
  thresholdMs = DEFAULT_API_WAKE_UP_THRESHOLD_MS,
): boolean {
  const [isWakingUp, setIsWakingUp] = React.useState(false);

  React.useEffect(() => {
    if (!loading) {
      setIsWakingUp(false);
      return;
    }

    setIsWakingUp(false);
    const timer = window.setTimeout(() => setIsWakingUp(true), thresholdMs);

    return () => window.clearTimeout(timer);
  }, [loading, thresholdMs]);

  return isWakingUp;
}
