/**
 * Pure actor predicate shared by the authorization primitive
 * (`services/authorization.js` requireRole, AUTH-L2) and the workflow
 * capability evaluator (`domain/workflow-actions.js`), so "has role X" has one
 * definition. Strict equality, one role: Product Invariant 9 (experts verify,
 * admins govern, neither substitutes) depends on there being no role-set form.
 */
export function hasRole(actor, role) {
  return !!actor && actor.role === role;
}
