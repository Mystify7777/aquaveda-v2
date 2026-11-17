# Frontend Accessibility & Interaction Regression Baseline

Issue: #130  
Scope: implemented frontend routes and their critical interactive flows  
Status: baseline established; targeted automation added; manual map/screen-reader verification remains an explicit follow-up.

## Purpose

This document is the repeatable regression checklist for frontend accessibility and interaction work. It is intentionally narrower than a WCAG audit: automated tests catch known regressions in the DOM contract and interaction behavior, while manual checks cover browser/screen-reader behavior that component tests cannot establish.

Do not treat this baseline as a claim of WCAG conformance.

## Route / interaction coverage

| Surface | Route(s) | Critical interactions | Automated coverage | Manual check |
| --- | --- | --- | --- | --- |
| Landing | `/` | primary navigation, report entry point, theme toggle | existing Navbar / navigation tests | keyboard navigation |
| Explore | `/explore` | search, category/severity filters, pagination, map, Search this area | IssueDiscoveryFilters baseline + existing map/loader tests | map keyboard controls, sticky map, screen reader |
| Issue detail | `/explore/[issueId]` | map, copy ID, issue actions, comments, recommendations | existing issue component tests | map controls/markers/popups, keyboard flow |
| Learn | `/learn`, `/learn/[knowledgeId]` | article links, pagination, workflow/review actions | existing knowledge/workflow tests | keyboard navigation and status announcements |
| Act | `/act`, `/act/[projectId]` | project links, creation flow, pagination | existing project form/card tests | keyboard navigation and validation |
| Community | `/community`, `/community/discussions/[discussionId]`, `/community/discussions/new` | activity filters, discussion links, composer | existing discussion/comment tests | keyboard composer flow and announcements |
| Authentication | `/auth/login`, `/auth/register` | labelled fields, validation, submit/pending, auth errors | LoginForm baseline; register form uses the same label/error primitives | keyboard-only submit and screen-reader error announcement |
| Protected surfaces | dashboard / protected community and workflow routes | auth boundary, forms, review actions | existing protected-component tests | keyboard and screen-reader verification where state changes move focus |

## Regression contracts

### Accessible names and labels

- Prefer Testing Library role/name and label queries over implementation selectors.
- Every form control must retain an accessible name.
- Visible labels must remain programmatically associated with their controls.
- Icon-only controls must retain an explicit accessible name.

Current automated anchors:
- `src/components/auth/login-form.test.tsx`
- `src/components/issues/issue-discovery-filters.test.tsx`
- `src/components/layout/navbar.test.tsx`
- `src/components/layout/mobile-nav.test.tsx`

### Keyboard reachability and focus

- Interactive controls must be reachable with Tab.
- Dialog opening must move focus into the dialog.
- Dialog dismissal with Escape must restore focus to the trigger.
- Existing focus rings must not be neutralised by local `outline-none` / `ring-0` overrides.
- Validation failures that already implement focus recovery must keep moving focus to the first actionable invalid field.

Current automated anchors:
- `src/components/layout/navbar.test.tsx`
- `src/components/layout/mobile-nav.test.tsx`
- `src/components/comments/comment-composer.test.tsx`
- `src/components/issues/issue-report-form.test.tsx`
- project/knowledge form tests

### Error and status announcements

- Recoverable errors use `role="alert"` where immediate announcement is required.
- Non-error asynchronous/result state uses `role="status"` where appropriate.
- Inputs with field errors expose `aria-invalid` and an appropriate `aria-describedby` relationship.
- Pending forms expose disabled/busy state without losing the user's entered data.

Current automated anchors:
- `src/components/auth/login-form.test.tsx`
- `src/components/issues/issue-discovery-filters.test.tsx`
- `src/components/issues/issue-report-form.test.tsx`
- `src/components/comments/comment-composer.test.tsx`
- `src/app/error.test.tsx`

### Dialogs

- Dialog has an accessible name.
- Opening does not emit Radix accessibility warnings.
- Focus is contained while open.
- Escape and explicit close dismiss the dialog.
- Dismissal returns focus to the trigger.

Current automated anchor:
- `src/components/layout/mobile-nav.test.tsx`
- `src/components/issues/issue-report-form.test.tsx` via `ReportIssueButton`

### Maps

Leaflet is not considered fully keyboard/screen-reader verified by unit tests alone.

Manual verification required:
- Tab reaches the map's interactive marker/control surfaces where the browser/Leaflet exposes them.
- Zoom and other map controls remain operable without a pointer.
- Marker focus/open-popup behavior is understandable to keyboard and screen-reader users.
- Popup links have usable accessible names and can be activated from the keyboard.
- Explore's sticky map does not trap focus or obscure the global navigation.
- "Search this area" remains reachable and announced after viewport changes.
- Repeat on desktop and mobile viewport widths.

## Manual check record

| Check | Status | Evidence / next action |
| --- | --- | --- |
| Mobile navigation keyboard flow | Automated baseline exists | Manual screen-reader pass still required |
| Mobile navigation dialog focus/dismissal | Automated baseline exists | Manual screen-reader pass still required |
| Issue map keyboard controls | Pending | Verify in a real browser |
| Issue map marker/popup keyboard flow | Pending | Verify in a real browser |
| Explore sticky map + Search this area | Pending | Verify in a real browser |
| Issue detail map + sticky Navbar | Pending | Verify in a real browser |
| Desktop + mobile responsive keyboard pass | Pending | Verify in a real browser |
| Screen-reader announcements for map/dialog flows | Pending | Verify with a real screen reader |

## Defect handling

Findings from this baseline follow the #130 boundary:

1. Fix a concrete defect directly in the affected component when the fix is local and behavior-preserving.
2. File a separate issue when the problem requires a broad redesign, changes shared semantics across unrelated surfaces, or changes domain behavior.
3. Do not introduce a heavyweight accessibility scanner solely to make the checklist look impressive. Humanity has enough dependency graphs already.

## Final gate

Before closing #130:

- [ ] focused accessibility regression tests pass
- [ ] frontend test suite passes
- [ ] lint passes
- [ ] typecheck passes
- [ ] production build passes
- [ ] manual keyboard checks recorded
- [ ] screen-reader checks recorded
- [ ] critical defects fixed or split into dedicated issues
