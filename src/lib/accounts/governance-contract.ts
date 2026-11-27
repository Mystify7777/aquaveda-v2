/**
 * Backend limits for governance request text (ADR-0010; `account-governance.service.js`).
 * Re-exported from the backend domain modules (pure), the same boundary pattern as
 * `directory-contract.ts`; never copy these numbers into `src/`.
 */
import { REASON_MAX_LENGTH } from "../../../server/src/domain/governance-event.js";
import { SAFE_REASON_MAX_LENGTH } from "../../../server/src/domain/account-restriction.js";

export { REASON_MAX_LENGTH, SAFE_REASON_MAX_LENGTH };
