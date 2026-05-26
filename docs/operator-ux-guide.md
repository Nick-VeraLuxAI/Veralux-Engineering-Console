# Engineering Console operator UX guide

Operator-facing guide for the UX-1 through UX-18 workflow updates. Pair with [operator-runbook.md](./operator-runbook.md), [operator-glossary.md](./operator-glossary.md), [operator-ux-audit.md](./operator-ux-audit.md), and [intelligence-layer-audit.md](./intelligence-layer-audit.md) for the broader autonomy-readiness and redesign backlog.

---

## What changed in A1

The run detail page now includes a read-only **Run Intelligence** card near the top of the workspace.

It summarizes:

1. **Risk level**
   Deterministic low/medium/high/critical classification from changed files and normalized danger points.

2. **Confidence**
   Deterministic confidence in the current read-only interpretation, based on tests, replay, policy, review, and release signals.

3. **Escalation**
   Plain-English guidance for whether the run looks routine, needs operator review, requires review stages, needs senior approval, or is effectively blocked.

4. **Suggested playbooks**
   Read-only recommendations for future recovery automation such as branch checkout, commit reuse, existing PR reuse, re-indexing, replay refresh, and policy refresh.

This card is advisory only. It does **not** approve, create PRs, merge, deploy, sign off, or bypass any existing gate. See [intelligence-layer-guide.md](./intelligence-layer-guide.md) for the A1 behavior and future A2/A3 path.

---

## What changed in UX-1

The run detail page now starts with two guidance surfaces:

1. **Run Command Center**
   Summarizes the current lifecycle stage, next recommended action, blockers, warnings, and safe follow-up actions.

2. **Lifecycle stepper**
   Shows the full workflow order from task through sign-off and links to the relevant panel or page section.

The existing technical panels still remain on the page below these summaries.

---

## What changed in UX-2

The worker-plan area now starts with a safer default workflow:

1. **Guided worker-plan builder**
   Operators can build a common worker plan with summary, operation type, path, reason, and content fields without manually typing `runId` or raw JSON.

2. **Plan intent preview**
   The page now shows the task title/description beside a plain-English summary of what the current plan will create, update, or append.

3. **Advanced JSON mode**
   Raw JSON still exists for advanced use, but it is no longer the default mental model. The editor now shows parse status, runId guidance, and visible warnings for shell-wrapper text or placeholder values.

4. **Model draft comparison**
   When a model-generated draft exists, the UI now shows the task and draft side by side and warns when the draft appears mismatched.

5. **README smoke helper**
   In staging/test/dev-like contexts, or when the task clearly looks like a README smoke task, the worker-plan area exposes a one-click README smoke plan template for safe staging verification.

---

## What changed in UX-3

The approval and review flow now starts with a clearer operator decision layer:

1. **Approval action card**
   A dedicated card now appears near the top of the run page when approval or review guidance matters. It shows the current approval state, whether final approval is available, blocking reasons, the next required action, and visible buttons for **Approve run**, **Request Fix**, and **Stop Run** when relevant.

2. **Visible rationale rules**
   The approval controls now explain rationale requirements before the operator clicks. The UI distinguishes optional approval rationale from required rationale, and it keeps required rationale visible for **Request Fix** and **Stop Run**.

3. **Review-stage guidance**
   The **Review stages** panel now summarizes required, pending, approved, rejected, and skipped counts, explains why review is required, and tells the operator that required review stages must be completed before final approval.

4. **Policy-to-review connection**
   When policy status is `requires_review`, the policy panel and the approval card now point operators directly to the **Review stages** panel instead of making them infer the next step.

5. **Approval-language cleanup**
   Operator-facing copy now uses plain-English phrases like "Senior review required before approval" and "Approval is blocked until these items are complete" while preserving the underlying raw statuses in the technical panels and APIs.

---

## What changed in UX-4

The release flow now explains PR retry and later-stage blockers in plain English:

