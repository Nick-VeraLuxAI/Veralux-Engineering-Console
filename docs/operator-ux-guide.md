# Engineering Console operator UX guide

Operator-facing guide for the UX-1, UX-2, UX-3, UX-4, and UX-5 run page updates. Pair with [operator-runbook.md](./operator-runbook.md) for the full workflow and [operator-ux-audit.md](./operator-ux-audit.md) for the broader redesign backlog.

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

UX-1 through UX-5 did **not** remove technical detail from the run page.

The detailed panels still live below the command center, lifecycle stepper, and current-action zone:

- worker plan draft
- worker plan
- changed files
- quality gates
- evidence bundle
- replay verification
- policy results
- review stages
- approval report
- PR creation
- merge controls
- deployment gates
- deployment execution
- deployment health checks
- deployment health policy
- release checklist
- release sign-off
- audit timeline

Use the top-of-page guidance to orient first, then open the section group and specific panel you need.

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
- Technical detail remains available for audit and replay review.

---

## Current UX limits

UX-1 through UX-5 improve orientation, worker-plan authoring, mismatch visibility, approval discoverability, release retry clarity, and run-page density, but they do **not** yet solve:

- staging-helper links and onboarding shortcuts across setup flows

Those remain in the next phases documented in [operator-ux-audit.md](./operator-ux-audit.md).
