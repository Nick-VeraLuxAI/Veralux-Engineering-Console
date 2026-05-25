# Engineering Console operator workflow UI/UX audit

**Audit:** UX-Audit-1  
**Date:** 2026-05-24  
**Scope:** operator workflow UI/UX only  
**Constraint:** audit-only phase; no governance, auth, validation, PR, release-gate, deployment, or backup behavior changes proposed here

---

## Executive summary

**Verdict:** The Engineering Console is **governed and technically capable**, but it is **not yet operator-grade** for low-guidance staging or production use.

**UX readiness score:** **58 / 100**

The current product surface successfully preserves safety boundaries, but the UI asks operators to understand backend concepts, infer workflow order, manually manage identifiers, and recover from failure states without enough in-product guidance. The staging dry run showed that a careful operator could complete the workflow, but only with external explanation and manual interpretation. That is acceptable for an internal admin tool, not for a production control plane.

The strongest UX liabilities are:

1. the run page is a long undifferentiated scroll with no command center or lifecycle hierarchy
2. worker-plan authoring depends on raw JSON and visible `runId` handling
3. approval, request-fix, and stop controls are easy to miss
4. release and retry states are technically accurate but not operationally legible
5. blockers are shown as diagnostic text instead of guided next actions

This audit recommends a **safety-preserving operator workflow redesign** that improves clarity, sequencing, validation, and recovery while keeping all current human gates intact.

---

## UX-1 implementation note

UX-1 is now implemented on the run detail page:

- **Run Command Center** now appears near the top of the run page
- **Lifecycle** stepper now shows workflow hierarchy and links to major panels
- stable panel anchors now support guided navigation without changing backend behavior

UX-1 improves orientation and next-action clarity, but it intentionally does **not** change worker-plan ergonomics, approval behavior, PR logic, release gates, or deployment rules. The remaining UX backlog still starts with **UX-2 — Worker-plan UX improvements**.

---

## Current operator journey

