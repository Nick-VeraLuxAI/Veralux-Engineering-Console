# VeraLux UI Consistency Audit

## Executive Summary
- Overall score: **92/100**
- Top 5 risks:
- Medium: Uses `max-w-*` layout boxing on a major surface. (`src/app/page.tsx`)
- Medium: Uses centered `mx-auto` wrappers on a major UI surface. (`src/app/page.tsx`)
- Medium: Multiple overlay-like implementations increase drift risk across drawers, windows, and issue centers. (`src/components/engineer-console`)
- Medium: Navigation chrome is implemented across several separate patterns. (`src/components/engineer-console`)
- Medium: Uses hardcoded hex colors outside the global token palette. (`src/components/engineer-console/dashboard-issue-center.tsx`)
- Top 5 strengths:
- Premium immersive engineering chrome is centralized in 9 reusable canvas components.
- A shared status badge primitive exists for at least part of the state vocabulary.
- Operator help and glossary guidance are already documented and partially componentized.
- Keyboard focus styling appears in 22 scanned source files.
- The app already exposes a small global token palette through CSS variables in `globals.css`.
- Recommended next action: **Uses `max-w-*` layout boxing on a major surface.**

## Scorecard
- Overall UI consistency score: **92/100**
- Engineering Console canvas consistency: **95/100**
- Route consistency: **95/100**
- Component reuse: **90/100**
- Accessibility polish: **98/100**
- Visual density risk: **11/100** (higher is worse)
- Legacy pattern risk: **45/100** (higher is worse)

## Route-Level Findings
| Route / Area | Status | Risk | Main issue | Recommended action |
| --- | --- | --- | --- | --- |
| /engineer | premium aligned | low | No high-signal drift detected by static audit heuristics. | Maintain current route styling and revisit only during the next intentional visual pass. |
| /engineer/repos | premium aligned | low | Uses larger page/card padding that may reinforce older high-density layouts. | Check whether this surface can use calmer spacing or progressive disclosure instead of large padded card stacks. |
| /engineer/compatibility | premium aligned | low | Uses larger page/card padding that may reinforce older high-density layouts. | Check whether this surface can use calmer spacing or progressive disclosure instead of large padded card stacks. |
| /engineer/tasks | premium aligned | low | Uses larger page/card padding that may reinforce older high-density layouts. | Check whether this surface can use calmer spacing or progressive disclosure instead of large padded card stacks. |
| /engineer/runs/:id | premium aligned | low | Uses `max-w-*` layout boxing on a major surface. | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| /engineer/login | premium aligned | low | Uses `max-w-*` layout boxing on a major surface. | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |

## Component-Level Findings
Showing the top 40 findings by severity and path.

| File | Finding | Severity | Evidence | Suggested fix |
| --- | --- | --- | --- | --- |
| src/app/page.tsx | Uses `max-w-*` layout boxing on a major surface. | Medium | max-w-2xl | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| src/app/page.tsx | Uses centered `mx-auto` wrappers on a major UI surface. | Medium | Found `mx-auto` in a route-level or major shell component. | Review whether this surface should stay boxed or move toward a more intentional full-bleed/layout-shell pattern. |
| src/components/engineer-console | Multiple overlay-like implementations increase drift risk across drawers, windows, and issue centers. | Medium | 7 overlay-like component files detected. | Keep converging overlay shells around shared window/drawer primitives rather than adding new bespoke wrappers. |
| src/components/engineer-console | Navigation chrome is implemented across several separate patterns. | Medium | 6 nav/chrome component files detected across route shell, menu, dock, top bar, toolbar, and quick nav. | Audit shared spacing, focus, chip, and active-state rules across nav patterns before more route-specific variants appear. |
| src/components/engineer-console/dashboard-issue-center.tsx | Uses hardcoded hex colors outside the global token palette. | Medium | #07101c | Prefer shared CSS variables or a smaller set of intentional surface tokens over per-file hex colors. |
| src/components/engineer-console/deployment-execution-panel.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/deployment-gates-panel.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/deployment-health-checks-panel.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/engineer-route-shell.tsx | Uses larger page/card padding that may reinforce older high-density layouts. | Medium | px-8, py-8 | Check whether this surface can use calmer spacing or progressive disclosure instead of large padded card stacks. |
| src/components/engineer-console/engineering-workflow-home.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/engineering-workflow-home.tsx | Uses `max-w-*` layout boxing on a major surface. | Medium | max-w-3xl | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| src/components/engineer-console/engineering-workflow-map.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/merge-controls-panel.tsx | Stacks many repeated card/panel shells in one file. | Medium | 5 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/pr-creation-panel.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/pr-creation-panel.tsx | Uses `max-w-*` layout boxing on a major surface. | Medium | max-w-3xl | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| src/components/engineer-console/release-checklist-panel.tsx | Reads like a checklist-heavy or explanation-heavy default surface. | Medium | 8 checklist/help-style phrases detected. | Review whether this first-view surface can be simplified or progressively disclosed. |
| src/components/engineer-console/release-signoff-panel.tsx | Reads like a checklist-heavy or explanation-heavy default surface. | Medium | 11 checklist/help-style phrases detected. | Review whether this first-view surface can be simplified or progressively disclosed. |
| src/components/engineer-console/run-approval-action-card.tsx | Stacks many repeated card/panel shells in one file. | Medium | 5 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/run-command-center.tsx | Stacks many repeated card/panel shells in one file. | Medium | 5 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/run-issue-center.tsx | Uses `max-w-*` layout boxing on a major surface. | Medium | max-w-sm | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| src/components/engineer-console/run-live-panel.tsx | Reads like a checklist-heavy or explanation-heavy default surface. | Medium | 10 checklist/help-style phrases detected. | Review whether this first-view surface can be simplified or progressively disclosed. |
| src/components/engineer-console/setup-readiness-panel.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/setup-readiness-panel.tsx | Uses `max-w-*` layout boxing on a major surface. | Medium | max-w-3xl | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| src/components/engineer-console/staging-smoke-workflow-helper.tsx | Stacks many repeated card/panel shells in one file. | Medium | 5 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/workflow-node-inspector.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/app/(main)/engineer/login/page.tsx | Uses `max-w-*` layout boxing on a major surface. | Low | max-w-md | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| src/app/(main)/engineer/login/page.tsx | Uses centered `mx-auto` wrappers on a major UI surface. | Low | Found `mx-auto` in a route-level or major shell component. | Review whether this surface should stay boxed or move toward a more intentional full-bleed/layout-shell pattern. |
| src/components/engineer-console/dashboard-issue-center.tsx | Repeats custom badge/status markup instead of reusing a shared primitive. | Low | 3 badge-like rounded pill patterns detected. | Consider routing repeated pill/status treatments through a smaller shared badge vocabulary. |
| src/components/engineer-console/operator-queue-panel.tsx | Interactive elements appear without explicit `focus-visible` styling. | Low | 6 button/link elements detected and no focus-visible utility found. | Add consistent keyboard focus treatment to interactive controls on this surface. |

