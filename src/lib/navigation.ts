/**
 * Active-route matching for navigation links (issue #2).
 *
 *  - "page":    pathname is exactly the link's target (trailing slash ignored).
 *  - "section": pathname is a descendant of the target (`/explore/abc` for
 *               `/explore`), matched on a whole path segment, so `/exploreX`
 *               never matches `/explore`.
 *  - null:      no match. The root `/` only ever matches itself.
 *
 * Maps to `aria-current`: "page" → "page", "section" → "true".
 */
export type NavMatch = "page" | "section" | null;

const trim = (path: string) =>
  path.length > 1 ? path.replace(/\/+$/, "") : path;

export function matchNavPath(
  pathname: string | null | undefined,
  href: string,
): NavMatch {
  if (!pathname) return null;
  const current = trim(pathname);
  const target = trim(href);
  if (current === target) return "page";
  if (target !== "/" && current.startsWith(`${target}/`)) return "section";
  return null;
}
