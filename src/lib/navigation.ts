/**
 * Active-route matching for navigation links (issue #2).
 *
 *  - "page":    pathname is exactly the link's target (trailing slash ignored).
 *  - "section": pathname is a descendant of the target (`/explore/abc` for
 *               `/explore`), matched on a whole path segment, so `/exploreX`
 *               never matches `/explore`.
 *  - null:      no match. The root `/` only ever matches itself.
 *
 * Two outputs, deliberately separate:
 *  - VISUAL: any match ("page" or "section") highlights the link, so a section
 *    stays highlighted on its nested routes.
 *  - SEMANTIC (`aria-current`): only an exact match is exposed, as
 *    `aria-current="page"`. A nested route is not a destination in the
 *    navigation set, and several links claiming "current" in one landmark
 *    (e.g. Learn and Become an Expert on `/learn/expert-application`) blurs the
 *    signal. Destinations are unique, so at most one link per landmark is current.
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

/** The only `aria-current` value navigation links expose: exact match → "page". */
export function ariaCurrentFor(match: NavMatch): "page" | undefined {
  return match === "page" ? "page" : undefined;
}
