const DEFAULT_DEV_API_URL = "http://localhost:5000";

export function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL || DEFAULT_DEV_API_URL;
  return raw.replace(/\/+$/, "");
}

export function buildApiUrl(
  path: string,
  query?: Record<string, string | number | undefined | null>,
): string {
  const url = new URL(
    path.startsWith("/") ? path : `/${path}`,
    getApiBaseUrl(),
  );

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}