1. **PR state card**
   The **PR creation** panel now starts with a dedicated **PR state** card that shows readiness status, commit state, branch state, PR state, and one next action. This makes it clear whether the console will create a new commit, reuse an existing commit, skip a redundant push, or require manual recovery.

2. **Retry guidance**
   When a PR attempt fails partway through, the panel now explains the last failed step, what already succeeded, what retry will do next, and whether duplicate commit creation is prevented.

   Follow-up reconciliation note: when the console can detect a reusable run commit from current readiness, that resumable state now wins over stale failed-request history. Previous failures still appear as context, but the card now treats them as history only and shows the current canonical retry state instead.

3. **Existing PR visibility**
   When a PR is already recorded for the run branch, the panel now shows the PR URL and number near the top of the panel instead of leaving that information buried in history.

4. **Hard release gate checklist**
   The hard release gate banner now converts blocker text into an ordered checklist with plain-English reasons and links such as **Go to Replay verification**, **Go to Policy results**, and **Go to Release checklist**.

5. **Command-center blocker routing**
   The **Run Command Center** now points to PR retry paths and the first actionable release blocker instead of leaving operators to infer which release panel to open next.

### PR retry recovery — PASS

The Engineering Console successfully resumed PR creation after partial failure. It reused the existing run commit, recognized the remote branch was already pushed, skipped duplicate commit/push work, and detected/recorded the existing draft PR.

Previous failure history remains visible for audit context, but the current PR state now correctly shows the recovered state.

Status: PASS after PR retry recovery and GitHub argument validation fixes.

---

## What changed in UX-5

The run page now uses progressive disclosure so operators can focus on the current step without losing access to the technical record:

1. **Current Action zone**
   A compact card now sits near the top of the page and restates the most relevant active step, why it matters, the next action, and the top blockers or warnings.

2. **Section groups**
   The long run page is now organized into **Active Work**, **Governance & Review**, **PR & Release**, and **Technical Audit** groups. Each group explains what it is, why it matters, the current state, and what the operator should do next.

3. **Deterministic expansion rules**
   The group that matches the current lifecycle step opens by default. Release panels open when PR/release work is active. Technical audit stays collapsed by default unless audit-chain verification needs attention.

4. **Technical detail remains available**
   UX-5 does not remove panels or hide technical detail permanently. It only changes the presentation order and default expansion behavior.

---

## What changed in UX-6

UX-6 improves setup guidance, staging onboarding, and first-run empty states without changing execution authority:

1. **Setup readiness panel**
   The dashboard now shows a read-only **Setup readiness** panel for auth mode, trusted-local state, release gates, audit scope, approved repo roots, backup alert mode, registered repos, repo verification, indexing, and compatibility analysis. It uses safe config and DB state only and never shows secrets.

2. **Staging smoke workflow helper**
   In staging-like, development, or trusted-local contexts, the dashboard now shows a **Run staging smoke workflow** helper that explains the safe order for registering a smoke repo, indexing, compatibility analysis, creating a README smoke task, starting a run, using the README worker-plan helper, and recording the staging result.

3. **Repo registration guidance**
   The **Registered repositories** page now explains approved repo roots, shows example staging paths, tells the operator whether the typed path is inside an allowed root, and makes the verify → file index → code index → compatibility order explicit.

4. **First-task preset**
   The task form now exposes a staging-only **README smoke** preset in non-production-like contexts. It fills a small, safe task title and description without auto-creating a task or auto-starting a run.

5. **Clearer empty states**
   Dashboard, repo, compatibility, and task-run empty states now answer what is missing, why it matters, and what to click next.

---

## What changed in UX-7

UX-7 improves terminology clarity without removing technical detail or changing any governance behavior:

1. **Central operator glossary**
   Key terms like **evidence bundle**, **replay verification**, **PR readiness**, **release gates**, **audit chain**, **file index**, and **code index** now have one shared glossary source.