| Step | What the operator sees | What the operator does | Next action obvious? | Button easy to find? | Language understandable? | State clear? | Could do wrong thing? | Recovery guidance |
|---|---|---|---|---|---|---|---|---|
| 1. Register repo | Separate repositories page with registration form and registered repo cards | Enter repo name/path and submit | Medium | High | Medium | Medium | Medium: manual absolute path entry is error-prone | Medium: server error + verification message only |
| 2. Verify repo | Small action buttons on each repo card | Click **Verify** | Medium | Medium | Medium | Medium | Low | Low: failure text exists but no guided fix checklist |
| 3. Index files | Nested file index panel under each repo card | Click **Index files** | Medium | Medium | Medium | Medium | Low | Low: shows verify-first warning but limited recovery copy |
| 4. Index code | Nested code index panel under each repo card | Click **Index code** after file index | Medium | Medium | Medium | Medium | Low | Low: basic prerequisite warning only |
| 5. Run compatibility analysis | Separate compatibility page with summaries, links, and API surface tables | Click **Run compatibility analysis** | Medium | High | Medium-low: terms are technical | Medium | Low | Low: little explanation of how to use results |
| 6. Create task | Task list page with modal-based create form | Open modal, choose repo/manual path, enter description | Medium | High | Medium | Medium | Medium: manual path fallback and repo selection can be mixed conceptually | Low: errors are form-level only |
| 7. Start run | Task detail page with status badges and **Start run** button | Start run and open run detail page | High | High | High | Medium | Low | Low |
| 8. Generate/review worker plan | Run page places worker plan draft and worker plan panels far below release panels | Generate draft, review JSON, copy into manual editor | Low | Medium-low | Low: JSON-first and backend terminology dominate | Low | High: intent mismatch and raw wrapper text can be pasted | Low: validation errors exist, but no intent preview or mismatch guard |
| 9. Execute worker plan | Large raw JSON textarea and single execute button | Paste/edit JSON and execute | Low | Medium | Low | Medium | High: operator can submit malformed or wrong plan | Medium-low: validation and execution errors are technical, not guided |
| 10. Review changed files | Small changed-files list after worker-plan sections | Scan changed paths | Low | Medium | Medium | Low | Medium: no comparison between task intent and changed scope | Low |
| 11. Run quality gates | Inline command cards with stdout/stderr dumps | Review gate outputs | Medium | Medium | Medium-low: terminal output heavy | Medium | Medium: must infer severity and next step | Low-medium |
| 12. Generate evidence | Evidence bundle panel near top of long page | Regenerate/view bundle summary | Low | Medium | Medium-low: evidence jargon | Medium | Low | Low |
| 13. Verify replay | Replay panel with checks and package viewer | Run replay verification | Low | Medium | Low: replay terminology is not self-explanatory | Medium | Low | Low-medium |
| 14. Evaluate policy | Policy results panel with blockers/warnings/review required | Click **Evaluate policy** and interpret result | Medium | Medium | Medium-low: policy vocabulary is internal | Medium | Medium | Medium: has recommended action, but not linked to follow-up controls |
| 15. Generate/approve review stages | Review stages panel with generate/reconcile and per-stage actions | Generate, then approve/reject/skip each stage | Medium | Medium | Medium | Medium | Medium | Medium: rationale requirement exists, but little sequencing help |
| 16. Approve / request fix / stop | Approval controls only appear inside approval report and only at `waiting_for_approval` | Choose approve/request-fix/stop and optionally rationale | Low | Low | Medium | Medium-low | Medium-high: operators may not realize controls are available | Medium: rationale validation exists, visibility does not |
| 17. Create PR | PR creation panel with readiness, base branch, actor label, rationale, and history | Evaluate readiness, interpret blockers, create/retry PR | Medium-low | Medium | Medium-low: retry model is technical | Medium-low | Medium-high: retry semantics are hard to understand | Medium: hints exist but are easy to miss |
| 18. Merge | Merge controls panel with PR selection, readiness, hard gate banner, merge options | Evaluate merge readiness, merge PR | Medium-low | Medium | Medium | Medium | Medium | Medium: blockers listed but not tied to source panels |
| 19. Deployment approval | Deployment gates panel with environment selector, readiness, rationale, approval buttons | Evaluate readiness and record approval | Medium | Medium | Medium | Medium | Medium | Medium |
| 20. Deployment execution | Deployment execution panel with approval selector and profile selector | Select approved record/profile and execute | Medium | Medium | Medium | Medium | Medium | Medium |
| 21. Health check | Deployment health checks panel with execution/profile selection | Run health check | Medium | Medium | Medium | Medium | Low-medium | Medium |
| 22. Health policy | Separate policy interpretation panel | Evaluate health policy | Medium | Medium | Medium-low | Medium | Low | Medium |
| 23. Release checklist | Checklist summary plus item list | Evaluate checklist and interpret blockers | Medium-low | Medium | Medium | Medium-low | Medium | Low-medium: text describes problems but not where to fix them |
| 24. Release sign-off | Sign-off panel with radio options and rationale | Record sign-off decision | Medium | Medium | Medium | Medium | Medium: decision logic must be inferred from prior checklist state | Medium |

### Journey-level findings

- The operator can complete the full lifecycle, but the system does **not** make the lifecycle visually explicit.
- The run page is optimized for exhaustive visibility, not guided operation.
- Prerequisites are enforced in backend logic, but the UI often leaves the operator to discover them by trial and error.
- Recovery states exist, but they are presented as status text, blockers, and history records instead of actionable guidance.

---

## Top 10 UX problems

1. **No workflow hierarchy on the run page**
2. **Worker-plan execution depends on raw JSON editing**
3. **Visible `runId` handling leaks backend mechanics into operator flow**
4. **No clear comparison between task intent and worker-plan intent**
5. **Approve / Request Fix / Stop controls are hard to discover**
6. **PR retry and recovery state is difficult to understand**
7. **Hard release gate blockers are readable by engineers, not operators**
8. **No persistent “next recommended action” command center**
9. **Technical terminology exceeds operator context**
10. **Error and blocker states rarely tell the operator exactly where to go next**

