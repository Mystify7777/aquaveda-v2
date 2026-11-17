# Frontend Accessibility & Interaction Regression Baseline

Issue: #130  
Scope: implemented frontend routes and their critical interactive flows  
Status: automated baseline increment in place; manual browser, screen-reader and contrast checks remain outstanding.

## Purpose

This is a repeatable regression checklist, not a one-time audit report. It separates automated accessibility assertions from functional tests that happen to exercise accessibility-related behavior, and from checks that require a real browser or assistive technology.

Automated tests cover selected DOM and interaction contracts. They do not prove WCAG conformance.

## Evidence levels

Use these labels consistently:

- **Dedicated accessibility regression**: assertions explicitly target accessible names, label/control relationships, keyboard traversal/activation, focus behavior, semantic announcements, or accessibility states.
- **Functional test with accessibility-relevant behavior**: the test primarily verifies product behavior but also asserts a useful accessibility contract (for example, a validation test that checks focus reaches the invalid field).
- **Manual verification**: requires real browser rendering, visual inspection, or a screen reader. No result is recorded as passed until performed and evidenced.

A component having a label or using Radix is not, by itself, evidence that the complete flow has been tested.

## Route / interaction coverage

| Surface | Route(s) | Critical interactions | Dedicated accessibility regression | Functional test with accessibility-relevant assertions | Manual verification |
| --- | --- | --- | --- | --- | --- |
| Landing / global navigation | `/` | desktop navigation, theme toggle, report entry point | Navbar landmark/name, Tab order, active-state non-colour cue, focus-ring safeguards | route-link coverage, theme toggle behavior | real-browser keyboard and contrast checks |
| Explore | `/explore` | search, filters, pagination, map, Search this area | search/filter landmark and label associations; invalid-query alert and invalid state | map loader label/bounds and Search this area URL behavior | sticky map, live map interaction, responsive keyboard and screen reader |
| Issue detail | `/explore/[issueId]` | map, copy ID, issue actions, comments, recommendations | copy control name/status where explicitly asserted | issue action/comment flows, form validation/focus | map controls/markers/popups, keyboard flow, map + sticky Navbar |
| Learn | `/learn`, `/learn/[knowledgeId]` | article links, pagination, workflow/review actions | selected focus/announcement assertions in targeted tests; not a route-wide audit | knowledge loading/error/submit/review behavior | full keyboard path and screen-reader status changes |
| Act | `/act`, `/act/[projectId]` | project links, creation flow, pagination | selected form label/focus assertions in dedicated component tests | project creation, validation and status behavior | full keyboard path and responsive focus visibility |
| Community | `/community`, `/community/discussions/[discussionId]`, `/community/discussions/new` | activity filters, discussion links, composer | comment composer label/error/focus assertions | discussion create/reply and comment persistence | keyboard composer flow and screen-reader announcements |
| Authentication: login | `/auth/login` | labelled fields, keyboard submit, pending, auth error | **Dedicated**: label association, Tab order, Enter submit, pending disabled state/value retention, alert announcement | N/A | screen-reader announcement and browser-level focus behavior |
| Authentication: registration | `/auth/register` | three fields, keyboard order, required/email/password validation | **Dedicated**: label association, Tab order, validation alert | N/A | screen-reader announcement and browser-level focus behavior |
| Protected dashboard | `/dashboard` | auth boundary, dashboard loading/error/retry states | status/alert semantics covered at component level where asserted | dashboard data/loading/error behavior | authenticated keyboard and screen-reader pass |
| Protected contribution | `/learn/new`, `/act/new` (where enabled) | authoring forms, validation, submit/pending | selected field labels/focus/announcement assertions in form tests | create/update workflow behavior | full keyboard and screen-reader pass |
| Expert application | implemented Expert application route(s) | application form, conditional fields, submit, review status | selected label/checkbox/focus/announcement assertions in component tests | application validation/submission | keyboard flow through conditional form and screen-reader results |
| Expert review queue | implemented Expert review route(s) | queue navigation, decisions, reload/focus transition | selected focus/status assertions in queue tests | decision and reload behavior | keyboard operation and screen-reader announcement of decision/outcome |
| Admin application queue | implemented Admin application route(s) | queue navigation, inspect and act on application | **Pending route/test inventory** | **Pending route/test inventory** | **Pending route/test inventory** |

Protected Expert/Admin route locations and route names still need to be confirmed against the active App Router tree. The rows distinguish their interaction patterns; they do not claim that every role route is currently enabled or audited. Protected contribution examples are similarly conditional on the routes actually present.

## Automated regression contracts

### Accessible names and labels

- Prefer Testing Library role/name and label queries over implementation selectors.
- Every form control must retain an accessible name.
- Visible labels must remain programmatically associated with their controls.
- Icon-only controls must retain an explicit accessible name.

**Dedicated accessibility regression**
- `src/components/auth/login-form.test.tsx`
- `src/components/auth/register-form.test.tsx`
- `src/components/issues/issue-discovery-filters.test.tsx`
- `src/components/layout/navbar.test.tsx`
- `src/components/layout/mobile-nav.test.tsx`

