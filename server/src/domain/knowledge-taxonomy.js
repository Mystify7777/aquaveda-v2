/**
 * Knowledge taxonomy contract (Issue #228 / ADR-0011).
 *
 * This module is the single backend source of truth for the V1 Category and
 * Topic vocabulary. Slugs are stable persisted/API identities. Display names
 * are presentation copy and may be corrected without changing the slug.
 *
 * Category is exactly one primary subject area per article.
 * Topics are reusable secondary concepts and may be assigned zero or more.
 *
 * Region is deliberately excluded: it is a separate free-form geographic
 * dimension governed by ADR-0011 and its own normalization utility.
 *
 * Taxonomy changes are source-controlled. Do not add runtime taxonomy
 * mutation endpoints or a database taxonomy collection.
 */

const ACTIVE = "ACTIVE";
const RETIRED = "RETIRED";

export const TAXONOMY_STATUSES = Object.freeze([ACTIVE, RETIRED]);

/**
 * Initial V1 vocabulary is intentionally small.
 *
 * The broad categories are derived from AquaVeda's existing water-domain
 * vocabulary and the original SIH knowledge scope. Topics retain the more
 * specific concepts already represented by the product's Expert taxonomy and
 * SIH problem statement.
 */
export const KNOWLEDGE_CATEGORIES = Object.freeze([
  Object.freeze({ slug: "water_conservation", displayName: "Water conservation", status: ACTIVE }),
  Object.freeze({ slug: "water_supply", displayName: "Water supply and distribution", status: ACTIVE }),
  Object.freeze({ slug: "water_quality", displayName: "Water quality and treatment", status: ACTIVE }),
  Object.freeze({ slug: "groundwater", displayName: "Groundwater", status: ACTIVE }),
  Object.freeze({ slug: "wastewater_sanitation", displayName: "Wastewater and sanitation", status: ACTIVE }),
  Object.freeze({ slug: "agriculture_irrigation", displayName: "Agriculture and irrigation", status: ACTIVE }),
  Object.freeze({ slug: "flood_drainage", displayName: "Flooding and drainage", status: ACTIVE }),
  Object.freeze({ slug: "water_governance", displayName: "Water governance", status: ACTIVE }),
  Object.freeze({ slug: "community_practice", displayName: "Community and field practice", status: ACTIVE }),
  Object.freeze({ slug: "other", displayName: "Other water knowledge", status: ACTIVE }),
]);

export const KNOWLEDGE_TOPICS = Object.freeze([
  Object.freeze({ slug: "water_reuse", displayName: "Water reuse", status: ACTIVE }),
  Object.freeze({ slug: "efficient_irrigation", displayName: "Efficient irrigation", status: ACTIVE }),
  Object.freeze({ slug: "rainwater_harvesting", displayName: "Rainwater harvesting", status: ACTIVE }),
  Object.freeze({ slug: "sustainable_water_management", displayName: "Sustainable water management", status: ACTIVE }),
  Object.freeze({ slug: "groundwater_recharge", displayName: "Groundwater recharge", status: ACTIVE }),
  Object.freeze({ slug: "water_quality_monitoring", displayName: "Water quality monitoring", status: ACTIVE }),
  Object.freeze({ slug: "water_treatment", displayName: "Water treatment", status: ACTIVE }),
  Object.freeze({ slug: "wastewater_reuse", displayName: "Wastewater reuse", status: ACTIVE }),
  Object.freeze({ slug: "sanitation", displayName: "Sanitation", status: ACTIVE }),
  Object.freeze({ slug: "stormwater_management", displayName: "Stormwater management", status: ACTIVE }),
  Object.freeze({ slug: "water_supply_distribution", displayName: "Water supply and distribution", status: ACTIVE }),
  Object.freeze({ slug: "water_conservation", displayName: "Water conservation", status: ACTIVE }),
  Object.freeze({ slug: "water_rights", displayName: "Water rights", status: ACTIVE }),
  Object.freeze({ slug: "community_water_management", displayName: "Community water management", status: ACTIVE }),
  Object.freeze({ slug: "drought_management", displayName: "Drought management", status: ACTIVE }),
]);

/**
 * Explicit human-readable legacy/synonym spellings map to stable canonical
 * slugs. Canonical slugs resolve to themselves.
 */
export const TAXONOMY_ALIASES = Object.freeze({
  "water saving": "water_conservation",
  "water-saving": "water_conservation",
  "water conservation": "water_conservation",
  "rain water harvesting": "rainwater_harvesting",
  "rain-water harvesting": "rainwater_harvesting",
  "rainwater collection": "rainwater_harvesting",
  "efficient water use": "water_conservation",
  "waste water reuse": "wastewater_reuse",
  "waste-water reuse": "wastewater_reuse",
  "water supply & distribution": "water_supply_distribution",
  "ground water recharge": "groundwater_recharge",
  "ground-water recharge": "groundwater_recharge",
});

const CATEGORY_BY_SLUG = new Map(KNOWLEDGE_CATEGORIES.map((term) => [term.slug, term]));
const TOPIC_BY_SLUG = new Map(KNOWLEDGE_TOPICS.map((term) => [term.slug, term]));

function normalizeAliasKey(value) {
  return String(value)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function resolveFromRegistry(registry, value) {
  const key = normalizeAliasKey(value);
  const canonicalSlug = TAXONOMY_ALIASES[key] ?? key;
  return registry.get(canonicalSlug) ?? null;
}

export function getCategory(slugOrAlias) {
  return resolveFromRegistry(CATEGORY_BY_SLUG, slugOrAlias);
}

export function getTopic(slugOrAlias) {
  return resolveFromRegistry(TOPIC_BY_SLUG, slugOrAlias);
}

export function isActiveTaxonomyTerm(term) {
  return term?.status === ACTIVE;
}

export function getActiveCategories() {
  return KNOWLEDGE_CATEGORIES.filter(isActiveTaxonomyTerm);
}

export function getActiveTopics() {
  return KNOWLEDGE_TOPICS.filter(isActiveTaxonomyTerm);
}

export function isActiveCategory(slugOrAlias) {
  return isActiveTaxonomyTerm(getCategory(slugOrAlias));
}

export function isActiveTopic(slugOrAlias) {
  return isActiveTaxonomyTerm(getTopic(slugOrAlias));
}

export function getRetiredTaxonomyTerms(terms) {
  return terms.filter((term) => term?.status === RETIRED);
}
