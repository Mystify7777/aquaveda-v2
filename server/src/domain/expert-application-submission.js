/**
 * Expert application submission contract (design: docs/architecture/
 * expert-application-details-design.md; decision-register EXP-L9+).
 *
 * SINGLE SOURCE OF TRUTH for the submission vocabulary, limits, acknowledgement
 * wording and validation. Pure and import-free (no Mongoose, Express, Zod or
 * node:* imports) so the frontend can share it through the one boundary file
 * `src/lib/expert/submission-contract.ts`, exactly like issue-search.js. A test
 * enforces the zero-import property. Hashing (needs node:crypto) therefore
 * lives in the service, never here.
 *
 * Rules for change:
 * - An expertise `value` is a stable key: never rename or reuse; labels and
 *   descriptions may be reworded. Removal/rename needs a data-migration decision.
 * - A shipped acknowledgement version's text is NEVER edited; a wording change
 *   adds a new version. A test pins the SHA-256 of each shipped text.
 */

export const EXPERTISE_AREAS = Object.freeze([
  { value: "water_quality_treatment", label: "Water quality and treatment", description: "Testing, contamination, purification" },
  { value: "groundwater_wells", label: "Groundwater and wells", description: "Aquifers, borewells, recharge monitoring" },
  { value: "water_supply_distribution", label: "Supply and distribution", description: "Pipelines, pumping, tanks, municipal networks" },
  { value: "rainwater_conservation", label: "Rainwater and conservation", description: "Harvesting, watershed management, efficiency" },
  { value: "wastewater_sanitation", label: "Wastewater and sanitation", description: "Sewage, treatment, reuse" },
  { value: "flood_drainage_hydrology", label: "Flooding, drainage and hydrology", description: "Waterlogging, stormwater, surface water" },
  { value: "agricultural_water_use", label: "Agricultural water use", description: "Irrigation, crop water management" },
  { value: "community_field_practice", label: "Community and field practice", description: "Local water management, NGO and participatory work" },
  { value: "policy_governance", label: "Policy and governance", description: "Regulation, water rights, programmes" },
  { value: "other", label: "Other water expertise", description: "Water-related, fits none of the above" },
]);
export const EXPERTISE_VALUES = Object.freeze(EXPERTISE_AREAS.map((a) => a.value));

export const EXPERTISE_AREAS_MIN = 1;
export const EXPERTISE_AREAS_MAX = 3;
export const EXPERIENCE_MIN_LENGTH = 80;
export const EXPERIENCE_MAX_LENGTH = 1000;
export const AFFILIATION_MAX_LENGTH = 120;
export const REFERENCES_MAX = 3;
export const REFERENCE_MAX_LENGTH = 2048;

export const REJECT_NOTE_MIN_LENGTH = 10;
export const APPROVE_NOTE_MIN_LENGTH = 1;
export const NOTE_MAX_LENGTH = 500;
/**
 * Upper bound for a decision's `revision` (history length). History growth is not
 * domain-bounded, but the 16 MiB document limit is reached long before this
 * (~13 KB per full application cycle, so roughly 1,200 cycles / ~2,400 entries).
 * An application whose history somehow exceeded this bound could not be decided
 * through the API (`revision` would fail validation): that is an unsupported,
 * operator-repair situation, not a state this contract tries to serve.
 */
export const REVISION_MAX = 10_000;

/** Immutable, version-keyed acknowledgement wording. Never edit a shipped version. */
export const ACKNOWLEDGEMENT_TEXTS = Object.freeze({
  // v1 is UNRELEASED: its wording was settled (accuracy declaration + conduct
  // commitment) before release, so it could still be edited and re-pinned. From
  // the first release on it is frozen; any change adds version 2.
  1:
    "I confirm that the information in this application is accurate and complete to the best of my knowledge. " +
    "If approved, I will review Knowledge submissions impartially and will not review my own. " +
    "I understand an administrator decides this application, and that approval grants Knowledge review access only.",
});
export const CURRENT_ACKNOWLEDGEMENT_VERSION = 1;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const normalizeText = (s) => s.replace(/\r\n?/g, "\n").trim();

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
export function normalizeReferenceUrl(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "must be a string" };
  const text = raw.trim();
  if (!text) return { ok: false, reason: "must not be empty" };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "must be a valid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "must use https" };
  if (!url.hostname) return { ok: false, reason: "must include a host name" };
  if (url.username || url.password) return { ok: false, reason: "must not contain credentials" };
  if (url.href.length > REFERENCE_MAX_LENGTH) {
    return { ok: false, reason: `must be at most ${REFERENCE_MAX_LENGTH} characters` };
  }
  return { ok: true, value: url.href };
}

/**
 * Validates and normalizes an application submission request body.
 * Strict: unknown keys are errors. `acknowledgement` carries only `version`;
 * text, hash and timestamp are server-side facts and are never accepted.
 *
 * @param {unknown} input
 * The normalized `value` has the SAME shape as a valid request body
 * (`acknowledgement: { version }`) and is idempotent: validating it again returns
 * an equal value. That lets the route hand its already-normalized `parsed.data`
 * to the service, which still validates independently for direct callers.
 *
 * @returns {{ ok: true, value: {
 *   expertiseAreas: string[], experience: string, affiliation?: string,
 *   references: string[], acknowledgement: { version: number } } }
 *   | { ok: false, errors: Record<string, string> }}
 */