2. **Inline help disclosures**
   The UI now adds lightweight “What is this?” disclosures to the highest-friction panels, including setup readiness, file index, code index, compatibility analysis, evidence bundle, replay verification, policy results, review stages, PR creation, release checklist, release sign-off, hard release gates, deployment health policy, and audit timeline.

3. **Plain-English panel copy**
   Missing-state and action copy now tells operators what the section means, why it matters, and what to do next without hiding the raw technical statuses.

4. **Technical detail still remains available**
   UX-7 does not replace or rename backend statuses. Raw readiness, gate, policy, and audit details still appear in advanced or technical sections.

5. **Docs glossary added**
   [operator-glossary.md](./operator-glossary.md) now gives operators a single reference for common run, governance, PR, and release terms.

---

## What changed in UX-8

UX-8 improves repeat-operator speed without adding any automatic execution:

1. **Sticky quick navigation**
   The run page now includes a sticky **Quick navigation** bar with anchor links for Current action, Worker plan, Approval, Evidence, Replay, Policy, Reviews, PR, Merge, Deploy, Checklist, Sign-off, and Audit.

2. **Expert summary strip**
   A compact read-only **Expert summary** strip now shows the current run, stage, risk, gate, governance, PR, release-gate, and sign-off statuses in one glance.

3. **Safe keyboard shortcuts**
   Navigation-only shortcuts now exist for common expert jumps:
   - `g w` worker plan
   - `g a` approval
   - `g p` PR creation
   - `g r` review stages
   - `g e` evidence
   - `g t` technical audit

4. **Expand-on-anchor behavior**
   Quick-nav links, lifecycle links, blocker links, and shortcut jumps now expand the relevant section group before scrolling so the target panel is actually visible.

5. **Technical-detail jump links**
   Panels such as PR creation, replay verification, evidence bundle, hard release gates, and audit timeline now include compact links into the relevant technical-detail sections.

---

## What changed in UX-9

UX-9 improves multi-run triage on the dashboard without adding any automatic execution:

1. **Operator Queue**
   The dashboard now includes a read-only **Operator Queue** that groups the latest task or run into **Needs operator action**, **Blocked / failed**, **Ready for approval**, **Ready for PR / release**, **Recently completed**, and **Staging checklist / setup attention** buckets.

2. **Deterministic queue priority**
   Failed runs, audit-chain failures, hard-gate blockers, and approval blockers now sort above lower-risk work. Completed runs stay lower priority.

3. **Read-only dashboard filters**
   Operators can filter the queue to **All**, **Needs action**, **Blocked**, **Approval**, **PR / Release**, or **Completed** without triggering any mutations.

4. **Latest run state on task and run lists**
   Dashboard task cards and task-detail run rows now show the latest lifecycle stage, next action, blocker/warning counts, last updated time, and direct **Open run** links.

5. **Staging checklist attention cues**
   Setup and staging items such as compatibility gaps, manual `verify:ci` tracking, backup verification tracking, and the `docs/staging-dry-run-report.md` record path now appear in the queue when relevant.

---

## What changed in UX-10

UX-10 improves repeat triage and operator handoff without adding any workflow automation:

1. **Saved queue presets**
   The dashboard queue now supports named read-only presets for **My next actions**, **Blocked / failed**, **Approval queue**, **PR / release queue**, **Stale runs**, **Recently completed**, and **Staging setup**, plus **All** as the safe fallback view.

2. **URL-backed queue views**
   Queue selection now syncs to `?queue=` query params such as `?queue=blocked`, `?queue=approval`, `?queue=release`, or `?queue=stale`. Unknown values fall back safely to **All**. When no query param is present, the browser may remember the last selected preset locally.

3. **Advisory stale-run detection**
   The queue now flags stale approval, release follow-up, failed-run, planning, and inactive-run states using existing timestamps only. These badges are advisory and do not block execution, approval, PR, merge, deployment, or sign-off actions.

