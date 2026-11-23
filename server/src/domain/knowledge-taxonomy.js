/**
 * Knowledge taxonomy contract (Issue #228 / ADR-0011).
 *
 * One authoritative, source-controlled vocabulary for Category and Topic.
 * Slugs are stable persisted identities; display names may be corrected.
 * Region is a separate geographic dimension and is not represented here.
 *
 * API responsibilities are deliberately distinct:
 * - getCategory/getTopic resolve ACTIVE and RETIRED terms for rendering.
 * - getAssignableCategory/getAssignableTopic resolve ACTIVE terms only.
 * - getActiveCategories/getActiveTopics supply selectable metadata/filter terms.
 *
 * No fuzzy matching, runtime vocabulary mutation, or taxonomy collection.
 */

const ACTIVE = "ACTIVE";
const RETIRED = "RETIRED";

export const TAXONOMY_STATUSES = Object.freeze([ACTIVE, RETIRED]);

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
  Object.freeze({ slug: "water_distribution_networks", displayName: "Water distribution networks", status: ACTIVE }),
  Object.freeze({ slug: "water_rights", displayName: "Water rights", status: ACTIVE }),
  Object.freeze({ slug: "community_water_management", displayName: "Community water management", status: ACTIVE }),
  Object.freeze({ slug: "drought_management", displayName: "Drought management", status: ACTIVE }),
]);

/**
 * Retired registries remain empty until a real persisted identity is retired.
 * Do not add synthetic terms here: these arrays are authoritative identities
 * that existing Knowledge records may contain.
 */
export const RETIRED_KNOWLEDGE_CATEGORIES = Object.freeze([]);
export const RETIRED_KNOWLEDGE_TOPICS = Object.freeze([]);

export const CATEGORY_ALIASES = Object.freeze({
  "water saving": "water_conservation",
  "water-saving": "water_conservation",
  "water conservation": "water_conservation",
  "water supply and distribution": "water_supply",
  "water supply & distribution": "water_supply",
  "water quality": "water_quality",
  "ground water": "groundwater",
  "waste water and sanitation": "wastewater_sanitation",
  "agriculture and irrigation": "agriculture_irrigation",
  "flooding and drainage": "flood_drainage",
  "policy and governance": "water_governance",
});

export const TOPIC_ALIASES = Object.freeze({
  "rain water harvesting": "rainwater_harvesting",
  "rain-water harvesting": "rainwater_harvesting",
  "rainwater collection": "rainwater_harvesting",
  "waste water reuse": "wastewater_reuse",
  "waste-water reuse": "wastewater_reuse",
  "ground water recharge": "groundwater_recharge",
  "ground-water recharge": "groundwater_recharge",
  "water quality testing": "water_quality_monitoring",
  "water treatment methods": "water_treatment",
  "storm water management": "stormwater_management",
  "drought response": "drought_management",
});

function normalizeAliasKey(value) {
  if (typeof value !== "string") return null;

  const key = value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  return key.length > 0 ? key : null;
}

function resolveFromRegistry(registry, aliases, value) {
  const key = normalizeAliasKey(value);
  if (key === null) return null;

  const canonicalSlug = aliases[key] ?? key;
  return registry.get(canonicalSlug) ?? null;
}

function resolveAssignable(registry, aliases, value) {
  const term = resolveFromRegistry(registry, aliases, value);
  return term?.status === ACTIVE ? term : null;
}

/**
 * Build taxonomy lookups from a supplied registry.
 *
 * The injectable registry keeps lifecycle behavior testable without placing
 * invented retired identities in the production vocabulary. Production uses
 * only the source-controlled registries below.
 */
export function createKnowledgeTaxonomyResolver({
  categories = KNOWLEDGE_CATEGORIES,
  topics = KNOWLEDGE_TOPICS,
  retiredCategories = RETIRED_KNOWLEDGE_CATEGORIES,
  retiredTopics = RETIRED_KNOWLEDGE_TOPICS,
  categoryAliases = CATEGORY_ALIASES,
  topicAliases = TOPIC_ALIASES,
} = {}) {
  const categoryRegistry = new Map(
    [...categories, ...retiredCategories].map((term) => [term.slug, term]),
  );
  const topicRegistry = new Map(
    [...topics, ...retiredTopics].map((term) => [term.slug, term]),
  );

  const resolveCategory = (value) => resolveFromRegistry(categoryRegistry, categoryAliases, value);
  const resolveTopic = (value) => resolveFromRegistry(topicRegistry, topicAliases, value);
  const resolveAssignableCategory = (value) => resolveAssignable(categoryRegistry, categoryAliases, value);
  const resolveAssignableTopic = (value) => resolveAssignable(topicRegistry, topicAliases, value);

  return Object.freeze({
    getCategory: resolveCategory,
    getTopic: resolveTopic,
    getAssignableCategory: resolveAssignableCategory,
    getAssignableTopic: resolveAssignableTopic,
    getActiveCategories: () => categories.filter((term) => term.status === ACTIVE),
    getActiveTopics: () => topics.filter((term) => term.status === ACTIVE),
    isActiveCategory: (value) => resolveAssignableCategory(value) !== null,
    isActiveTopic: (value) => resolveAssignableTopic(value) !== null,
    getCategoryDisplayName: (value) => resolveCategory(value)?.displayName ?? null,
    getTopicDisplayName: (value) => resolveTopic(value)?.displayName ?? null,
  });
}

const defaultResolver = createKnowledgeTaxonomyResolver();

/** Resolve active or retired Category identity for rendering. */
export const getCategory = defaultResolver.getCategory;
/** Resolve active or retired Topic identity for rendering. */
export const getTopic = defaultResolver.getTopic;
/** Resolve only an ACTIVE Category, safe for new/revised article assignment. */
export const getAssignableCategory = defaultResolver.getAssignableCategory;
/** Resolve only an ACTIVE Topic, safe for new/revised article assignment. */
export const getAssignableTopic = defaultResolver.getAssignableTopic;
export const getActiveCategories = defaultResolver.getActiveCategories;
export const getActiveTopics = defaultResolver.getActiveTopics;
export const isActiveCategory = defaultResolver.isActiveCategory;
export const isActiveTopic = defaultResolver.isActiveTopic;
/** Return the canonical display name for any known Category identity. */
export const getCategoryDisplayName = defaultResolver.getCategoryDisplayName;
/** Return the canonical display name for any known Topic identity. */
export const getTopicDisplayName = defaultResolver.getTopicDisplayName;

export function isActiveTaxonomyTerm(term) {
  return term?.status === ACTIVE;
}
