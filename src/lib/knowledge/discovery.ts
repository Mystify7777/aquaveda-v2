import type { KnowledgeListQuery, KnowledgeTaxonomyMetadata } from "@/lib/api/types/knowledge";

export interface LearnFilters {
  q?: string;
  category?: string;
  topic?: string[];
  region?: string[];
}

export interface LearnQueryState {
  filters: LearnFilters;
  page: number;
  limit: number;
}

export interface LearnQueryInvalid {
  key: "q" | "category" | "topic" | "region" | "page" | "limit";
  value: string;
  message: string;
}

export interface ParsedLearnQuery {
  state: LearnQueryState;
  invalid: LearnQueryInvalid[];
}

type RawSearchParams = Record<string, string | string[] | undefined>;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const repeated = (value: string | string[] | undefined): string[] => {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]);
};

function codePointCompare(a: string, b: string): number {
  const left = Array.from(a, (character) => character.codePointAt(0) as number);
  const right = Array.from(b, (character) => character.codePointAt(0) as number);
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function canonicalRepeated(values: readonly string[]): string[] {
  return [...new Set(values)].sort(codePointCompare);
}

function parsePositiveInteger(
  key: "page" | "limit",
  raw: string | undefined,
  fallback: number,
  max?: number,
): { value: number; invalid?: LearnQueryInvalid } {
  if (raw === undefined) return { value: fallback };
  if (!/^\d+$/.test(raw)) {
    return {
      value: fallback,
      invalid: { key, value: raw, message: `${key} must be a positive integer` },
    };
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || (max !== undefined && value > max)) {
    return {
      value: fallback,
      invalid: {
        key,
        value: raw,
        message: max === undefined
          ? `${key} must be a positive integer`
          : `${key} must be between 1 and ${max}`,
      },
    };
  }

  return { value };
}

function validateSingle(
  key: "q" | "category",
  raw: string | undefined,
  invalid: LearnQueryInvalid[],
): string | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim().length === 0) {
    invalid.push({ key, value: raw, message: `${key} must not be empty` });
    return undefined;
  }
  if (raw !== raw.trim()) {
    invalid.push({ key, value: raw, message: `${key} must be canonical and must not contain surrounding whitespace` });
    return undefined;
  }
  if (key === "q" && raw.length > 200) {
    invalid.push({ key, value: raw, message: "q must not exceed 200 characters" });
    return undefined;
  }
  return raw;
}

function validateRepeated(
  key: "topic" | "region",
  values: string[],
  invalid: LearnQueryInvalid[],
): string[] {
  const valid: string[] = [];
  for (const value of values) {
    if (value.length === 0) {
      invalid.push({ key, value, message: `${key} must not contain empty values` });
      continue;
    }
    // Region is intentionally not normalized or aliased here.
    if (value !== value.trim()) {
      invalid.push({ key, value, message: `${key} values must be canonical and must not contain surrounding whitespace` });
      continue;
    }
    valid.push(value);
  }
  return canonicalRepeated(valid);
}

export function parseLearnQuery(sp: RawSearchParams): ParsedLearnQuery {
  const invalid: LearnQueryInvalid[] = [];

  const pageResult = parsePositiveInteger("page", first(sp.page), DEFAULT_PAGE);
  const limitResult = parsePositiveInteger("limit", first(sp.limit), DEFAULT_LIMIT, MAX_LIMIT);
  if (pageResult.invalid) invalid.push(pageResult.invalid);
  if (limitResult.invalid) invalid.push(limitResult.invalid);

  const filters: LearnFilters = {};

  const q = validateSingle("q", first(sp.q), invalid);
  if (q !== undefined) filters.q = q;

  const category = validateSingle("category", first(sp.category), invalid);
  if (category !== undefined) filters.category = category;

  const topics = validateRepeated("topic", repeated(sp.topic), invalid);
  if (topics.length) filters.topic = topics;

  const regions = validateRepeated("region", repeated(sp.region), invalid);
  if (regions.length) filters.region = regions;

  return {
    state: { filters, page: pageResult.value, limit: limitResult.value },
    invalid,
  };
}

/**
 * Validate taxonomy identities only when the metadata contract is available.
 * Region values are deliberately never normalized or aliased here.
 */
export function validateLearnTaxonomy(
  filters: LearnFilters,
  metadata: KnowledgeTaxonomyMetadata,
): LearnQueryInvalid[] {
  const invalid: LearnQueryInvalid[] = [];
  const categories = new Set(metadata.categories.map((term) => term.slug));
  const topics = new Set(metadata.topics.map((term) => term.slug));

  if (filters.category !== undefined && !categories.has(filters.category)) {
    invalid.push({
      key: "category",
      value: filters.category,
      message: "category must be an active canonical taxonomy slug",
    });
  }

  for (const topic of filters.topic ?? []) {
    if (!topics.has(topic)) {
      invalid.push({
        key: "topic",
        value: topic,
        message: "topic must contain only active canonical taxonomy slugs",
      });
    }
  }

  return invalid;
}

export function learnQueryParams(filters: LearnFilters): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  if (filters.q !== undefined) params.q = filters.q;
  if (filters.category !== undefined) params.category = filters.category;
  if (filters.topic?.length) params.topic = canonicalRepeated(filters.topic);
  if (filters.region?.length) params.region = canonicalRepeated(filters.region);
  return params;
}

export function learnPaginationParams(state: LearnQueryState): Record<string, string | string[]> {
  const params = learnQueryParams(state.filters);
  if (state.limit !== DEFAULT_LIMIT) params.limit = String(state.limit);
  return params;
}

export function learnHref(state: LearnQueryState): string {
  const search = new URLSearchParams();
  const params = learnQueryParams(state.filters);

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else {
      search.set(key, value);
    }
  }

  if (state.page !== DEFAULT_PAGE) search.set("page", String(state.page));
  if (state.limit !== DEFAULT_LIMIT) search.set("limit", String(state.limit));

  const query = search.toString();
  return query ? `/learn?${query}` : "/learn";
}

export function toKnowledgeListQuery(state: LearnQueryState): KnowledgeListQuery {
  return {
    page: state.page,
    limit: state.limit,
    ...(state.filters.q !== undefined ? { q: state.filters.q } : {}),
    ...(state.filters.category !== undefined ? { category: state.filters.category } : {}),
    ...(state.filters.topic?.length ? { topic: [...state.filters.topic] } : {}),
    ...(state.filters.region?.length ? { region: [...state.filters.region] } : {}),
  };
}
