# Engineering Console operator UX guide

Operator-facing orientation guide for the UX-1 run page update. Pair with [operator-runbook.md](./operator-runbook.md) for the full workflow and [operator-ux-audit.md](./operator-ux-audit.md) for the broader redesign backlog.

---

## What changed in UX-1

The run detail page now starts with two guidance surfaces:

1. **Run Command Center**  
   Summarizes the current lifecycle stage, next recommended action, blockers, warnings, and safe follow-up actions.

2. **Lifecycle stepper**  
   Shows the full workflow order from task through sign-off and links to the relevant panel or page section.

The existing technical panels still remain on the page below these summaries.

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

UX-1 did **not** remove technical detail from the run page.

The detailed panels still live below the command center and lifecycle stepper:

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

## What did not change

- No governance rules were changed.
- Worker plans still require explicit human execution.
- Approval, request-fix, and stop still remain human decisions.
- PR creation, merge, deployment, and sign-off are still manual and role-gated.
- Hard release gates still enforce the same backend checks.
- Technical detail remains available for audit and replay review.

---

## Current UX-1 limits

UX-1 improves orientation and workflow clarity, but it does **not** yet solve:

- raw worker-plan JSON ergonomics
- intent mismatch between task and worker plan
- approval control prominence
- PR retry state clarity
- advanced panel collapsing and progressive disclosure

Those remain in the next phases documented in [operator-ux-audit.md](./operator-ux-audit.md).
