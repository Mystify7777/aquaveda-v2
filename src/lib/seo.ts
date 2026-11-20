import type { Metadata } from "next";

export const SITE_URL = new URL("https://aquaveda-v2-one.vercel.app");

export const AQUAVEDA_DESCRIPTION =
  "AquaVeda connects environmental issues, trusted knowledge, community reporting, and coordinated action.";

export function publicPageMetadata({
  title,
  description,
  canonical,
  type = "website",
}: {
  title: string;
  description: string;
  canonical: string;
  type?: "website" | "article";
}): Metadata {
  const url = new URL(canonical, SITE_URL);

  return {
    title,
    description,
    alternates: { canonical: url.pathname + url.search },
    openGraph: {
      title: title + " | AquaVeda",
      description,
      url,
      type,
      siteName: "AquaVeda",
    },
    twitter: {
      card: "summary",
      title: title + " | AquaVeda",
      description,
    },
  };
}

export function cleanMetadataText(value: string, maxLength = 160): string {
  const cleaned = value.replace(/\\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength - 1).trimEnd() + "…";
}

export function noIndexMetadata(): Metadata {
  return {
    robots: {
      index: false,
      follow: false,
    },
  };
}