**Functional tests with accessibility-relevant assertions**
- `src/components/issues/issue-report-form.test.tsx`
- `src/components/comments/comment-composer.test.tsx`
- project and knowledge authoring form tests

### Keyboard reachability and focus

- Interactive controls must be reachable with Tab.
- Forms must submit from the keyboard, not only via pointer activation.
- Dialog opening must move focus into the dialog.
- Dialog dismissal with Escape must restore focus to the trigger.
- Existing focus rings must not be neutralised by local `outline-none` / `ring-0` overrides.
- Validation failures that implement focus recovery must keep moving focus to the first actionable invalid field.
- Pending actions must expose disabled/busy state and preserve entered data.

**Dedicated accessibility regression**
- `src/components/auth/login-form.test.tsx`
- `src/components/auth/register-form.test.tsx`
- `src/components/layout/navbar.test.tsx`
- `src/components/layout/mobile-nav.test.tsx`

**Functional tests with accessibility-relevant assertions**
- `src/components/comments/comment-composer.test.tsx`
- `src/components/issues/issue-report-form.test.tsx`
- project/knowledge form tests, where focus recovery is explicitly asserted

### Error and status announcements

- Recoverable errors use `role="alert"` where immediate announcement is required.
- Non-error asynchronous/result state uses `role="status"` where appropriate.
- Inputs with field errors expose `aria-invalid` and an appropriate `aria-describedby` relationship.
- Pending forms expose disabled/busy state without losing the user's entered data.

**Dedicated accessibility regression**
- Login and Register form tests assert alerts for validation/auth errors.
- Explore filter tests assert alert semantics and invalid input state.

**Functional tests with accessibility-relevant assertions**
- Issue report, comment composer and route error tests assert alert/status semantics or focus recovery as part of product flow tests.

### Dialogs

**Functional tests with accessibility-relevant assertions**
- `src/components/layout/mobile-nav.test.tsx` explicitly verifies named dialog semantics, focus containment, Escape dismissal, and focus restoration.
- ReportIssueButton tests exercise the dialog's form/auth behavior. They do not independently prove all dialog accessibility semantics.

## Manual verification checklist

### Contrast: not yet performed

Record real rendered results for both light and dark themes. Do not mark a row passed based on token names or source-code colour declarations alone.

| Element | Light theme result | Dark theme result | Status / evidence |
| --- | --- | --- | --- |
| Primary text | Not measured | Not measured | Pending browser measurement |
| Muted text | Not measured | Not measured | Pending browser measurement |
| Destructive/error text and surfaces | Not measured | Not measured | Pending browser measurement |
| Focus indicators | Not measured | Not measured | Pending browser measurement |
| Active navigation indicator | Not measured | Not measured | Pending browser measurement |

### Map, dialog and responsive checks

Leaflet is not considered fully keyboard/screen-reader verified by unit tests alone.

| Check | Status | Evidence / next action |
| --- | --- | --- |
| Mobile navigation keyboard flow | Automated dedicated assertions exist | Manual screen-reader pass still required |
| Mobile navigation dialog focus/dismissal | Automated functional/accessibility assertions exist | Manual screen-reader pass still required |
| Issue map keyboard controls | Not performed | Verify in a real browser |
| Issue map marker/popup keyboard flow | Not performed | Verify in a real browser |
| Explore sticky map + Search this area | Not performed | Verify in a real browser |
| Issue detail map + sticky Navbar | Not performed | Verify in a real browser |
| Desktop + mobile responsive keyboard pass | Not performed | Verify in real browser at both viewport sizes |
| Screen-reader announcements for map/dialog flows | Not performed | Verify with a real screen reader |
| Light/dark contrast sample above | Not performed | Measure rendered colours and focus indicators in both themes |

For map verification:
- Tab reaches map controls and marker surfaces when exposed by Leaflet/browser.
- Zoom controls work without a pointer.
- Marker focus and popup behavior are understandable to keyboard and screen-reader users.
- Popup links have usable accessible names and can be activated by keyboard.
- Explore's sticky map does not trap focus or obscure the global navigation.
- Search this area remains reachable and understandable after viewport changes.

For dialogs:
- Trigger opens the dialog and focus enters it.
- Tab/Shift+Tab remain contained while open.
- Escape and the close control dismiss it.
- Focus returns to the trigger.
- Screen reader announces the dialog name and relevant content.

## Defect handling

1. Fix a concrete, local, behavior-preserving defect within #130.
2. File a separate issue for broad redesign, shared semantics across unrelated surfaces, or domain behavior changes.
3. Do not add a heavyweight scanner without a concrete coverage gap that cannot be covered by the existing toolchain.

## Final gate

Before closing #130:

- [ ] focused accessibility regression tests pass
- [ ] frontend test suite passes
- [ ] lint passes
- [ ] typecheck passes
- [ ] production build passes
- [ ] manual keyboard checks recorded with actual results
- [ ] screen-reader checks recorded with actual results
- [ ] light/dark contrast checks recorded with actual measurements
- [ ] protected Expert/Admin route inventory confirmed
- [ ] critical defects fixed or split into dedicated issues