export function validateSubmission(input) {
  /** @type {Record<string, string>} */
  const errors = {};
  if (!isPlainObject(input)) return { ok: false, errors: { _: "request body must be an object" } };

  const allowed = new Set(["expertiseAreas", "experience", "affiliation", "references", "acknowledgement"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors[key] = "unknown field";
  }

  // expertiseAreas
  let expertiseAreas = [];
  if (!Array.isArray(input.expertiseAreas)) {
    errors.expertiseAreas = "select between 1 and 3 areas";
  } else {
    expertiseAreas = input.expertiseAreas;
    if (expertiseAreas.length < EXPERTISE_AREAS_MIN || expertiseAreas.length > EXPERTISE_AREAS_MAX) {
      errors.expertiseAreas = `select between ${EXPERTISE_AREAS_MIN} and ${EXPERTISE_AREAS_MAX} areas`;
    } else if (expertiseAreas.some((v) => typeof v !== "string" || !EXPERTISE_VALUES.includes(v))) {
      errors.expertiseAreas = "contains an unsupported area";
    } else if (new Set(expertiseAreas).size !== expertiseAreas.length) {
      errors.expertiseAreas = "areas must not repeat";
    }
  }

  // experience
  let experience = "";
  if (typeof input.experience !== "string") {
    errors.experience = "experience is required";
  } else {
    experience = normalizeText(input.experience);
    if (experience.length < EXPERIENCE_MIN_LENGTH) {
      errors.experience = `describe your experience in at least ${EXPERIENCE_MIN_LENGTH} characters`;
    } else if (experience.length > EXPERIENCE_MAX_LENGTH) {
      errors.experience = `experience must be at most ${EXPERIENCE_MAX_LENGTH} characters`;
    }
  }

  // affiliation (optional; a client omits the key rather than sending "")
  let affiliation;
  if (input.affiliation !== undefined) {
    if (typeof input.affiliation !== "string") {
      errors.affiliation = "must be a string";
    } else {
      const text = normalizeText(input.affiliation);
      if (text.length < 1) errors.affiliation = "omit affiliation instead of sending an empty value";
      else if (text.length > AFFILIATION_MAX_LENGTH) {
        errors.affiliation = `affiliation must be at most ${AFFILIATION_MAX_LENGTH} characters`;
      } else affiliation = text;
    }
  }

  // references (optional)
  const references = [];
  if (input.references !== undefined) {
    if (!Array.isArray(input.references)) {
      errors.references = "must be a list";
    } else if (input.references.length > REFERENCES_MAX) {
      errors.references = `at most ${REFERENCES_MAX} references`;
    } else {
      for (const [i, raw] of input.references.entries()) {
        const r = normalizeReferenceUrl(raw);
        if (!r.ok) {
          errors[`references.${i}`] = `reference ${i + 1} ${r.reason}`;
        } else if (!references.includes(r.value)) {
          references.push(r.value); // de-duplicate on the normalized href
        }
      }
    }
  }

  // acknowledgement: { version } only
  let acknowledgementVersion = 0;
  const ack = input.acknowledgement;
  if (!isPlainObject(ack)) {
    errors.acknowledgement = "the acknowledgement must be accepted";
  } else if (Object.keys(ack).some((k) => k !== "version")) {
    errors.acknowledgement = "only the acknowledgement version may be supplied";
  } else if (ack.version !== CURRENT_ACKNOWLEDGEMENT_VERSION) {
    errors.acknowledgement = "the acknowledgement text is out of date; reload and accept the current text";
  } else {
    acknowledgementVersion = ack.version;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      expertiseAreas: [...expertiseAreas],
      experience,
      ...(affiliation !== undefined ? { affiliation } : {}),
      references,
      acknowledgement: { version: acknowledgementVersion },
    },
  };
}

/**
 * Decision note (trim, then validate). Reject requires a meaningful note;
 * approve's note is optional (omit the key when blank).
 *
 * @param {unknown} raw
 * @param {{ required: boolean }} opts `required` = reject
 * @returns {{ ok: true, value: string | undefined } | { ok: false, reason: string }}
 */
export function validateDecisionNote(raw, { required }) {
  if (raw === undefined) {
    return required
      ? { ok: false, reason: `a note of at least ${REJECT_NOTE_MIN_LENGTH} characters is required` }
      : { ok: true, value: undefined };
  }
  if (typeof raw !== "string") return { ok: false, reason: "note must be a string" };
  const text = normalizeText(raw);
  const min = required ? REJECT_NOTE_MIN_LENGTH : APPROVE_NOTE_MIN_LENGTH;
  if (text.length < min) {
    return {
      ok: false,
      reason: required
        ? `note must be at least ${REJECT_NOTE_MIN_LENGTH} characters so the applicant knows what to change`
        : "omit the note instead of sending an empty value",
    };
  }
  if (text.length > NOTE_MAX_LENGTH) return { ok: false, reason: `note must be at most ${NOTE_MAX_LENGTH} characters` };
  return { ok: true, value: text };
}

/** `revision` = history length the reviewer saw. Integer 1..REVISION_MAX. */
export function isValidRevision(value) {
  return Number.isInteger(value) && value >= 1 && value <= REVISION_MAX;
}
