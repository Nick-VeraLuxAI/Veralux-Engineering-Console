# Engineering Console intelligence layer guide

Guide to the A1 read-only run intelligence layer. Pair with [intelligence-layer-audit.md](./intelligence-layer-audit.md), [operator-ux-guide.md](./operator-ux-guide.md), and [operator-runbook.md](./operator-runbook.md) for the broader workflow and autonomy roadmap.

---

## What A1 adds

A1 adds a **Run Intelligence** card near the top of the run workspace.

It does four things:

1. Normalizes raw run warnings into **danger points**
2. Classifies deterministic **run risk**
3. Derives deterministic **confidence** and **escalation guidance**
4. Suggests future **playbook recommendations** without executing them

The card is advisory only. It does not approve, request fix, stop, create PRs, merge, deploy, or sign off.

---

## What danger points are

Danger points are plain-English summaries of risky or important run conditions that already exist in the console's underlying signals.

Examples:

- worker plan may not match the requested task
- changed files include protected or high-risk domains
- replay verification reported warnings
- policy requires review
- PR creation is in a retry or recovery state
- release checklist or sign-off is incomplete
- replay or policy results may be stale

Each danger point includes:

- severity
- category
- explanation
- supporting evidence
- recommended next action
- a link back to the supporting panel when possible

---

## What risk levels mean

- **Low**: docs-only, test-only, staging-only, or other low-blast-radius changes
- **Medium**: normal UI, API, integration, or application-logic changes
- **High**: auth, billing, database, deployment, governance, or release-control changes
- **Critical**: credentials, payments, permission escalation, tenant boundaries, production-data access, or equivalent protected domains

Risk is deterministic in A1. It is derived from changed files, worker-plan scope, and normalized danger points. It is not model-judged.

---

## What confidence means

Confidence answers:

"How certain is the system that its current read-only interpretation is grounded in the available deterministic signals?"

In A1, confidence is based on rule factors such as:

- whether quality gates passed
- whether replay passed or warned
- whether policy passed, required review, or blocked
- whether review stages are still pending or rejected
- whether the run is in PR recovery or stale-signal state
- whether the change touches high-risk or critical domains

Confidence does **not** grant authority. It only affects the recommendation shown to the operator.

---

## What escalation means

Escalation translates current risk and governance state into one recommendation:

- `none`
- `operator_review`
- `required_review_stage`
- `senior_approval`
- `blocked`

This recommendation does not replace existing governance rules. It helps the operator understand the expected level of human involvement before later governed actions.

---

## Why A1 is read-only

A1 is intentionally limited so the console can gain better interpretation without weakening governance.

A1 does **not**:

- auto-approve
- auto-create PRs
- auto-merge
- auto-deploy
- auto-sign off
- bypass worker-plan validation
- suppress warnings
- reduce protected-path enforcement
- execute future playbooks

This keeps the first intelligence layer useful without turning it into a hidden authority system.

---

## What is not automated yet

The following remain manual and governed:

- approval decisions
- PR creation retries
- merge
- deployment approval
- deployment execution
- release sign-off
- any handling of auth, billing, secrets, payments, tenant boundaries, or governance code

Playbooks in A1 are recommendation-only placeholders for future phases.

---

## Future path

- **A2**: known warning fingerprints, operator feedback, repeated-warning recognition
- **A3**: safe playbooks for branch/PR/replay/index recovery with human confirmation
- **A4**: confidence-based escalation and narrow low-risk auto-continue through non-destructive steps

Deterministic rules remain authoritative through every phase.
