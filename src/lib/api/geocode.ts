import { apiRequest } from "./client";
import { buildApiUrl } from "./config";

export interface GeocodeResult {
  /** Untrusted display text from the provider, already bounded server-side. */
  label: string;
  latitude: number;
  longitude: number;
}

export interface GeocodeAttribution {
  text: string;
  url: string;
}

export interface GeocodeSearchResponse {
  results: GeocodeResult[];
  attribution: GeocodeAttribution;
}

/** Submit-driven place search (never call per keystroke). Authenticated. */
export function searchLocations(query: string, init?: { signal?: AbortSignal }) {
  return apiRequest<GeocodeSearchResponse>(buildApiUrl("/api/v1/geocode/search", { q: query }), {
    cache: "no-store",
    signal: init?.signal,
  });
}