---

## Severity-ranked issue table

| Title | Severity | Affected screen/component | Observed staging evidence | User confusion created | Operational risk | Recommended fix | Fix type | Safe without governance change? |
|---|---|---|---|---|---|---|---|---|
| Manual worker-plan JSON editing | Critical | `WorkerPlanPanel` on run page | Operator had to paste raw worker-plan JSON and accidentally included wrapper text | Operator must think like an API client instead of an operator | Wrong plan execution, failed validation, slower staging | Keep manual approval, but add template autofill, live validation, preview, and copy-safe formatting | Interaction-level + backend-assisted validation | Yes |
| Worker-plan intent mismatch is not obvious | Critical | Worker plan draft + worker plan + changed files | Operator executed wrong mock plan because UI did not compare task intent with plan intent | Operator cannot tell whether the plan meaningfully matches the task | Wrong file mutations despite valid JSON | Show plain-English plan summary, changed-path preview, and task-vs-plan intent comparison before execute | Interaction-level + backend-assisted | Yes |
| Run page lacks workflow hierarchy | High | `RunLivePanel` overall layout | Operator had to scroll through many panels and infer order manually | The operator does not know where they are in the lifecycle | Missed actions, delayed approvals, staging dependence on external coaching | Add command center, lifecycle stepper, and progressive disclosure | Visual-only + interaction-level | Yes |
| Approval controls are buried | High | Approval report / `ApprovalActions` | Approve / Request Fix / Stop were hard to discover | Operator may think the system is blocked with no available action | Delayed or incorrect decisions | Promote approval card near top when actionable; preserve current gates | Interaction-level | Yes |
| `runId` is exposed as an operator task | High | Worker-plan authoring flow | Operator had to ask where to find the run ID | Backend identifier becomes part of manual workflow | Copy/paste mistakes and avoidable friction | Hide `runId` from normal flow and auto-populate it in templates/previews | Interaction-level | Yes |
| PR retry / recovery state is opaque | High | PR creation panel | Staging exposed difficult retry/recovery interpretation | Operators cannot tell whether retry is safe, duplicate, or blocked | Duplicate attempts, support burden, misread failures | Add dedicated retry state card with plain-English state and one recommended next action | Interaction-level | Yes |
| Hard gate blockers read like red diagnostics | High | Hard release gate banner, checklist, merge, deploy, sign-off | Blockers appeared as walls of red text without a simple next action | Operators see reasons but not the route to resolution | Slow recovery, mistaken escalations | Convert blocker output to checklist format with links to relevant panels | Visual-only + interaction-level | Yes |
| No global next-action guidance | High | Entire run page | Staging required too much external guidance to complete | Operator must repeatedly infer the next valid step | High supervision requirement | Add one persistent “Next required action” card derived from current run state | Interaction-level + backend-assisted summary | Yes |
| Technical terminology is overly internal | Medium | Replay, policy, review stages, evidence, hard gates | Terms like replay verification and policy require explanation | Operators need onboarding to decode labels | Slower adoption, lower confidence | Add plain-English subtitles and short “why this matters” text per panel | Visual-only | Yes |
| Recovery guidance is too generic | Medium | Quality gates, policy, deployment, checklist, auth errors | Errors mostly say what failed, not exactly how to recover | Operator must search neighboring panels or docs | Longer incident handling, more chat support | Standardize recovery copy: “what happened / what to do now / where to go” | Interaction-level | Yes |
| Staging helper visibility is weak | Medium | Docs + in-product flow | Staging needed too much external guidance | Operators do not know where to look for guided dry run instructions | Demo inconsistency and training overhead | Add a staging helper entry point linking to runbook/dry-run checklist from relevant flows | Visual-only | Yes |
| Supporting setup flows feel tool-centric | Low | Repos, indexing, compatibility, task creation | Setup pages expose technical data but little process framing | Operators can use them, but with more thought than necessary | Lower approachability before first run | Add short step context and success criteria on setup screens | Visual-only | Yes |

---

## Information architecture recommendation

