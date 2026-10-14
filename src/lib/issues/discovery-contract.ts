/**
 * Frontend view of the Issue discovery contract (#41, used by #82).
 *
 * The backend domain module is the single source of truth for the `q` and
 * `bbox` rules; this file only re-exports it (typed) so the cross-package
 * import path lives in exactly one place, same boundary pattern as
 * `classification.ts` (#67). The backend module is pure (no Mongoose, no
 * Express, no imports), which is what makes it safe to share. Do not
 * re-implement or copy these rules anywhere in `src/`.
 *
 * Why not a top-level `shared/` package: `server/` is an independently
 * deployed, self-contained package (ADR-0002) and imports nothing from
 * outside itself; moving contract modules out would break that without a
 * workspace, which is deliberately deferred. If a shared package is ever
 * introduced it should take this and `classification.ts` together.
 */
import {
  BBOX_MAX_SPAN_DEGREES,
  bboxProblem,
  parseBbox,
  searchTextProblem,
} from "../../../server/src/domain/issue-search.js";

export { BBOX_MAX_SPAN_DEGREES, bboxProblem, parseBbox, searchTextProblem };