4. **Handoff-friendly copy**
   Queue items now spell out what happened, why it matters, the next action, and takeover guidance such as reviewing **Current Action** and **Technical Audit** before continuing someone else’s run.

5. **Compact / detailed queue modes**
   Operators can switch between the existing detailed queue view and a lighter compact summary mode. This is local UI state only and does not change server data or queue priority.

---

## What changed in UX-11

UX-11 converts the run detail page from one long panel stack into a focused **Run Workspace** without changing workflow authority:

1. **Run workspace tabs**
   The run page now opens inside six focused views: **Overview**, **Work Plan**, **Review**, **PR**, **Release**, and **Audit**. Only one workspace view is visually dominant at a time, but the underlying panels stay mounted so form state is preserved.

2. **Persistent top status bar**
   A sticky top bar now shows the task title, run status, current stage, blocker and warning counts, and the current recommended action. The bar can only navigate; it does not expose approval, PR, merge, deploy, or sign-off mutations.

3. **Issue Center overlay**
   A bottom-right **Issue Center** now derives active critical, warning, and info issues from the existing run summary. It is UI-only and read-only. Clicking an issue routes the operator to the relevant workspace view and panel.

4. **Deep-link routing**
   Panel links such as `#pr-creation`, `#review-stages`, `#release-signoff`, and `#audit-timeline` now open the correct workspace view before scrolling to the target panel.

5. **Focused technical layout**
   Existing panels still remain available, including audit history, release controls, policy detail, and technical diagnostics. UX-11 changes navigation and presentation order only; it does not remove detail or hide issues permanently.

---

## What changed in UX-12

UX-12 converts the dashboard from a dense checklist-style homepage into a canvas-first **Architecture Home** without adding automation:

1. **Canvas-first shell**
   The `/engineer` homepage now opens with a dark architecture canvas, a top application bar, top navigation tabs, and a compact bottom dock. The first viewport is intentionally map-first rather than card-first.

2. **Spatial workflow nodes**
   The canvas now places compact nodes for **Setup**, **Repository**, **Task**, **Run**, **Review**, **PR**, **Release**, and **Audit** into a connected workflow layout. Nodes show only concise state, status, and issue count, not long copy.

3. **Node inspector**
   Clicking a node now opens a concise right-side inspector that explains the current state, why it matters, the next action, and the safest page to open next. Node clicks never trigger runs, approvals, PRs, merges, deployments, or sign-off actions directly.

4. **Floating issue routing**
   A floating issue card now surfaces the highest-priority current problem directly on the canvas, while the smaller bottom-right **Issues** pill keeps the full routed issue list available.

5. **Dense details moved behind explicit views**
   The full **Setup readiness**, **Run staging smoke workflow**, **Operator Queue**, and **Task details** surfaces still exist, but they now open only through explicit detail links such as `?details=setup`, `?details=queue`, and `?details=tasks`.

6. **Compact alternate tabs**
   The top bar keeps **Architecture** as the default tab, while **Activity** and **Docs** expose focused secondary panels without restoring the old stacked dashboard layout.

---

## What changed in UX-13

UX-13 upgrades the homepage from a static visual map into an interactive **Workflow Canvas** without adding automation:

1. **Pan and zoom controls**
   Operators can now zoom in, zoom out, fit the canvas to view, and reset the viewport. Mouse-wheel and trackpad zoom apply only to the canvas layer, not the page.

2. **Draggable workflow nodes**
   Workflow nodes can now be repositioned locally for better inspection. Dragging a node updates the canvas only in the browser; it does not change any database record, task state, run state, or audit history.

3. **Status-aware relationship edges**
   Edges now reflect workflow tone derived from the existing node state model: ready/completed edges render green, active edges render blue, warnings render amber, blocked edges render red, and inactive edges stay muted.

4. **Textured spatial background**
   The canvas now includes a darker textured backdrop, layered dot grid, soft radial glows, and vignette treatment so the workflow reads more like a control-plane canvas than a positioned-card layout.

