/**
 * Version-tolerant reading of MongoDB `explain("queryPlanner")` output.
 *
 * Stage names for a text search differ across server versions: 3.6 reports
 * a single `TEXT` stage; newer servers report `TEXT_MATCH` over an `IXSCAN`
 * on the text index (and `EOF` when the query has no index terms at all).
 * The properties the tests care about are version-independent, so they are
 * asserted through these helpers instead of one version's stage names.
 */

/** Every `"stage":"X"` / `"indexName":"Y"` token in a plan, in order. */
export function planTokens(plan) {
  return JSON.stringify(plan).match(/"stage":"[A-Z_0-9]+"|"indexName":"[^"]+"/g) ?? [];
}

export const hasStage = (tokens, stage) => tokens.includes(`"stage":"${stage}"`);
export const hasIndex = (tokens, indexName) => tokens.includes(`"indexName":"${indexName}"`);

/** The one invariant for a public endpoint: no collection scan, anywhere in the plan. */
export const scansCollection = (tokens) => hasStage(tokens, "COLLSCAN");

/** Text-index plan on any supported server: legacy TEXT stage, or TEXT_MATCH / IXSCAN on the text index. */
export const usesTextIndex = (tokens, indexName) =>
  hasStage(tokens, "TEXT") || hasStage(tokens, "TEXT_MATCH") || hasIndex(tokens, indexName);
