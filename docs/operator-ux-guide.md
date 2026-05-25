# Engineering Console operator UX guide

Operator-facing guide for the UX-1, UX-2, UX-3, UX-4, UX-5, UX-6, UX-7, UX-8, and UX-9 workflow updates. Pair with [operator-runbook.md](./operator-runbook.md), [operator-glossary.md](./operator-glossary.md), and [operator-ux-audit.md](./operator-ux-audit.md) for the broader redesign backlog.

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

UX-1 through UX-9 did **not** remove technical detail from the run page.

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

UX-1 through UX-9 now cover orientation, worker-plan authoring, mismatch visibility, approval discoverability, release retry clarity, run-page density, setup onboarding, terminology clarity, repeat-operator navigation speed, and dashboard-level queue triage, but they do **not** yet solve:

- saved queue presets or team-specific queue views
- explicit stale-run escalation and team handoff workflows across operators

Those remain in the next phases documented in [operator-ux-audit.md](./operator-ux-audit.md).