5. **Layout safety**
   The canvas keeps inspector, issue card, and dock overlays floating above the world layer while reserving fit-to-view space around them. All dragging, panning, zooming, and selection remain navigation-only and do not trigger workflow mutations.

---

## What changed in UX-14

UX-14 makes the immersive canvas the default `/engineer` experience without adding automation:

1. **Full-screen control-plane shell**
   The `/engineer` route no longer presents the canvas inside a centered page card or the normal engineer navigation shell. The immersive home now bypasses the old page wrapper entirely so the canvas fills the available viewport edge to edge.

2. **Overlay details instead of below-page sections**
   Dense surfaces such as **Setup readiness**, **Run staging smoke workflow**, **Operator Queue**, **Task details**, **Activity**, and **Docs** now open as overlay drawers on top of the canvas through routes such as `?details=setup`, `?details=staging`, `?details=queue`, `?details=tasks`, `?details=activity`, and `?details=docs`.

3. **Default immersive chrome**
   A compact floating menu pill replaces the old top navigation by default, while the top bar, canvas toolbar, floating issue card, right-side inspector, bottom dock, and bottom-right issues surface remain visible as lightweight app chrome around the active workflow map. No focus-mode click is required to reach the immersive view.

4. **Escape closes overlays, not the experience**
   Pressing `Escape` now closes an open detail drawer while keeping the operator inside the immersive canvas shell. It does not restore a dense checklist dashboard layout.

5. **Viewport fit accounts for overlays**
   Default fit/reset behavior now reserves more breathing room for the floating menu, top bar, inspector, dock, issue card, and issues surface so the graph remains readable inside the immersive shell.

6. **Safety unchanged**
   Opening drawers, selecting nodes, panning, zooming, dragging, and routing through issue overlays still do **not** create tasks, start runs, approve, create PRs, merge, deploy, sign off, or mutate any governed workflow state.

---

## What changed in UX-15

UX-15 adds desktop-style overlay management on top of the immersive canvas without adding automation:

1. **Window controls on floating overlays**
   The expanded **Issue Center**, **Node inspector**, **Priority issue** card, and detail drawers now expose clear close and minimize controls instead of relying on implicit collapse behavior.

2. **Minimized overlay bar**
   Minimized overlays now move into a bottom overlay bar where operators can restore or close them without reopening dense dashboard sections.

3. **Deterministic overlay stacking**
   Open overlays now track z-order explicitly so the clicked or restored surface comes to the front instead of hiding unpredictably behind another card or drawer.

4. **Movable canvas windows**
   The **Issue Center**, **Node inspector**, and **Priority issue** card can now be dragged locally by their title bars to uncover blocked nodes or other overlays. These positions reset safely on refresh.

5. **Escape and safety rules**
   `Escape` now closes the floating menu first, then the topmost overlay window, while all close, minimize, restore, drag, and focus behavior remains local UI state only. No workflow mutation, governance bypass, approval shortcut, PR automation, merge automation, deploy automation, or sign-off automation was added.

---

## What changed in UX-16

UX-16 adds chrome polish, camera focus behavior, and depth cues to the immersive canvas without adding automation:

1. **Centered command bar**
   The top canvas command bar is now centered across the viewport and tuned to avoid lateral scrolling on normal desktop widths. Primary tabs stay readable in one floating surface, while smaller screens can still fall back to responsive overflow.

2. **Vertical collapsible tool rail**
   Zoom, fit, reset, layout reset, and layout lock controls now live in a left-side vertical rail instead of a horizontal strip near the top. The rail can collapse into a slim chevron tab and expand again without changing any workflow state.

3. **Camera focus by intent**
   Choosing a workflow tab, clicking a dock item, or selecting a node now requests a deterministic local camera focus target. Architecture refits the whole map, Activity shifts toward the live run/review/audit region, and repository/task/run-style selections center the relevant node while keeping zoom stable where practical.