## Design-System Drift
- Hardcoded colors: **1** findings across **14** files.
- One-off cards / panel shells: **34** files use repeated border/card shell patterns.
- Duplicate overlays: **7** overlay-like component files detected.
- Duplicate badges: **1** files repeat badge-like markup.
- Duplicate buttons: **30** files use raw button markup.
- Premium engineering-console components centralized: **9/9** expected immersive components found.

## Accessibility Findings
- `src/components/engineer-console/operator-queue-panel.tsx`: Interactive elements appear without explicit `focus-visible` styling. (6 button/link elements detected and no focus-visible utility found.)

## Density Findings
- `src/app/page.tsx`: Uses `max-w-*` layout boxing on a major surface. (max-w-2xl)
- `src/app/page.tsx`: Uses centered `mx-auto` wrappers on a major UI surface. (Found `mx-auto` in a route-level or major shell component.)
- `src/components/engineer-console/deployment-execution-panel.tsx`: Stacks many repeated card/panel shells in one file. (4 repeated border/card shell patterns detected.)
- `src/components/engineer-console/deployment-gates-panel.tsx`: Stacks many repeated card/panel shells in one file. (4 repeated border/card shell patterns detected.)
- `src/components/engineer-console/deployment-health-checks-panel.tsx`: Stacks many repeated card/panel shells in one file. (4 repeated border/card shell patterns detected.)
- `src/components/engineer-console/engineer-route-shell.tsx`: Uses larger page/card padding that may reinforce older high-density layouts. (px-8, py-8)
- `src/components/engineer-console/engineering-workflow-home.tsx`: Stacks many repeated card/panel shells in one file. (4 repeated border/card shell patterns detected.)
- `src/components/engineer-console/engineering-workflow-home.tsx`: Uses `max-w-*` layout boxing on a major surface. (max-w-3xl)

## Recommended Remediation Plan
### Phase 1
- Fix critical inconsistency
- Uses `max-w-*` layout boxing on a major surface.
- Interactive elements appear without explicit `focus-visible` styling.

### Phase 2
- Migrate shared primitives
- Multiple overlay-like implementations increase drift risk across drawers, windows, and issue centers.
- Establish a smaller surface/elevation vocabulary for dark glass, borders, radius, and shadows.

### Phase 3
- Route-by-route polish
- Apply the immersive design language intentionally across boxed engineer routes without weakening governance or density controls.
- Review route shells that still rely on `max-w-*`, `mx-auto`, or dense stacked cards.

### Phase 4
- Visual regression screenshots if needed
- Add optional screenshot-based route checks after the static audit has been triaged.
- Capture `/engineer`, repos, compatibility, task entry, and run workspace first-screen states only if the flows are stable.

## Do Not Change
- Governance rules and role checks
- Backend workflow authority
- Audit ledger logic
- Approval and release controls
- PR creation and release gates
- Any automation boundaries around run, PR, merge, deploy, or sign-off

