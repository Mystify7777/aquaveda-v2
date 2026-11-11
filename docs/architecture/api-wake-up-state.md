# API Wake-Up State

## Detection

The frontend enters the wake-up presentation when a client-side API request remains pending for **3 seconds**.

This is a product/UX threshold, not a backend health signal. The client cannot determine whether the delay is caused by a sleeping Render instance, transient network conditions, backend load, or another transport factor. Copy therefore says that the service is "taking a little longer to start" rather than asserting that a particular infrastructure component is waking.

## Request timeout

The shared API client already bounds each request at **15 seconds** by default via `DEFAULT_API_TIMEOUT_MS`. Timeout failures are represented as `ApiError` with `kind: "network"` and `reason: "timeout"`, exposed through `isApiTimeout()`.

The 3-second wake-up threshold therefore only changes presentation. It does not alter request lifetime, cancellation, retry behavior, or backend contracts.

## Why 3 seconds

Three seconds is used as a UX boundary because a public interactive request that has not completed by then is noticeably slower than normal page interaction. It is long enough to avoid turning ordinary network jitter into an infrastructure-looking message, while short enough to explain an apparent stall before the 15-second request timeout.

This is intentionally not presented as a Render cold-start duration.

## What the client knows

The client knows:

- when the request starts;
- whether the request is still pending;
- when the 3-second presentation threshold is crossed;
- whether the request succeeds;
- whether the shared request timeout expires;
- whether the caller cancels the request.

The client does **not** know:

- whether Render is actually waking a sleeping instance;
- why a slow request is slow;
- how long the backend will take to become responsive.

## UX boundary

The wake-up state is currently integrated into the client-fetched landing-page map preview. It is local to that surface, so one slow API request does not block the rest of the landing page.

The state is accessible through a polite status announcement and remains visually distinct from the ordinary loading skeleton and the later timeout/failure recovery state.

No optional navigation action is shown in this first integration because the available public routes are themselves backend-dependent. Sending the user to another route would therefore not be a genuine static escape hatch.

## Safety

The wake-up state does not retry or restart the request. There is one request lifecycle:

`loading -> wake-up presentation -> success | timeout/failure`

No mutation flow is involved, so there is no risk of duplicate submission or lost user input from this presentation.