### Option A: Keep one page, add a Run Command Center at top

**Pros**

- Lowest implementation risk
- Preserves current panel composition and URLs
- Improves orientation quickly

**Cons**

- Does not solve long-scroll fatigue on its own
- Technical panels still compete visually with primary actions
- Operators still need to hunt through the page

### Option B: Stepper or tabs

Suggested grouping: `Plan` -> `Execute` -> `Verify` -> `Review` -> `Release` -> `Deploy` -> `Sign-off`

**Pros**

- Strong lifecycle clarity
- Easier to learn for first-time operators
- Supports progressive disclosure

**Cons**

- Harder to preserve “single source of truth” visibility for auditors
- Risks hiding relevant context across tabs
- Larger implementation and test surface

### Option C: Guided next-action workflow with expandable advanced panels

**Pros**

- Best operator focus
- Aligns UI with current safety model
- Encourages correct sequencing without automation

**Cons**

- Requires good state summarization logic
- Risk of feeling opaque if advanced context is too hidden
- Harder to support expert operators who want full-page scanning

### Option D: Hybrid command center + lifecycle stepper + collapsible technical panels

**Pros**

- Best balance of guidance and transparency
- Preserves all existing panels while making workflow order explicit
- Gives new operators a guided path and expert operators access to raw detail
- Fits current product architecture without changing backend behavior

**Cons**

- Moderate implementation effort
- Requires careful state design so command center never contradicts panel detail

### Recommendation

**Recommend Option D.**

The current console already has the right governance data and controls; it lacks orchestration at the presentation layer. A hybrid model preserves today’s safety controls and technical auditability while dramatically improving operator flow. It is the most credible path to an operator-grade control plane without rewriting the product into a fully wizard-driven experience.

---

## Proposed new operator workflow

### Top-level page layout

1. **Run Command Center** at top
2. **Lifecycle stepper** directly under it
3. **Current action workspace** for the active step
4. **Advanced technical details** as collapsible panels below

### Run Command Center concept

The command center should summarize:

- current run status
- current lifecycle step
- next required action
- blocking issues
- primary action
- secondary safe actions
- escalation or recovery guidance

Example:

```text
[Run Command Center]
Run: 7f23c1a8...      Status: waiting_for_approval
Task: Add config flag to demo service
Current step: Review complete
Next required action: Approve, Request Fix, or Stop this run

Primary action: Approve
Secondary actions: Request Fix | Stop

Warnings:
- 1 review stage still pending
- Policy requires review before PR creation
```

### Lifecycle stepper concept

```text
[Lifecycle]
Repo -> Task -> Plan -> Execute -> Verify -> Review -> Approval -> PR -> Merge -> Deploy -> Health -> Sign-off
                ^ current
```

Rules:

- completed steps show success state
- blocked steps show one-line reason
- current step shows next required action
- future steps remain visible but inactive

### Worker-plan review flow

1. Generate draft
2. Review plain-English plan summary
3. Compare task intent vs plan intent
4. Review affected files summary
5. Inspect/edit JSON only if needed
6. Execute manually

This preserves manual execution while removing raw JSON as the first mental model.

### Approval flow

When the run is actionable, show a dedicated approval card near the top:

```text
[Decision Required]
This run is ready for operator review.
Recommended action: Approve

Primary: Approve
Secondary: Request Fix | Stop
Rationale: [optional/required depending on action]
```

### PR / retry flow

Introduce a distinct state card:

```text
[PR State]
Current state: Commit already created, branch already pushed
Retry behavior: Safe to retry PR creation; no duplicate commit will be made
Next action: Create draft PR
```

### Release gate blocker flow

Convert blocker walls into an ordered checklist:

```text
[Release Blockers]
1. Release checklist not evaluated -> Go to Release checklist
2. Health policy not evaluated -> Go to Deployment health policy
3. Sign-off missing -> Go to Release sign-off
```

### Advanced technical details organization

Keep all existing panels, but group them under collapsible sections:

- `Technical evidence`
  - Evidence bundle
  - Audit timeline
  - Decision history
