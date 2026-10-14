import fs from "node:fs";
import path from "node:path";

/**
 * Route/link contract helper (Issue #81). Test-only; never import from app code.
 *
 * Claim: given an internal link, can we prove from the src/app filesystem
 * that a page.* serves it? This is a deliberately small *approximation* of
 * App Router resolution, not a reimplementation of it.
 *
 * Understood:
 *  - static segments            /explore         -> explore/page.tsx
 *  - dynamic segments           /explore/abc     -> explore/[issueId]/page.tsx
 *  - route groups (group)       transparent, never part of the URL
 *  - catch-alls [...x],[[...x]] reported as "catch-all"; counts as implemented
 *                               (the shape is served; segment values are not checked)
 *  - query strings / fragments  ignored for path matching
 *  - literal-before-dynamic     a static dir without a page falls through to
 *                               a dynamic sibling, as Next does
 *
 * NOT modelled (results may be wrong if used): middleware/proxy, rewrites,
 * redirects, basePath/i18n, parallel (@slot) and intercepting ((.)x) routes
 * (skipped, never matched), route handlers (route.ts is not a page), and
 * whether a dynamic param value is valid (that is a runtime/data concern).
 */

export type HrefClass =
  | { kind: "internal"; pathname: string }
  | { kind: "external" } // scheme:, //host
  | { kind: "non-path" }; // "", "#frag", "?q", "relative/path"

export type RouteResolution =
  | "static" // every segment matched literally
  | "dynamic" // page exists, at least one segment matched [param]
  | "catch-all" // matched via a [...x]/[[...x]] page; the route shape is served, param/data validity is not verified
  | "missing"; // no page found under the modelled rules

const DEFAULT_APP_DIR = path.join(process.cwd(), "src", "app");
const PAGE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.js"];

const isRouteGroup = (name: string) => /^\((?!\.{1,3}\))[^)]+\)$/.test(name);
const isDynamic = (name: string) => /^\[[^[\].]+\]$/.test(name);
const isCatchAll = (name: string) => /^\[{1,2}\.\.\.[^[\]]+\]{1,2}$/.test(name);
const isOptionalCatchAll = (name: string) => /^\[\[\.\.\.[^[\]]+\]\]$/.test(name);
const isIgnored = (name: string) => name.startsWith("_") || name.startsWith("@") || /^\(\.{1,3}\)/.test(name);

/** Classifies an href; only "internal" is eligible for route resolution. */
export function classifyHref(href: string): HrefClass {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return { kind: "external" };
  if (!href.startsWith("/")) return { kind: "non-path" };
  return { kind: "internal", pathname: href.split(/[?#]/)[0] };
}

function dirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

const hasPage = (dir: string) => PAGE_FILES.some((f) => fs.existsSync(path.join(dir, f)));

/** Same-level directories (including via groups) that may host `page`. */
function candidates(dir: string): string[] {
  return [dir, ...dirs(dir).filter(isRouteGroup).flatMap((g) => candidates(path.join(dir, g)))];
}

function resolve(dir: string, segments: string[]): RouteResolution {
  const levels = candidates(dir);
  const names = (pred: (n: string) => boolean) =>
    levels.flatMap((l) => dirs(l).filter((n) => !isIgnored(n) && pred(n)).map((n) => path.join(l, n)));

  if (segments.length === 0) {
    if (levels.some(hasPage)) return "static";
    // Only an OPTIONAL catch-all matches zero segments; required [...x] does not.
    return names(isOptionalCatchAll).some(hasPage) ? "catch-all" : "missing";
  }
  const [head, ...rest] = segments;

  // Preference order mirrors Next: literal, then dynamic, then catch-all.
  for (const d of names((n) => n === head && !isRouteGroup(n))) {
    const r = resolve(d, rest);
    if (r !== "missing") return r;
  }
  for (const d of names(isDynamic)) {
    const r = resolve(d, rest);
    if (r !== "missing") return r === "static" ? "dynamic" : r;
  }
  for (const d of names(isCatchAll)) if (hasPage(d)) return "catch-all";
  return "missing";
}

/** Resolves an internal href against src/app. Non-internal hrefs are "missing". */
export function resolveAppRoute(href: string, appDir: string = DEFAULT_APP_DIR): RouteResolution {
  const c = classifyHref(href);
  if (c.kind !== "internal") return "missing";
  return resolve(appDir, c.pathname.split("/").filter(Boolean));
}

/**
 * Returns human-readable problems (empty = contract holds).
 *  - an href with no page that is not listed in `deferred`
 *  - a `deferred` href that now HAS a page (stale entry: remove it)
 * `deferred` = links intentionally pointing at not-yet-implemented routes.
 */
export function findBrokenLinks(hrefs: string[], deferred: readonly string[] = []): string[] {
  const problems: string[] = [];
  for (const href of hrefs) {
    const c = classifyHref(href);
    const key = c.kind === "internal" ? c.pathname : href;
    const exists = resolveAppRoute(href) !== "missing";
    const isDeferred = deferred.includes(key);
    if (!exists && !isDeferred) problems.push(`no page serves ${href}`);
    if (exists && isDeferred) problems.push(`${href} is listed as deferred but a page now exists`);
  }
  return problems;
}

/** Every in-app link (href starting with "/", not "//") inside a rendered tree. */
export function internalHrefs(container: ParentNode): string[] {
  return [...container.querySelectorAll("a[href]")]
    .map((a) => a.getAttribute("href")!)
    .filter((h) => classifyHref(h).kind === "internal");
}
