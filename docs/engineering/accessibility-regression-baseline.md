# AquaVeda accessibility regression baseline

Issue #130 establishes a repeatable accessibility and interaction regression baseline for implemented frontend surfaces. This document is the coverage record and is intentionally narrower than a WCAG conformance claim.

## Automated coverage

| Surface / interaction | Regression coverage | Status |
| --- | --- | --- |
| Primary form labels | \`IssueReportForm\` visible-label association | Covered |
| Validation feedback | \`IssueReportForm\` \`aria-invalid\` + \`aria-describedby\` | Covered |
| Keyboard reachability | \`IssueReportForm\` submit action | Covered |
| Error announcement | \`AuthError\` + \`LoadError\` \`role="alert"\` | Covered |
| Retry interaction | \`LoadError\` keyboard activation | Covered |
| Mobile navigation dialog | Existing \`mobile-nav.test.tsx\` covers accessible name, focus containment, Escape dismissal, focus return, and touch targets | Covered |
| Explore search/filter controls | Existing \`page.test.tsx\` covers named controls and URL-driven interaction | Covered |
| Location search | Existing component contract exposes label, error description, live results, and alert state | Existing coverage; targeted regression test to be expanded if a defect is found |
| Theme / forced-colors focus | Global \`:focus-visible\` and forced-colors fallback are implemented in \`globals.css\` | Existing implementation; manual verification required |
| Map controls | Leaflet/browser interaction | Manual only |
| Screen-reader reading order and announcements | Browser + assistive technology behavior | Manual only |

## Manual verification record

The following checks must be run in a real browser before #130 is closed. Component tests cannot establish actual assistive-technology behavior.

### Keyboard-only

- [ ] \`/explore\`: reach search, category, severity, status, pagination, map controls, and issue links without a pointer.
- [ ] \`/explore/[issueId]\`: reach contribution/report controls and comments without a pointer.
- [ ] \`/learn\` and \`/learn/[knowledgeId]\`: reach filters, article navigation, discussion/comment controls, and authenticated contribution controls.
- [ ] \`/community\`: reach feed filters, discussion links, pagination, and authenticated actions.
- [ ] \`/community/discussions/[discussionId]\`: reach comment/reply controls and navigation.
- [ ] \`/community/discussions/new\`: reach all fields and submission controls.
- [ ] \`/act\` and \`/act/[projectId]\`: reach project creation/details and contribution controls.
- [ ] \`/dashboard\`: reach all interactive dashboard actions.
- [ ] \`/dashboard/attention\`: reach queue controls and issue links.
- [ ] \`/learn/expert-application\`, \`/learn/review\`, \`/admin/expert-applications\`: reach all role-specific actions.
- [ ] \`/auth/login\` and \`/auth/register\`: reach fields, submit controls, and recovery/navigation links.

### Dialog / focus

- [ ] Open the mobile navigation with keyboard.
- [ ] Verify focus enters the dialog, remains contained while tabbing, and returns to the trigger after Escape/close.
- [ ] Verify Escape and overlay dismissal work without trapping focus.
- [ ] Verify the dialog has an accessible name.

### Map

- [ ] Explore map controls can be reached and operated with keyboard.
- [ ] Map control labels are announced meaningfully by the browser/screen reader.
- [ ] Selecting/searching an area does not strand focus or hide the resulting state from assistive technology.

### Screen reader

- [ ] Page landmarks and primary headings are announced in a sensible order.
- [ ] Loading states are announced where the UI uses \`role="status"\` / \`aria-busy\`.
- [ ] Errors are announced through \`role="alert"\` without requiring the user to discover them visually.
- [ ] Dialog open/close state and focus movement are understandable.
- [ ] Status badges and workflow states do not rely on color alone.

## Known scope boundaries

- This baseline does not claim WCAG conformance.
- Automated DOM assertions do not prove visual contrast compliance, usable screen-reader copy, map accessibility, or complete keyboard usability.
- Navigation-specific hardening remains tracked separately in #2.
- Broad visual or interaction redesigns discovered during this audit should become separate issues rather than being absorbed into #130.

## Closeout gate

#130 is complete only when:

1. The automated regression suite passes.
2. The manual keyboard/dialog/map/screen-reader checklist above has been executed and recorded.
3. Critical defects are fixed in #130 or split into dedicated issues with reproduction steps.
4. Frontend tests, lint, typecheck, and build pass.
