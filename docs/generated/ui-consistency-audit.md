# VeraLux UI Consistency Audit

## Executive Summary
- Overall score: **79/100**
- Top 5 risks:
- High: Raw button usage is widespread without a shared Button primitive. (`src/components`)
- High: Repeated panel/card shells appear without a shared surface primitive. (`src/components`)
- High: Mixes light-surface assumptions into an engineer-facing dark UI surface. (`src/components/engineer-console/approval-actions.tsx`)
- High: Stacks many repeated card/panel shells in one file. (`src/components/engineer-console/create-task-form.tsx`)
- High: Uses `max-w-*` layout boxing on a major surface. (`src/components/engineer-console/engineer-route-shell.tsx`)
- Top 5 strengths:
- Premium immersive engineering chrome is centralized in 9 reusable canvas components.
- A shared status badge primitive exists for at least part of the state vocabulary.
- Operator help and glossary guidance are already documented and partially componentized.
- Keyboard focus styling appears in 15 scanned source files.
- The app already exposes a small global token palette through CSS variables in `globals.css`.
- Recommended next action: **Raw button usage is widespread without a shared Button primitive.**

## Scorecard
- Overall UI consistency score: **79/100**
- Engineering Console canvas consistency: **95/100**
- Route consistency: **74/100**
- Component reuse: **66/100**
- Accessibility polish: **95/100**
- Visual density risk: **19/100** (higher is worse)
- Legacy pattern risk: **86/100** (higher is worse)

## Route-Level Findings
| Route / Area | Status | Risk | Main issue | Recommended action |
| --- | --- | --- | --- | --- |
| /engineer | premium aligned | low | No high-signal drift detected by static audit heuristics. | Maintain current route styling and revisit only during the next intentional visual pass. |
| /engineer/repos | inconsistent | medium | Uses `max-w-*` layout boxing on a major surface. | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| /engineer/compatibility | inconsistent | medium | Uses `max-w-*` layout boxing on a major surface. | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| /engineer/tasks | inconsistent | high | Stacks many repeated card/panel shells in one file. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| /engineer/runs/:id | needs visual pass | high | Contains a large amount of visible copy for a first-screen or primary surface. | Check whether some explanation can move behind details-on-demand, help affordances, or deeper panels. |
| /engineer/login | premium aligned | low | Uses `max-w-*` layout boxing on a major surface. | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |

## Component-Level Findings
Showing the top 40 findings by severity and path.

| File | Finding | Severity | Evidence | Suggested fix |
| --- | --- | --- | --- | --- |
| src/components | Raw button usage is widespread without a shared Button primitive. | High | 40 component files include raw `<button>` elements. | Introduce a reusable button primitive or at least a smaller button style vocabulary before further visual polish spreads. |
| src/components | Repeated panel/card shells appear without a shared surface primitive. | High | 44 files repeat border/card shell patterns. | Create a shared surface/panel primitive or refactor repeated shells into fewer reusable wrappers. |
| src/components/engineer-console/approval-actions.tsx | Mixes light-surface assumptions into an engineer-facing dark UI surface. | High | text-black | Audit this surface for dark-theme token alignment before making larger visual changes elsewhere. |
| src/components/engineer-console/create-task-form.tsx | Stacks many repeated card/panel shells in one file. | High | 7 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/engineer-route-shell.tsx | Uses `max-w-*` layout boxing on a major surface. | High | max-w-6xl | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| src/components/engineer-console/engineer-route-shell.tsx | Uses centered `mx-auto` wrappers on a major UI surface. | High | Found `mx-auto` in a route-level or major shell component. | Review whether this surface should stay boxed or move toward a more intentional full-bleed/layout-shell pattern. |
| src/components/engineer-console/registered-repos-panel.tsx | Stacks many repeated card/panel shells in one file. | High | 8 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/review-stages-panel.tsx | Stacks many repeated card/panel shells in one file. | High | 9 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/run-live-panel.tsx | Contains a large amount of visible copy for a first-screen or primary surface. | High | 9 visible text blocks, about 291 words. | Check whether some explanation can move behind details-on-demand, help affordances, or deeper panels. |
| src/components/engineer-console/run-live-panel.tsx | Stacks many repeated card/panel shells in one file. | High | 10 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/run-workspace-shell.tsx | Stacks many repeated card/panel shells in one file. | High | 10 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/worker-plan-panel.tsx | Mixes light-surface assumptions into an engineer-facing dark UI surface. | High | text-black | Audit this surface for dark-theme token alignment before making larger visual changes elsewhere. |
| src/components/engineer-console/worker-plan-panel.tsx | Stacks many repeated card/panel shells in one file. | High | 7 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/app/page.tsx | Uses `max-w-*` layout boxing on a major surface. | Medium | max-w-2xl | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| src/app/page.tsx | Uses centered `mx-auto` wrappers on a major UI surface. | Medium | Found `mx-auto` in a route-level or major shell component. | Review whether this surface should stay boxed or move toward a more intentional full-bleed/layout-shell pattern. |
| src/components | No shared `src/components/ui` design-system layer was found. | Medium | Audit found bespoke feature components but no generic `components/ui` directory. | If shared primitives are becoming widespread, introduce them intentionally instead of continuing ad hoc feature-level styling. |
| src/components/engineer-console | Multiple overlay-like implementations increase drift risk across drawers, windows, and issue centers. | Medium | 7 overlay-like component files detected. | Keep converging overlay shells around shared window/drawer primitives rather than adding new bespoke wrappers. |
| src/components/engineer-console | Navigation chrome is implemented across several separate patterns. | Medium | 6 nav/chrome component files detected across route shell, menu, dock, top bar, toolbar, and quick nav. | Audit shared spacing, focus, chip, and active-state rules across nav patterns before more route-specific variants appear. |
| src/components/engineer-console/dashboard-issue-center.tsx | Uses hardcoded hex colors outside the global token palette. | Medium | #07101c | Prefer shared CSS variables or a smaller set of intentional surface tokens over per-file hex colors. |
| src/components/engineer-console/deployment-execution-panel.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/deployment-gates-panel.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/deployment-health-checks-panel.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
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
| src/components/engineer-console/run-live-panel.tsx | Reads like a checklist-heavy or explanation-heavy default surface. | Medium | 9 checklist/help-style phrases detected. | Review whether this first-view surface can be simplified or progressively disclosed. |
| src/components/engineer-console/setup-readiness-panel.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/setup-readiness-panel.tsx | Uses `max-w-*` layout boxing on a major surface. | Medium | max-w-3xl | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| src/components/engineer-console/staging-smoke-workflow-helper.tsx | Stacks many repeated card/panel shells in one file. | Medium | 5 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/components/engineer-console/workflow-node-inspector.tsx | Stacks many repeated card/panel shells in one file. | Medium | 4 repeated border/card shell patterns detected. | Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface. |
| src/app/(main)/engineer/login/page.tsx | Uses `max-w-*` layout boxing on a major surface. | Low | max-w-md | Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns. |
| src/app/(main)/engineer/login/page.tsx | Uses centered `mx-auto` wrappers on a major UI surface. | Low | Found `mx-auto` in a route-level or major shell component. | Review whether this surface should stay boxed or move toward a more intentional full-bleed/layout-shell pattern. |

