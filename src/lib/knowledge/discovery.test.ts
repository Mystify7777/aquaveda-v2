import { describe, expect, it } from "vitest";

import {
  learnHref,
  learnQueryParams,
  parseLearnQuery,
  toKnowledgeListQuery,
  validateLearnTaxonomy,
} from "@/lib/knowledge/discovery";

const metadata = {
  categories: [{ slug: "water_conservation", displayName: "Water Conservation" }],
  topics: [
    { slug: "rainwater_harvesting", displayName: "Rainwater Harvesting" },
    { slug: "water_reuse", displayName: "Water Reuse" },
  ],
  regions: [{ key: "bihar", displayName: "Bihar" }],
  query: {
    search: "q",
    category: "category",
    topic: "topic",
    region: "region",
    pagination: { page: "page", limit: "limit" },
    repeatedValues: "topic=slug&topic=slug&region=key&region=key",
  },
} as const;

describe("parseLearnQuery", () => {
  it("parses the complete URL state", () => {
    expect(
      parseLearnQuery({
        q: "rainwater",
        category: "water_conservation",
        topic: ["water_reuse", "rainwater_harvesting"],
        region: ["jharkhand", "bihar"],
        page: "3",
        limit: "10",
      }),
    ).toEqual({
      state: {
        filters: {
          q: "rainwater",
          category: "water_conservation",
          topic: ["rainwater_harvesting", "water_reuse"],
          region: ["bihar", "jharkhand"],
        },
        page: 3,
        limit: 10,
      },
      invalid: [],
    });
  });

  it("does not normalize Region values", () => {
    const parsed = parseLearnQuery({ region: "Bihar" });
    expect(parsed.state.filters.region).toEqual(["Bihar"]);
    expect(parsed.invalid).toEqual([]);
  });

  it("rejects blank, padded, and malformed pagination/search values", () => {
    const parsed = parseLearnQuery({
      q: "  ",
      category: " water_conservation ",
      topic: ["", " water_reuse "],
      region: [" bihar "],
      page: "0",
      limit: "51",
    });
    expect(parsed.invalid.map((item) => item.key)).toEqual([
      "page",
      "limit",
      "q",
      "category",
      "topic",
      "region",
    ]);
  });

  it("round-trips repeated values deterministically", () => {
    const state = parseLearnQuery({
      q: "50% & water",
      topic: ["water_reuse", "rainwater_harvesting"],
      region: ["jharkhand", "bihar"],
      page: "2",
    }).state;

    const url = new URL(learnHref(state), "http://localhost");
    expect(url.pathname).toBe("/learn");
    expect(url.searchParams.getAll("topic")).toEqual([
      "rainwater_harvesting",
      "water_reuse",
    ]);
    expect(url.searchParams.getAll("region")).toEqual(["bihar", "jharkhand"]);
    expect(parseLearnQuery(Object.fromEntries(url.searchParams.entries())).state).toEqual(state);
  });

  it("serializes canonical parameter order and omits defaults", () => {
    expect(
      learnHref({
        filters: {
          region: ["jharkhand", "bihar"],
          topic: ["water_reuse", "rainwater_harvesting"],
          category: "water_conservation",
          q: "rainwater",
        },
        page: 1,
        limit: 20,
      }),
    ).toBe(
      "/learn?q=rainwater&category=water_conservation&topic=rainwater_harvesting&topic=water_reuse&region=bihar&region=jharkhand",
    );
  });

  it("validates unknown taxonomy values against API metadata", () => {
    expect(
      validateLearnTaxonomy(
        {
          category: "unknown",
          topic: ["rainwater_harvesting", "retired_topic"],
        },
        metadata,
      ),
    ).toEqual([
      {
        key: "category",
        value: "unknown",
        message: "category must be an active canonical taxonomy slug",
      },
      {
        key: "topic",
        value: "retired_topic",
        message: "topic must contain only active canonical taxonomy slugs",
      },
    ]);
  });

  it("produces the exact public API query shape", () => {
    const state = {
      filters: {
        q: "rainwater",
        category: "water_conservation",
        topic: ["water_reuse", "rainwater_harvesting"],
        region: ["bihar", "jharkhand"],
      },
      page: 2,
      limit: 10,
    };

    expect(toKnowledgeListQuery(state)).toEqual({
      q: "rainwater",
      category: "water_conservation",
      topic: ["rainwater_harvesting", "water_reuse"],
      region: ["bihar", "jharkhand"],
      page: 2,
      limit: 10,
    });
  });

  it("exposes repeated query metadata without inventing another URL contract", () => {
    expect(learnQueryParams({ topic: ["b", "a"], region: ["z", "y"] })).toEqual({
      topic: ["a", "b"],
      region: ["y", "z"],
    });
  });
});