4. **Depth and relationship emphasis**
   Selected nodes now sit visually forward with stronger glow and shadow treatment, connected edges come forward, and unrelated edges recede. The background texture and grid also move more subtly with the camera so the canvas feels less flat.

5. **Safe-area and collision polish**
   Fit/reset calculations now account for the centered command bar, the left tool rail in both expanded and collapsed states, the right inspector, and the bottom dock/minimized bar. These remain local UI layout changes only.

6. **Motion stays subtle and local**
   Toolbar changes, command-bar tab changes, node selection, overlay refresh, and camera focus all use small transitions that respect reduced-motion preferences. No workflow automation, governance bypass, approval shortcut, PR automation, merge automation, deploy automation, or sign-off automation was added.

---

## What changed in UX-17

UX-17 finishes the canvas chrome simplification without adding automation:

1. **Single branded top-left control**
   The floating `VeraLux` menu pill is now the only branded surface in the top-left corner. The duplicate brand card was removed from the top bar so the menu no longer covers or competes with another brand block.

2. **Minimal top chrome**
   The top bar now acts as a compact context and status strip only: `Engineering Console / <current context>` plus environment, issue-count, and queue chips. It no longer mirrors the bottom dock as a second navigation system.

3. **Bottom dock is primary navigation**
   The bottom dock is now the main workflow navigator for `Workflows`, `Repos`, `Tasks`, `Runs`, `Reviews`, `Release`, `Activity`, and `Docs`. Dock clicks only focus nodes or open the existing read-only detail drawers.

4. **Docs added to the dock**
   `Docs` now lives beside the other dock destinations and opens the same docs drawer that already existed behind the routed detail view.

5. **Premium canvas-control edge tab**
   The left toolbar collapse control now renders as a slimmer edge-attached chevron tab instead of a raw text character button, preserving the same local-only collapse behavior with cleaner visual hierarchy.

6. **Spacing stays open**
   The top status strip, toolbar, dock, and floating menu now occupy more distinct visual lanes so the canvas reads as one spacious surface rather than a stack of competing chrome elements. All changes remain local UI/navigation only, with no workflow mutation, governance bypass, approval shortcut, PR automation, merge automation, deploy automation, or sign-off automation.

---

## What changed in UX-18

UX-18 adds Apple-inspired hierarchy, focal lighting, and calmer canvas depth without adding automation:

1. **Selected node becomes the focal point**
   The selected workflow node now wins the visual hierarchy by default. If no node is explicitly selected, the canvas falls back to the highest-priority routed issue node or the most relevant current workflow stage using existing derived state only.

2. **Dynamic focal lighting follows the target**
   The main radial glow now tracks the selected/current workflow node instead of sitting at a fixed decorative position. The canvas exposes local CSS focal-point variables and moves the glow softly unless the browser requests reduced motion.

3. **Camera and glow now agree**
   Initial load and explicit node focus place the target inside the reserved safe area, so the focal glow lands behind the same node the camera is framing. The right inspector reserve still keeps the selected node slightly left of center instead of hiding behind overlay chrome.

4. **Connected path comes forward**
   Connected edges and related nodes now receive the medium-emphasis layer while unrelated graph branches recede further. This keeps the operator’s eye on the current path instead of making the whole map feel equally loud.

5. **Chrome and overlays are quieter**
   The top status strip, bottom dock, toolbar, issue card, issues pill, overlay windows, and minimized bar now use softer borders, lower-opacity glass, smaller shadows, and calmer active states so they support the focal node instead of competing with it.

6. **Typography and motion stay restrained**
   Labels now use calmer tracking and less shouty microcopy, while node glow, path emphasis, and focal-field movement use short transitions only where they help orientation. All motion remains local UI only and respects reduced-motion preferences.

All UX-18 changes remain local UI/navigation only. No workflow mutation, governance bypass, approval shortcut, PR automation, merge automation, deploy automation, or sign-off automation was added.

---

## What the command center does

The command center is a **read-only orientation layer**. It helps operators answer:

