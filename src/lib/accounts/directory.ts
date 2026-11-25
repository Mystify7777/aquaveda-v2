import { roleLabel, stateLabel } from "@/lib/accounts/presentation";
import type { AdminDirectoryQuery, DirectoryAccountState, DirectoryRole } from "@/lib/api/types/accounts";

import {
  DIRECTORY_ROLES,
  DIRECTORY_STATES,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
} from "./directory-contract";

/**
 * URL-driven state of the Admin directory (#250). Pure.
 *
 * ONE RULE: the page accepts exactly what the API accepts (#181's
 * `accountDirectoryQuerySchema` is `.strict()`), and anything else is SURFACED
 * and NOT sent: an unknown parameter, a repeated parameter, an unrecognised
 * `role` / `accountState`, a `q` outside 2-100 characters, or a `page` that is not
 * a positive integer. Nothing invalid is silently dropped or coerced, so a
 * mistyped filter can never broaden the result set. Blank values (what the GET
 * form submits for "Any") mean "not set".
 *
 * Valid queries are unchanged: fixed serialization order (role, accountState, q,
 * page); inactive filters and page 1 omitted.
 */
export const ADMIN_ACCOUNTS_HREF = "/admin/accounts";

export interface DirectoryFilters {
  role?: DirectoryRole;
  accountState?: DirectoryAccountState;
  q?: string;
}

interface InvalidValue {
  value: string;
  problem: string;
}

export interface DirectoryInvalid {
  q?: InvalidValue;
  role?: InvalidValue;
  accountState?: InvalidValue;
  page?: InvalidValue;
  /** Parameter names the API does not accept. */
  unknown?: string[];
  /** Accepted parameters given more than once (the API accepts one value). */
  repeated?: string[];
}

export interface DirectoryQuery {
  filters: DirectoryFilters;
  page: number;
  invalid: DirectoryInvalid;
}

type RawParams = Record<string, string | string[] | undefined>;

const KNOWN_PARAMS = ["role", "accountState", "q", "page"] as const;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Lenient page parsing: used ONLY by the detail page's history `?page=` (a different, smaller surface). */
export function parsePage(raw: string | string[] | undefined): number {
  const n = Number(first(raw));
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function searchProblem(q: string): string | null {
  if (q.length < SEARCH_MIN_LENGTH) return `Search needs at least ${SEARCH_MIN_LENGTH} characters.`;
  if (q.length > SEARCH_MAX_LENGTH) return `Search can be at most ${SEARCH_MAX_LENGTH} characters.`;
  return null;
}

const listOf = (values: readonly string[], label: (v: string) => string) => {
  const names = values.map(label);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];
};

export function parseDirectoryQuery(params: RawParams): DirectoryQuery {
  const filters: DirectoryFilters = {};
  const invalid: DirectoryInvalid = {};

  const unknown = Object.keys(params).filter(
    (name) => params[name] !== undefined && !(KNOWN_PARAMS as readonly string[]).includes(name),
  );
  if (unknown.length) invalid.unknown = unknown;

  const repeated = KNOWN_PARAMS.filter((name) => Array.isArray(params[name]) && (params[name] as string[]).length > 1);
  if (repeated.length) invalid.repeated = [...repeated];

  // A repeated parameter is already reported; do not also validate its first value.
  const single = (name: (typeof KNOWN_PARAMS)[number]) =>
    (repeated as readonly string[]).includes(name) ? undefined : first(params[name])?.trim() || undefined;

  const role = single("role");
  if (role !== undefined) {
    if ((DIRECTORY_ROLES as readonly string[]).includes(role)) filters.role = role as DirectoryRole;
    else
      invalid.role = {
        value: role,
        problem: `Role "${role}" is not recognised. Use ${listOf(DIRECTORY_ROLES, roleLabel)}.`,
      };
  }

  const state = single("accountState");
  if (state !== undefined) {
    if ((DIRECTORY_STATES as readonly string[]).includes(state)) filters.accountState = state as DirectoryAccountState;
    else
      invalid.accountState = {
        value: state,
        problem: `Account state "${state}" is not recognised. Use ${listOf(DIRECTORY_STATES, stateLabel)}.`,
      };
  }

  const q = single("q");
  if (q !== undefined) {
    const problem = searchProblem(q);
    if (problem) invalid.q = { value: q, problem };
    else filters.q = q;
  }

  let page = 1;
  const rawPage = single("page");
  if (rawPage !== undefined) {
    const n = Number(rawPage); // the backend's own rule: z.coerce.number().int().min(1)
    if (Number.isInteger(n) && n >= 1) page = n;
    else invalid.page = { value: rawPage, problem: "Page must be a positive whole number." };
  }
  return { filters, page, invalid };
}

/** Every reason the query cannot be sent, in a stable order; empty when it can. */
export function directoryProblems(invalid: DirectoryInvalid): string[] {
  const out: string[] = [];
  if (invalid.unknown?.length)
    out.push(`Unknown ${invalid.unknown.length > 1 ? "parameters" : "parameter"}: ${invalid.unknown.join(", ")}.`);
  if (invalid.repeated?.length) out.push(`Only one value is allowed for: ${invalid.repeated.join(", ")}.`);
  for (const key of ["role", "accountState", "q", "page"] as const) {
    const entry = invalid[key];
    if (entry) out.push(entry.problem);
  }
  return out;
}

export const hasInvalidDirectoryQuery = (invalid: DirectoryInvalid) => directoryProblems(invalid).length > 0;

export function directorySearchParams(filters: DirectoryFilters, page = 1): URLSearchParams {
  const search = new URLSearchParams();
  if (filters.role) search.set("role", filters.role);
  if (filters.accountState) search.set("accountState", filters.accountState);
  if (filters.q) search.set("q", filters.q);
  if (page > 1) search.set("page", String(page));
  return search;
}

export function directoryHref(filters: DirectoryFilters, page = 1): string {
  const qs = directorySearchParams(filters, page).toString();
  return qs ? `${ADMIN_ACCOUNTS_HREF}?${qs}` : ADMIN_ACCOUNTS_HREF;
}

export const hasDirectoryFilters = (f: DirectoryFilters) => Boolean(f.role || f.accountState || f.q);

/** The API request for a parsed query. Exactly the backend's parameters, nothing else. */
export function toApiQuery({ filters, page }: Pick<DirectoryQuery, "filters" | "page">): AdminDirectoryQuery {
  return { page, ...filters };
}

export const accountDetailHref = (id: string, historyPage = 1) =>
  `${ADMIN_ACCOUNTS_HREF}/${encodeURIComponent(id)}${historyPage > 1 ? `?page=${historyPage}` : ""}`;