- `Verification detail`
  - Replay verification
  - Policy results
  - Review stages
  - Quality gates
- `Execution detail`
  - Worker plan draft
  - Worker plan
  - Changed files
- `Release detail`
  - PR creation
  - Merge controls
  - Deployment gates
  - Deployment execution
  - Deployment health checks
  - Deployment health policy
  - Release checklist
  - Release sign-off

This preserves every panel while removing the burden of reading them in raw top-to-bottom order.

---

## Safety-preserving UX recommendations

| Recommendation | Priority | Fix type | Notes |
|---|---|---|---|
| Auto-fill worker-plan template with current run ID | Must fix before production use | Interaction-level | Removes identifier handling from the operator without changing validation |
| Hide `runId` from normal operator flow | Must fix before production use | Visual-only | `runId` can remain visible in advanced details or diagnostics |
| Live JSON validation in worker-plan editor | Must fix before production use | Interaction-level | Keeps manual review while reducing syntax-driven failure |
| Plain-English worker-plan preview | Must fix before production use | Backend-assisted | Summarize intent, operations, and affected files before execute |
| Compare worker-plan paths against task intent | Must fix before production use | Backend-assisted | Guardrail against valid-but-wrong plans |
| Show “this plan will create/update these files” summary | Must fix before production use | Backend-assisted | Makes scope legible without reading raw JSON |
| Clear approval / request-fix / stop card near top | Must fix before production use | Interaction-level | Improves discoverability without changing approval rules |
| One persistent next-required-action card | Must fix before production use | Backend-assisted | Should summarize exactly one recommended operator move |
| PR retry state card | Should fix before external demo | Interaction-level | Makes retry safety legible |
| Hard gate blocker checklist with links to fixing panels | Should fix before external demo | Interaction-level | Improves recovery while keeping hard gates intact |
| Staging dry-run helper visible from run page | Should fix before external demo | Visual-only | Link to runbook/checklist only; no automation |
| Advanced details collapsible panels | Should fix before external demo | Interaction-level | Preserve current panels, improve scannability |
| Copy-safe JSON/template button | Should fix before external demo | Interaction-level | Avoid wrapper text contamination |
| Guardrails against executing model draft that does not match task | Must fix before production use | Backend-assisted | Warning/confirmation layer, not auto-block unless clearly inconsistent |
| Panel subtitles that explain why a step matters | Nice to have | Visual-only | Useful for first-time operators and demos |
| Short glossary for audit / replay / policy terms | Nice to have | Visual-only | Can be inline or tooltip-based |
| Task creation guidance that prefers registered repos over manual paths | Nice to have | Visual-only | Reduces ambiguity in setup |
| Expert mode shortcuts for repeat operators | Later | Interaction-level | Only after the default path is clear and safe |

---

## Proposed phased redesign backlog

| Phase | Goal | Files likely touched | Risk level | Test requirements | Acceptance criteria |
|---|---|---|---|---|---|
| UX-1 | Add command center skeleton and workflow hierarchy without removing existing panels | `src/components/engineer-console/run-live-panel.tsx`, new command-center/stepper helpers, run-page tests, docs | Medium | Unit tests for derived next-action state, component rendering, no panel loss; Playwright smoke for page load and visibility | Command center appears at top, lifecycle step is visible, all existing panels still render, no behavior changes |
| UX-2 | Improve worker-plan authoring and review flow | `worker-plan-panel.tsx`, `worker-plan-draft-panel.tsx`, related API summary helpers, docs | Medium-high | Unit/component tests for template autofill, validation states, intent comparison, safe execute gating; Playwright smoke for draft-to-execute flow | Operator no longer needs manual `runId` copy/paste; plan summary and file impact are visible before execute |
| UX-3 | Improve approval and review decision visibility | `approval-actions.tsx`, approval report area in `run-live-panel.tsx`, review stages panel, docs | Medium | Component tests for actionable-state visibility, rationale requirements, review-stage summaries; accessibility checks for focus order and buttons | Approve / Request Fix / Stop are visible when actionable and clearly secondary/primary |
| UX-4 | Clarify PR retry, hard gates, and release blockers | `pr-creation-panel.tsx`, `merge-controls-panel.tsx`, `hard-release-gate-banner.tsx`, `release-checklist-panel.tsx`, `release-signoff-panel.tsx`, docs | Medium | Unit tests for retry-state copy, blocker mapping, hard-gate checklist rendering; Playwright smoke for retry and blocked-release states | Retry state is understandable, blockers point to fixes, no change to release-gate enforcement |
| UX-5 | Add staging helper and operator polish across setup and run flows | `registered-repos-panel.tsx`, `create-task-form.tsx`, `compatibility-panel.tsx`, `engineer-session-bar.tsx`, docs/runbook links | Low-medium | Playwright smoke for setup flow, docs-link checks, accessibility review, regression checks on current navigation | First-time operators can complete staging with materially less external guidance |

