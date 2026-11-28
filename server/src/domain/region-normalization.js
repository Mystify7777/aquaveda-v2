/**
 * ADR-0011 Region normalization.
 *
 * The display value stored on Knowledge.region is never rewritten. This module
 * produces the separate matching key used by migration and request handling.
 *
 * The normalization steps are intentionally explicit:
 *   1. NFKC
 *   2. collapse Unicode White_Space runs to ASCII space
 *   3. trim ASCII spaces
 *   4. default toLowerCase()
 *   5. resolve an explicit source-controlled alias, if configured
 *
 * Alias targets are canonical normalized keys. Alias chains are rejected.
 */

const UNICODE_WHITE_SPACE =
  /[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/gu;

export const REGION_ALIASES = Object.freeze({});

/**
 * NFKC + Unicode White_Space normalization for display-value comparison.
 * This intentionally does not lowercase or resolve aliases.
 */
export function normalizeRegionDisplayVariant(value) {
  if (typeof value !== "string") return "";

  return value
    .normalize("NFKC")
    .replace(UNICODE_WHITE_SPACE, " ")
    .trim();
}

export function normalizeRegionBase(value) {
  return normalizeRegionDisplayVariant(value).toLowerCase();
}

function assertAliasRegistry(aliases) {
  for (const [source, target] of Object.entries(aliases)) {
    if (!source || !target || normalizeRegionBase(source) !== source) {
      throw new Error("Region aliases must use base-normalized source keys");
    }
    if (normalizeRegionBase(target) !== target) {
      throw new Error("Region alias targets must be base-normalized keys");
    }
    if (aliases[target] !== undefined) {
      throw new Error("Region alias chains are not allowed");
    }
  }
}

assertAliasRegistry(REGION_ALIASES);

export function normalizeRegionKey(value) {
  const base = normalizeRegionBase(value);
  if (!base) return "";
  return REGION_ALIASES[base] ?? base;
}

export const REGION_NORMALIZATION_TEST_VECTORS = Object.freeze([
  Object.freeze({ input: "  BIHAR   ", expectedBase: "bihar" }),
  Object.freeze({ input: "Bihar, India", expectedBase: "bihar, india" }),
  Object.freeze({ input: "Bihar\u00A0", expectedBase: "bihar" }),
  Object.freeze({ input: "ＡＢＣ", expectedBase: "abc" }),
  Object.freeze({ input: "Café", expectedBase: "café" }),
  Object.freeze({ input: "МОСКВА", expectedBase: "москва" }),
  Object.freeze({ input: "Straße", expectedBase: "straße" }),
]);
