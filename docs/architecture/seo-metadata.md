# SEO and Metadata Policy

Issue #132 establishes the current frontend metadata policy.

## Public routes

The following routes are public and may be indexed:

| Route | Metadata source | Canonical behavior |
| --- | --- | --- |
| / | Stable product description | / |
| /explore | Static discovery description | Preserve validated discovery filters and page |
| /explore/[issueId] | Public Issue title + description | Exact public detail URL |
| /learn | Static reviewed-knowledge description | Preserve page number |
| /learn/[knowledgeId] | Public article title + body excerpt | Exact public detail URL |
| /act | Static project description | Preserve page number |
| /act/[projectId] | Public project title + description | Exact public detail URL |
| /community | Static public-conversation description | Preserve supported type filter + page |
| /community/discussions/[discussionId] | Public discussion title + body excerpt | Exact public detail URL |

Canonical URLs deliberately preserve meaningful discovery state. A filtered or paginated public view is not silently canonicalized back to the unfiltered first page.

Explore already normalizes blank/non-canonical filter parameters before rendering. Its metadata uses the same exploreHref() serialization as the route, so the canonical URL and shareable route use one representation.

## Social previews

Public routes emit:

- Open Graph title, description, URL, and site name.
- Twitter summary-card title and description.

No universal preview image is emitted. An image is added only when AquaVeda has a stable, route-appropriate asset rather than a fabricated generic image.

Dynamic detail metadata uses only public read data. It never includes viewer identity, workflow capabilities, private fields, or authenticated aggregates.

## Private surfaces

Authentication pages and the (protected) route group are explicitly noindex,nofollow.

This includes authenticated pages such as /dashboard, /learn/new, /learn/mine, /learn/review, and /act/new.

The route group is the enforcement point for authenticated metadata policy so new protected pages inherit the rule instead of needing to remember it individually.

## Site URL

The production canonical base is the verified Vercel production domain:

https://aquaveda-v2-one.vercel.app

It is configured as the Next.js metadataBase so relative canonical and Open Graph URLs resolve to the production origin rather than a local or preview deployment URL.