---

## Test strategy

### 1. Unit and component tests

- Command center derives the correct next action from run state
- Worker-plan template includes the correct `runId` without manual copy/paste
- Plain-English plan summary matches parsed plan content
- Task-vs-plan mismatch warnings appear when affected files diverge from task intent
- Approval controls are visible when the run is ready for approval
- Request Fix and Stop are visible when applicable
- PR retry state card explains whether retry is safe, blocked, or requires recovery
- Hard gate blocker list maps to the relevant fixing panels
- Existing panels still render under the new hierarchy
- No action is triggered automatically by copy, preview, or visibility changes

### 2. Playwright E2E smoke tests

- Repo registration -> verify -> index -> task -> run happy path still works
- Worker-plan draft -> copy/template -> execute flow remains manual
- Approval card appears at the correct point in the flow
- PR retry state is legible after a simulated partial-failure scenario
- Hard release gate blockers remain enforced while UI adds guidance
- Advanced panels can be expanded and collapsed without losing content

### 3. Accessibility checks

- Stepper state is announced clearly to screen readers
- Command center has a clear heading hierarchy
- Approval buttons and destructive actions are keyboard reachable and labeled
- Error and blocker text uses sufficient contrast and semantic roles
- Collapsible advanced sections are keyboard operable and preserve focus order

### 4. Governance regression checks

- No worker plan executes automatically
- No approval, merge, deployment, or sign-off happens automatically
- Existing role restrictions remain unchanged
- Hard release gates still block exactly the same actions
- Deployment execution still uses only configured profiles
- Audit, evidence, policy, replay, and release records remain append-only and behaviorally unchanged

---

## Must-fix before production

1. Remove manual `runId` handling from normal operator flow.
2. Add plan preview, intent comparison, and file-impact summary before worker-plan execution.
3. Add a top-of-page command center with one next required action.
4. Promote approval / request-fix / stop into a clearly visible decision card.
5. Make blocker states actionable instead of diagnostic-only.
6. Preserve all governance and manual-trigger boundaries while improving guidance.

---

## Should-fix before external demo

1. Clarify PR retry and recovery semantics with a dedicated state card.
2. Add hard-gate blocker checklist links to relevant panels.
3. Collapse advanced panels below the primary workflow path.
4. Add visible staging helper links to runbook and dry-run checklist.
5. Simplify panel subtitles and operator-facing terminology.

---

## What should not change

- Do **not** remove human approval, request-fix, or stop controls.
- Do **not** auto-execute worker plans, approvals, merges, deployments, or sign-off.
- Do **not** weaken worker-plan validation or allowed-file enforcement.
- Do **not** weaken governance, auth, release gates, deployment profiles, or backup behavior.
- Do **not** remove technical panels; reorganize and collapse them instead.
- Do **not** hide auditability; surface summaries first and raw detail second.

---

## Recommended immediate next phase

**Next phase:** **UX-1 — Command center skeleton and lifecycle hierarchy**

It delivers the highest operator-value-to-risk ratio because it improves discoverability, sequencing, and confidence without touching core governance behavior. UX-1 also creates the structural foundation for UX-2 through UX-5.
