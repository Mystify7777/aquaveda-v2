import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_TOPICS,
} from "./knowledge-taxonomy.js";
import { normalizeRegionKey } from "./region-normalization.js";

const CATEGORY_RULES = Object.freeze([
  { slug: "water_quality", terms: ["water quality", "contamination", "contaminant", "pollution", "filtration", "chlorination"] },
  { slug: "groundwater", terms: ["groundwater", "aquifer", "borewell", "bore well", "water table", "well recharge"] },
  { slug: "wastewater_sanitation", terms: ["wastewater", "sewage", "sanitation", "septic", "sewer", "toilet"] },
  { slug: "agriculture_irrigation", terms: ["irrigation", "agriculture", "farmer", "farming", "crop", "drip irrigation", "sprinkler irrigation"] },
  { slug: "flood_drainage", terms: ["flood", "flooding", "drainage", "stormwater", "waterlogging"] },
  { slug: "water_governance", terms: ["water policy", "water governance", "water rights", "regulation", "water law", "allocation"] },
  { slug: "water_supply", terms: ["water supply", "distribution network", "pipeline", "piped water", "drinking water", "municipal water"] },
  { slug: "water_conservation", terms: ["water conservation", "water saving", "water efficiency", "rainwater harvesting", "water reuse", "water footprint"] },
  { slug: "community_practice", terms: ["community", "village", "awareness", "local practice", "community water"] },
]);

const TOPIC_RULES = Object.freeze([
  ["water_reuse", ["water reuse", "reuse water", "recycled water"]],
  ["efficient_irrigation", ["efficient irrigation", "drip irrigation", "sprinkler irrigation"]],
  ["rainwater_harvesting", ["rainwater harvesting", "rain water harvesting", "rainwater collection"]],
  ["sustainable_water_management", ["sustainable water management", "water sustainability"]],
  ["groundwater_recharge", ["groundwater recharge", "aquifer recharge", "recharge well"]],
  ["water_quality_monitoring", ["water quality monitoring", "water quality testing", "water testing"]],
  ["water_treatment", ["water treatment", "filtration", "chlorination", "treatment plant"]],
  ["wastewater_reuse", ["wastewater reuse", "treated wastewater reuse"]],
  ["sanitation", ["sanitation", "toilet", "septic", "sewerage"]],
  ["stormwater_management", ["stormwater management", "storm water management", "urban drainage"]],
  ["water_distribution_networks", ["distribution network", "water pipeline", "water network", "piped distribution"]],
  ["water_rights", ["water rights", "water allocation", "water entitlement"]],
  ["community_water_management", ["community water management", "village water management", "community-managed water"]],
  ["drought_management", ["drought management", "drought resilience", "water scarcity"]],
]);

/**
 * Explicit reviewed persisted-reference rewrites.
 *
 * These maps are intentionally empty for V1 because the production taxonomy
 * currently has no retired identities. A future semantic merge/retirement
 * must add an exact old-slug -> active-slug mapping here in the same PR that
 * approves the taxonomy change. The migration validates targets and rejects
 * chains/cycles so applying the map remains deterministic and idempotent.
 */
export const PERSISTED_CATEGORY_REWRITES = Object.freeze({});
export const PERSISTED_TOPIC_REWRITES = Object.freeze({});

const activeCategorySlugs = new Set(
  KNOWLEDGE_CATEGORIES.filter((term) => term.status === "ACTIVE").map((term) => term.slug),
);
const activeTopicSlugs = new Set(
  KNOWLEDGE_TOPICS.filter((term) => term.status === "ACTIVE").map((term) => term.slug),
);

function validateRewriteMap(rewrites, activeSlugs, kind) {
  for (const [source, target] of Object.entries(rewrites)) {
    if (!source || !target || source === target) {
      throw new Error(`Invalid ${kind} persisted rewrite: ${source} -> ${target}`);
    }
    if (activeSlugs.has(source)) {
      throw new Error(`Active ${kind} slug cannot be a rewrite source: ${source}`);
    }
    if (!activeSlugs.has(target)) {
      throw new Error(`Persisted ${kind} rewrite target is not ACTIVE: ${source} -> ${target}`);
    }
    if (Object.hasOwn(rewrites, target)) {
      throw new Error(`Persisted ${kind} rewrite chain/cycle is not allowed: ${source} -> ${target}`);
    }
  }
}

validateRewriteMap(PERSISTED_CATEGORY_REWRITES, activeCategorySlugs, "Category");
validateRewriteMap(PERSISTED_TOPIC_REWRITES, activeTopicSlugs, "Topic");

function scoreText(text, terms) {
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function selectCategory(text) {
  let best = { slug: "other", score: 0 };

  for (const rule of CATEGORY_RULES) {
    const score = scoreText(text, rule.terms);
    if (score > best.score || (score === best.score && score > 0 && rule.slug < best.slug)) {
      best = { slug: rule.slug, score };
    }
  }

  return best.slug;
}

function selectTopics(text) {
  return TOPIC_RULES
    .map(([slug, terms]) => ({ slug, score: scoreText(text, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .map(({ slug }) => slug);
}

export function classifyKnowledgeDocument({ title = "", body = "" } = {}) {
  const normalizedTitle = typeof title === "string" ? title.normalize("NFKC").toLowerCase() : "";
  const normalizedBody = typeof body === "string" ? body.normalize("NFKC").toLowerCase() : "";
  const text = normalizedTitle + " " + normalizedBody;

  return {
    category: selectCategory(text),
    topics: selectTopics(text),
  };
}

function rewritePersistedSlug(value, rewrites) {
  return typeof value === "string" && Object.hasOwn(rewrites, value)
    ? rewrites[value]
    : value;
}

export function buildKnowledgeMigrationPatch(document) {
  const classification = classifyKnowledgeDocument(document);
  const set = {};
  const issues = [];
  const rewrites = [];

  if (document.category == null) {
    set.category = classification.category;
  } else if (!activeCategorySlugs.has(document.category)) {
    const replacement = rewritePersistedSlug(document.category, PERSISTED_CATEGORY_REWRITES);

    if (replacement !== document.category) {
      set.category = replacement;
      rewrites.push({
        field: "category",
        from: document.category,
        to: replacement,
      });
    } else {
      issues.push({ field: "category", value: document.category, reason: "unknown-or-retired" });
    }
  }

  if (document.topics == null) {
    set.topics = classification.topics;
  } else {
    const rewrittenTopics = [];
    const unresolvedTopics = [];

    for (const slug of document.topics) {
      if (activeTopicSlugs.has(slug)) {
        rewrittenTopics.push(slug);
        continue;
      }

      const replacement = rewritePersistedSlug(slug, PERSISTED_TOPIC_REWRITES);
      if (replacement !== slug) {
        rewrittenTopics.push(replacement);
        rewrites.push({
          field: "topics",
          from: slug,
          to: replacement,
        });
      } else {
        rewrittenTopics.push(slug);
        unresolvedTopics.push(slug);
      }
    }

    const deduplicatedTopics = [...new Set(rewrittenTopics)];

    if (rewrites.some((rewrite) => rewrite.field === "topics")) {
      set.topics = deduplicatedTopics;
    }

    if (unresolvedTopics.length > 0) {
      issues.push({
        field: "topics",
        value: unresolvedTopics,
        reason: "unknown-or-retired",
      });
    }
  }

  if (document.regionKey == null) {
    set.regionKey = normalizeRegionKey(document.region);
  }

  return { set, issues, rewrites, classification };
}

export const MIGRATION_CATEGORY_RULES = CATEGORY_RULES;
export const MIGRATION_TOPIC_RULES = TOPIC_RULES;
