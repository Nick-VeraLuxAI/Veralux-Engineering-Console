# Engineering Console operator UX guide

Operator-facing guide for the UX-1 and UX-2 run page updates. Pair with [operator-runbook.md](./operator-runbook.md) for the full workflow and [operator-ux-audit.md](./operator-ux-audit.md) for the broader redesign backlog.

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

UX-1 and UX-2 did **not** remove technical detail from the run page.

The detailed panels still live below the command center and lifecycle stepper:

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

Use the top-of-page guidance to orient first, then open the specific panel you need.

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

## What did not change

- No governance rules were changed.
- Worker plans still require explicit human execution.
- Backend worker-plan validation still enforces `runId`, `allowedFiles`, protected-path rules, and allowed operation types.
- Approval, request-fix, and stop still remain human decisions.
- PR creation, merge, deployment, and sign-off are still manual and role-gated.
- Hard release gates still enforce the same backend checks.
- Technical detail remains available for audit and replay review.

---

## Current UX limits

UX-1 and UX-2 improve orientation, worker-plan authoring, and mismatch visibility, but they do **not** yet solve:

- approval control prominence
- PR retry state clarity
- advanced panel collapsing and progressive disclosure

Those remain in the next phases documented in [operator-ux-audit.md](./operator-ux-audit.md).
