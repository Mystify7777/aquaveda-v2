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

const activeCategorySlugs = new Set(
  KNOWLEDGE_CATEGORIES.filter((term) => term.status === "ACTIVE").map((term) => term.slug),
);
const activeTopicSlugs = new Set(
  KNOWLEDGE_TOPICS.filter((term) => term.status === "ACTIVE").map((term) => term.slug),
);

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
  const text = String(title).normalize("NFKC").toLowerCase() + " " +
    String(body).normalize("NFKC").toLowerCase();

  return {
    category: selectCategory(text),
    topics: selectTopics(text),
  };
}

export function buildKnowledgeMigrationPatch(document) {
  const classification = classifyKnowledgeDocument(document);
  const set = {};
  const issues = [];

  if (document.category == null) {
    set.category = classification.category;
  } else if (!activeCategorySlugs.has(document.category)) {
    issues.push({ field: "category", value: document.category, reason: "unknown-or-retired" });
  }

  if (document.topics == null) {
    set.topics = classification.topics;
  } else {
    const invalidTopics = document.topics.filter((slug) => !activeTopicSlugs.has(slug));
    if (invalidTopics.length > 0) {
      issues.push({ field: "topics", value: invalidTopics, reason: "unknown-or-retired" });
    }
  }

  if (document.regionKey == null) {
    set.regionKey = normalizeRegionKey(document.region);
  }

  return { set, issues, classification };
}

export const MIGRATION_CATEGORY_RULES = CATEGORY_RULES;
export const MIGRATION_TOPIC_RULES = TOPIC_RULES;
