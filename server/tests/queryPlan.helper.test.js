import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hasIndex, planTokens, scansCollection, usesTextIndex } from "./helpers/queryPlan.js";

/**
 * The plan classifier is tolerant of server-version differences. These are
 * the exact stage sequences reported by a newer MongoDB (TEXT_MATCH over
 * IXSCAN; EOF for an index-term-less query) and by 3.6 (single TEXT stage).
 */
const plan = (tokens) => ({ winningPlan: { s: tokens.map((t) => (t.startsWith("idx:") ? { indexName: t.slice(4) } : { stage: t })) } });

describe("query plan classification across server versions", () => {
  const newer = plan(["FETCH", "TEXT_MATCH", "idx:issue_text_search", "FETCH", "IXSCAN"]);
  const newerEof = plan(["FETCH", "TEXT_MATCH", "FETCH", "EOF"]);
  const legacy = plan(["FETCH", "TEXT", "idx:issue_text_search"]);
  const scan = plan(["COLLSCAN"]);

  it("recognises a text-index plan in both server shapes", () => {
    assert.ok(usesTextIndex(planTokens(newer), "issue_text_search"));
    assert.ok(usesTextIndex(planTokens(legacy), "issue_text_search"));
    assert.ok(hasIndex(planTokens(newer), "issue_text_search"));
  });

  it("recognises the index-term-less (EOF) plan as text-based and scan-free", () => {
    const t = planTokens(newerEof);
    assert.ok(usesTextIndex(t, "issue_text_search"));
    assert.equal(scansCollection(t), false);
  });

  it("still flags a collection scan, and does not mistake it for a text-index plan", () => {
    const t = planTokens(scan);
    assert.equal(scansCollection(t), true);
    assert.equal(usesTextIndex(t, "issue_text_search"), false);
  });
});
