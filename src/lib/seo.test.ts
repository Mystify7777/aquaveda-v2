import { describe, expect, it } from "vitest";

import {
  AQUAVEDA_DESCRIPTION,
  SITE_URL,
  cleanMetadataText,
  noIndexMetadata,
  publicPageMetadata,
} from "./seo";

describe("SEO metadata helpers", () => {
  it("uses the stable production site as the metadata base", () => {
    expect(SITE_URL.origin).toBe("https://aquaveda-v2-one.vercel.app");
  });

  it("builds canonical, Open Graph, and Twitter metadata without an image", () => {
    const metadata = publicPageMetadata({
      title: "Explore",
      description: "Discover public environmental issues.",
      canonical: "/explore?status=resolved&page=2",
    });

    expect(metadata.title).toBe("Explore");
    expect(metadata.description).toBe("Discover public environmental issues.");
    expect(metadata.alternates?.canonical).toBe("/explore?status=resolved&page=2");
    expect(metadata.openGraph).toMatchObject({
      title: "Explore | AquaVeda",
      url: new URL("https://aquaveda-v2-one.vercel.app/explore?status=resolved&page=2"),
      type: "website",
      siteName: "AquaVeda",
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary",
      title: "Explore | AquaVeda",
    });
    expect(metadata.openGraph).not.toHaveProperty("images");
  });

  it("collapses user content before using it as a description", () => {
    expect(cleanMetadataText("  one\n two\t three  ")).toBe("one two three");
    expect(cleanMetadataText("a".repeat(200))).toHaveLength(160);
    expect(cleanMetadataText("a".repeat(200)).endsWith("…")).toBe(true);
  });

  it("marks private/authenticated surfaces as noindex", () => {
    expect(noIndexMetadata()).toEqual({
      robots: { index: false, follow: false },
    });
  });

  it("keeps the shared description stable", () => {
    expect(AQUAVEDA_DESCRIPTION).toContain("environmental issues");
  });
});