## Design-System Drift
- Hardcoded colors: **3** findings across **14** files.
- One-off cards / panel shells: **44** files use repeated border/card shell patterns.
- Duplicate overlays: **7** overlay-like component files detected.
- Duplicate badges: **2** files repeat badge-like markup.
- Duplicate buttons: **40** files use raw button markup.
- Premium engineering-console components centralized: **9/9** expected immersive components found.

## Accessibility Findings
- `src/components/engineer-console/engineer-route-shell.tsx`: Interactive elements appear without explicit `focus-visible` styling. (4 button/link elements detected and no focus-visible utility found.)
- `src/components/engineer-console/engineer-task-list.tsx`: Interactive elements appear without explicit `focus-visible` styling. (5 button/link elements detected and no focus-visible utility found.)
- `src/components/engineer-console/operator-queue-panel.tsx`: Interactive elements appear without explicit `focus-visible` styling. (6 button/link elements detected and no focus-visible utility found.)

## Density Findings
- `src/components/engineer-console/create-task-form.tsx`: Stacks many repeated card/panel shells in one file. (7 repeated border/card shell patterns detected.)
- `src/components/engineer-console/engineer-route-shell.tsx`: Uses `max-w-*` layout boxing on a major surface. (max-w-6xl)
- `src/components/engineer-console/engineer-route-shell.tsx`: Uses centered `mx-auto` wrappers on a major UI surface. (Found `mx-auto` in a route-level or major shell component.)
- `src/components/engineer-console/registered-repos-panel.tsx`: Stacks many repeated card/panel shells in one file. (8 repeated border/card shell patterns detected.)
- `src/components/engineer-console/review-stages-panel.tsx`: Stacks many repeated card/panel shells in one file. (9 repeated border/card shell patterns detected.)
- `src/components/engineer-console/run-live-panel.tsx`: Contains a large amount of visible copy for a first-screen or primary surface. (9 visible text blocks, about 291 words.)
- `src/components/engineer-console/run-live-panel.tsx`: Stacks many repeated card/panel shells in one file. (10 repeated border/card shell patterns detected.)
- `src/components/engineer-console/run-workspace-shell.tsx`: Stacks many repeated card/panel shells in one file. (10 repeated border/card shell patterns detected.)

## Recommended Remediation Plan
### Phase 1
- Fix critical inconsistency
- Stacks many repeated card/panel shells in one file.
- Interactive elements appear without explicit `focus-visible` styling.

### Phase 2
- Migrate shared primitives
- Raw button usage is widespread without a shared Button primitive.
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