- Where am I in the workflow?
- What should I do next?
- What is blocking me?
- What needs human review?

It does **not** execute worker plans, approve runs, create PRs, merge, deploy, or sign off automatically.

---

## What the lifecycle stepper means

Each step shows one of the following states:

- `not_started`: the run has not reached this step yet
- `ready`: the step is the next likely operator action
- `blocked`: something must be fixed before the step can proceed
- `warning`: the step is usable, but warnings should be reviewed
- `passed`: a verification-style step passed
- `complete`: the step was completed and recorded

Clicking a step jumps to the relevant panel or, for `Task`, back to the task detail page.

---

## Where technical details live

UX-1 through UX-11 did **not** remove technical detail from the run page.

The detailed panels now live inside workspace views:

- **Overview**: command center, lifecycle, quick navigation, expert summary, current action, run state, issue summary
- **Work Plan**: worker plan draft, worker plan, changed files, quality gates
- **Review**: approval actions, evidence bundle, decision history, replay verification, policy results, review stages, approval report
- **PR**: PR creation and PR state/history detail
- **Release**: merge controls, deployment gates, deployment execution, deployment health checks, deployment health policy, release checklist, release sign-off
- **Audit**: audit timeline, chain diagnostics, and technical verification detail

Use the workspace tabs or Issue Center first, then open the panel you need.

---

## Worker-plan guidance flow

The intended UX-2 worker-plan path is now:

1. Open the **Guided worker-plan builder**
2. Confirm the auto-filled current `runId` display
3. Add the file operations you want (`create_file`, `update_file`, `append_file`)
4. Review the **Preview JSON** section
5. Review the **Plan intent preview** and any warnings
6. Use **Advanced JSON** only if you need to manually edit the raw payload
7. Click **Validate and execute** manually

The README smoke helper is only a template shortcut. It does **not** execute automatically.

---

## Approval and review flow

The intended UX-3 approval path is now:

1. Check the **Approval actions** card near the top of the run page.
2. Read the current approval state and next required action.
3. If review is still pending, open **Review stages** and complete the required review stages first.
4. Read the rationale guidance before choosing **Approve run**, **Request Fix**, or **Stop Run**.
5. Use the detailed **Approval report** panel for diff/governance detail and the same auditable actions.

Decision guidance:

- **Approve run**: use when the run is ready and you want the lifecycle to continue toward PR creation.
- **Request Fix**: use when the run should go back for correction and the next operator needs a clear reason.
- **Stop Run**: use when this run should end without approval and the audit history should explain why.

---

## What did not change

- No governance rules were changed.
- Worker plans still require explicit human execution.
- Backend worker-plan validation still enforces `runId`, `allowedFiles`, protected-path rules, and allowed operation types.
- Approval, request-fix, and stop still remain human decisions.
- Required review stages still block final approval.
- Policy status `requires_review` still requires human rationale for final approval.
- PR creation, merge, deployment, and sign-off are still manual and role-gated.
- Hard release gates still enforce the same backend checks.
- The new PR retry guidance does not bypass readiness checks, auto-create PRs, or merge/deploy automatically.
- The run workspace tabs and Issue Center do not create mutations on navigation.
- Technical detail remains available for audit and replay review.

---

## Current UX limits

UX-1 through UX-18 now cover orientation, worker-plan authoring, mismatch visibility, approval discoverability, release retry clarity, run-page density, setup onboarding, terminology clarity, repeat-operator navigation speed, dashboard-level queue triage, saved queue presets, stale-run visibility, handoff guidance, focused run-workspace navigation, immersive canvas presentation, overlay window management, canvas chrome/camera/depth polish, minimal chrome cleanup, and focal hierarchy / calm-surface polish, but they do **not** yet solve:

- durable team-shared saved views beyond URL and local browser memory
- explicit assignment, SLA, or escalation workflow across operators

Those remain later phases documented in [operator-ux-audit.md](./operator-ux-audit.md).
