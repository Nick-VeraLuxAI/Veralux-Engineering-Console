# Intelligence Layer Audit

**Audit:** A1-Audit - Danger Point Interpreter / Intelligence Layer Readiness  
**Date:** 2026-05-26  
**Scope:** audit and design only  
**Constraint:** no governance behavior changes, no approval-gate weakening, no new autonomous write/merge/deploy behavior

---

## Executive summary

**Verdict:** The Engineering Console is **governance-strong but intelligence-thin**.

The current system already has the right safety spine for a future intelligence layer:

- deterministic worker-plan validation and constrained file execution
- append-only audit records and evidence bundles
- replay verification, policy evaluation, review stages, and hard release gates
- resumable PR creation with branch/commit/PR reconciliation
- release and deployment stages that remain explicitly human-triggered

What it does **not** yet have is the layer that interprets those raw signals the way a senior operator would:

- no normalized danger-point model
- no confidence scoring
- no known-warning memory
- no risk taxonomy beyond coarse path/rule checks
- no playbook engine for safe recoveries
- no escalation engine that can distinguish routine recoverable issues from material governance risk

This means the Console is already suitable as a governed workflow control plane, but it is **not yet ready to behave like a semi-autonomous engineering operations system**. It can detect many state transitions and block unsafe actions, but it still asks the operator to interpret too many warnings manually.

### Current autonomy maturity score

**44 / 100**

That score is intentionally lower than the product's governance maturity. Governance maturity is already strong. Autonomy maturity remains moderate-low because the system has enforcement without interpretation, recovery memory, or confidence-aware escalation.

### Current strengths

- **Strong deterministic write boundary.** `src/lib/engineer-console/worker-plan/worker-plan-validation.ts` and `worker-plan-executor.ts` restrict file operations to validated `create_file`, `update_file`, and `append_file` operations, reject shell/delete behavior, and re-check resolved paths before execution.
- **Strong auditability.** `src/lib/engineer-console/governance/audit-ledger/append-audit-event.ts` appends hash-chained audit events in a transaction, and the replay/evidence stack makes decisions inspectable after the fact.
- **Strong governance pipeline.** Post-change processing in `src/lib/engineer-console/orchestrator/worker-plan-orchestrator.ts` runs changed-file detection, quality gates, approval reporting, policy evaluation, and review-stage reconciliation deterministically.
- **Strong release gating.** PR, merge, deploy, health, checklist, and sign-off stages each have their own readiness evaluators and optional hard release gates.
- **Good operator guidance foundation.** `build-run-workflow-summary.ts` and `derive-run-ux.ts` already aggregate workflow state into the command center, lifecycle stepper, blocker routing, and release guidance.

### Current weaknesses

- **No real danger-point interpreter.** Raw governance signals exist, but there is no first-class layer that says "this is a recoverable branch mismatch" versus "this is a tenant-boundary change."
- **Risk classification is coarse.** `assessChangedFiles()` in `src/lib/engineer-console/governance/governance-engine.ts` primarily looks at protected paths and large change counts. It does not classify auth, billing, multi-tenant isolation, or provider-behavior changes semantically.
- **No known-warning memory.** The system stores decisions, policy results, replay results, and PR history, but it does not fingerprint or learn from repeated operator dispositions.
- **No confidence model.** There is no persisted score for "how sure are we that this warning is routine and recoverable?"
- **No playbook abstraction.** Safe recovery logic exists in isolated places, especially PR retry reconciliation, but there is no generalized playbook engine across runs.
- **No reversibility or blast-radius model.** The system knows many facts about a run, but it does not yet convert them into bounded-autonomy decisions.

### Intelligence audit verdict

The Console is ready for **A1 - deterministic danger-point detection and risk summarization**, but **not** for autonomous remediation or silent continuation.

Implementation note: the shipped A1 follows the safest read-only path first. The current implementation derives danger points, risk, confidence, escalation, and playbook recommendations server-side for the run page, but it does **not** add persistence, auto-actions, or any new gate authority.

### Top 10 missing intelligence capabilities

1. A normalized `danger_point` model that spans plan, validation, PR, release, and deployment stages.
2. Run-level risk classification that goes beyond path heuristics.
3. Confidence scoring with auditable factors.
4. Known-warning fingerprinting and memory.
5. A generalized recovery-playbook model.
6. Escalation derivation based on risk, confidence, blast radius, reversibility, and sensitivity.
7. Domain-sensitive path and symbol rules for auth, billing, tenant isolation, secrets, migrations, and provider integrations.
8. Freshness tracking for evidence, replay, policy, checklist, and health decisions.
9. Operator feedback capture that can teach the system which warnings are repeatedly accepted or rejected in the same context.
10. A read-only run intelligence surface that summarizes danger points without changing any gate authority.

### Danger point categories

- **Intent and interpretation**
- **Plan shape and file-scope safety**
- **Protected or high-risk domain changes**
- **Verification and policy drift**
- **Audit and review integrity**
- **PR and branch recovery**
- **Release and deployment governance**
- **Freshness and stale-evidence risk**

---

## Current architecture review

The current architecture already exposes almost every raw signal needed for an intelligence layer. The missing piece is the interpretation layer that sits between those signals and the operator.

### Stage-by-stage architecture

| # | Lifecycle area | Current implementation | Evidence | Readiness note |
|---|---|---|---|---|
| 1 | Task creation | Manual operator task creation with repo targeting and audit events | `src/app/api/engineer-console/tasks/route.ts`, `src/lib/engineer-console/task-manager/task-manager.ts` | Good intake record, but no task-type classification or semantic risk extraction |
| 2 | Run creation | `POST /tasks/[id]/runs` creates a run and currently calls `executeRun()` asynchronously | `src/app/api/engineer-console/tasks/[id]/runs/route.ts` | Important nuance: a legacy default-run path still exists; it should not be expanded as the future autonomy model |
| 3 | Worker-plan draft generation | Model draft stored as JSON proposal only | `src/lib/engineer-console/model-router/worker-plan-draft-generator.ts` | Good draft boundary; still no semantic mismatch scoring beyond UI warnings |
| 4 | Worker-plan validation | Deterministic validation of `runId`, `allowedFiles`, operations, path safety, protected paths, and index warnings | `src/lib/engineer-console/worker-plan/worker-plan-validation.ts` | Strong deterministic control |
| 5 | Worker-plan execution | Only validated file operations execute; no shell, delete, or git commit | `src/lib/engineer-console/worker-plan/worker-plan-executor.ts` | Strong deterministic control |
| 6 | Changed-file detection | Git diff plus worker-plan-scoped untracked-file inclusion | `src/lib/engineer-console/orchestrator/worker-plan-orchestrator.ts`, `src/lib/engineer-console/worker-plan/worker-plan-manager.ts`, `src/lib/engineer-console/workspace/git-workspace.ts` | Good recent fix; still no semantic blast-radius interpretation |
| 7 | Quality gates | Repo scripts detected and run after changes | `src/lib/engineer-console/quality-gates/quality-gate-runner.ts` | Strong detection, no automated repair loop |
| 8 | Evidence bundles | Redacted hashed evidence bundle refreshed from run state | `src/lib/engineer-console/governance/evidence-bundles/build-run-evidence-bundle.ts`, `evidence-bundle-manager.ts` | Excellent audit input for future intelligence layer |
| 9 | Replay verification | Deterministic replay checks over evidence, decisions, review stages, quality, governance, and final state | `src/lib/engineer-console/governance/replay-verification/verify-run-replay.ts` | Strong verification, but warnings are not normalized into reusable warning memory |
| 10 | Policy evaluation | Rules evaluate risk, gates, index mismatches, migrations, compatibility, draft correction, and replay freshness | `src/lib/engineer-console/governance/policy-results/evaluate-run-policy.ts` | Strong deterministic rules; still a policy engine, not an interpreter |
| 11 | Review stages | Required review stages inferred from policy, replay, risk, diff size, migrations, and compatibility | `src/lib/engineer-console/governance/review-stages/determine-required-review-stages.ts` | Good escalation primitive; no confidence- or memory-aware review reduction |
| 12 | Human approval decisions | Human-only approve/request-fix/stop with evidence and review prerequisites | `src/lib/engineer-console/orchestrator/run-orchestrator.ts`, `create-decision-record.ts` | Strong human authority boundary |
| 13 | PR readiness | Deterministic evaluation over approval, evidence, policy, replay, review stages, git state, and protected paths | `src/lib/engineer-console/release/pr-creation/evaluate-pr-readiness.ts` | Strong raw signals; no higher-level risk interpretation |
| 14 | PR creation / retry / idempotency | Reuses commits, resumes requests, skips redundant push, detects existing PRs | `src/lib/engineer-console/release/pr-creation/pr-request-manager.ts` | Best current example of a safe future playbook |
| 15 | Merge controls | Merge readiness checks plus hard release gate integration | `src/lib/engineer-console/release/merge-controls/evaluate-merge-readiness.ts` | Deterministic and appropriately gated |
| 16 | Deployment readiness | Readiness requires approved decision, PR, merge, evidence, replay, review stages, gates, and env match | `src/lib/engineer-console/release/deployment-gates/evaluate-deployment-readiness.ts` | Strong deterministic gating |
| 17 | Deployment approval | Separate admin approval with rationale for riskier contexts | `src/lib/engineer-console/release/deployment-gates/deployment-gate-manager.ts` | Good governance boundary |
| 18 | Deployment execution | Admin-only, profile-driven, shell-free spawn of allowlisted fixed commands | `src/lib/engineer-console/release/deployment-execution/evaluate-deployment-execution-readiness.ts`, `execute-deployment-profile.ts` | Strong execution boundary |
| 19 | Health checks | Read-only HTTP GET checks with server-owned profiles | `src/lib/engineer-console/release/deployment-health-check/deployment-health-check-manager.ts`, `execute-http-health-check.ts` | Strong bounded post-deploy signal |
| 20 | Health policy | Deterministic interpretation of health outcomes | `src/lib/engineer-console/release/deployment-health-policy/default-deployment-health-policy.ts` | Good rules; no learned exceptions |
| 21 | Release checklist | Advisory-but-structured release completeness evaluation | `src/lib/engineer-console/release/release-checklist/build-release-checklist.ts` | Rich input surface for future intelligence |
| 22 | Release sign-off | Admin-only sign-off with decision validation | `src/lib/engineer-console/release/release-signoff/validate-release-signoff-decision.ts` | Strong final governance record |
| 23 | Audit ledger | Append-only hash-chained audit events with verification | `src/lib/engineer-console/governance/audit-ledger/append-audit-event.ts` | Excellent audit substrate |
| 24 | Command center / lifecycle UX | Aggregated run summary and derived guidance surfaces | `src/lib/engineer-console/run-ux/build-run-workflow-summary.ts`, `derive-run-ux.ts` | Strong operator UX foundation for a future run intelligence card |
| 25 | Staging dry-run findings | UX friction and PR retry/idempotency lessons captured in docs | `docs/staging-dry-run-report.md`, `docs/final-hardening-notes.md` | Valuable manual evidence, but not yet captured as machine-readable memory |

### Architectural conclusion

The Console already has:

- good **recorded state**
- good **deterministic enforcement**
- good **audit and replay evidence**
- good **operator workflow aggregation**

It does **not** yet have:

- a normalized interpretation layer
- learned warning memory
- escalation logic
- confidence-aware safe recovery

That is exactly the gap A1 should fill.

---

## Current autonomy level

Scoring scale:

- `0` = missing
- `1` = manual only
- `2` = deterministic rule-based
- `3` = semi-automated with human review
- `4` = adaptive / context-aware
- `5` = mature autonomous with audited escalation

| Dimension | Current score | Evidence from code/docs | Gap | Recommendation |
|---|---:|---|---|---|
| Task interpretation | 1 | Tasks store title/description and repo target, but there is no semantic task classification; only manual operator interpretation | System cannot tell docs-only from auth-sensitive work from task text alone | Add deterministic task-tag extraction plus optional model-assisted task summarization later |
| Worker-plan generation | 3 | Model drafts are generated and persisted, with UI mismatch warnings and manual execution | Draft generation exists, but mismatch detection is still shallow and operator-mediated | Add deterministic plan-vs-task mismatch scoring before any future automation |
| Worker-plan validation | 3 | Validation rejects run mismatch, forbidden ops, protected paths, and out-of-scope files | Strong rules, but warnings are not yet escalated by context | Feed validation warnings into a normalized danger-point layer |
| File operation safety | 3 | Only `create_file`, `update_file`, `append_file` execute; path safety is validated twice | Safety is strong, but the system cannot yet distinguish reversible low-risk file creation from high-risk domain edits | Add reversibility and domain-risk overlays on top of the executor |
| Test/build recovery | 1 | Quality gates detect failures only; operator must decide next step | No repair-loop abstraction, no bounded retry policy, no confidence gating | Add future playbooks for lint/import/localized test fixes only under bounded conditions |
| Risk classification | 2 | Governance engine classifies low/medium/high/blocked from protected paths and large change sets | No domain-aware classifier for auth, billing, tenant isolation, external providers, or release-governance logic | Build A1 risk taxonomy and classifier on top of current signals |
| Known warning recognition | 0 | Decision records, replay, policy, and PR history exist, but no warning fingerprint or learning model exists | System cannot learn that a warning is repeatedly accepted in the same context | Add warning fingerprints and known-warning decision history in A2 |
| PR recovery | 3 | PR flow already resumes commits, branches, pushes, and existing PR detection deterministically | Good localized recovery, but not generalized as reusable playbooks | Promote PR recovery logic into a formal playbook pattern |
| Release blocker interpretation | 2 | Hard release gates and checklist items produce blockers; UX maps them to panels | System still surfaces raw blockers more than interpreted operator guidance | Add run-intelligence summaries that group blockers by danger type and next action |
| Deployment safety | 3 | Readiness, approval, execution, health, and health policy are strongly gated and profile-bound | Strong safety, but no intelligence layer distinguishes routine staging issues from production-sensitive risk | Add escalation rules by environment, sensitivity, reversibility, and health context |
| Human escalation | 3 | Review stages, approval gates, admin roles, and hard gates route work to humans | Escalation exists, but only as fixed rules, not confidence-aware triage | Add an escalation matrix that can recommend continue/confirm/review/final-approve/block |
| Auditability | 4 | Audit chain, evidence bundles, replay verification, and decision records are strong and consistent | Intelligence-specific reasoning is not yet persisted as its own auditable object | Add risk assessments, danger-point events, and escalation decisions as append-only records |
| Operator UX | 3 | Command center, lifecycle, review visibility, PR retry clarity, and run workspace are implemented | UX explains raw state well, but not intelligence-level interpretation | Add a read-only run intelligence card with rationale, confidence, and recommended action |
| Confidence scoring | 0 | No score, no factors, no thresholds, no confidence history | System cannot say how certain it is that a warning is routine | Add deterministic factor-based confidence assessments before any model assistance |
| Reversibility awareness | 2 | PR flow knows some resumability and reusable-commit states | No generalized concept of reversible vs destructive changes | Add reversibility/blast-radius signals to risk assessment |

### Overall autonomy maturity

**44 / 100**

### Summary judgment

- **Governance maturity:** high
- **Operational intelligence maturity:** low to moderate
- **A1 readiness:** yes, for deterministic interpretation only
- **A3+ readiness:** not yet, until memory, confidence, and playbook controls exist

---

## Danger point inventory

### Inventory summary

The Console already detects many danger points, but it detects them in different subsystems using different terms:

- worker-plan validation warnings/errors
- governance risk issues
- policy blockers/warnings/review items
- replay failed/warning checks
- review-stage pending/rejected states
- PR readiness blockers and resumability signals
- release gate blockers
- health policy warnings

The first intelligence-layer job is to normalize those into one consistent danger-point inventory.

### Detailed inventory

| # | Danger point | Current detection mechanism | Current response | Human review today? | Could be auto-handled safely later? | Data needed to decide | Recommended future handling |
|---|---|---|---|---|---|---|---|
| 1 | Wrong task interpretation | No true classifier; manual task reading and later task-vs-plan comparison in UX | Operator rewrites task or plan manually | Yes | Sometimes | Task text, repo context, file intent patterns, prior accepted task types | Add task classification plus task/plan mismatch detector |
| 2 | Wrong model-generated worker plan | Draft comparison warnings and later validation | Draft must be edited or discarded manually | Yes | Sometimes | Draft summary, operation types, path scope, task text, repo symbols | Add deterministic mismatch scoring and safe re-draft recommendation |
| 3 | Worker plan touches unexpected files | `allowedFiles`, changed-files list, approval report, governance notes | Warning/block depending on path and later review | Yes | Sometimes | Task intent, changed files, file categories, prior scope baseline | Normalize as `unexpected_scope` danger point |
| 4 | Worker plan creates new files not indexed | `FILE_NOT_IN_INDEX` validation warning; policy `UNINDEXED_TARGETS_MODIFIED`; changed-file scope fix | Warning/review only | Yes | Yes, in low-risk contexts | Operation type, indexed file set, repo verification state | Recommend re-index playbook rather than escalate by default |
| 5 | Worker plan modifies protected paths | Path safety and governance protected-path checks | Validation error or governance block/high risk | Yes | Rarely | Path, protected-rule match, allow flags, run context | Keep as hard block or high-risk review only |
| 6 | Worker plan changes auth/security/session logic | No strong semantic detector today; only indirect path clues | Usually surfaces only as ordinary file changes unless protected file path hits | Yes | No | Path rules, symbol ownership, keywords, module map | Add high/critical auth/security classifier; never auto-handle |
| 7 | Worker plan changes pricing/billing logic | No semantic detector today | Ordinary workflow unless operator notices | Yes | No | Billing path rules, symbols, task tags, provider context | Add high/critical billing classifier; never auto-handle |
| 8 | Worker plan changes database schema or migrations | Migration path regex in governance/policy/review logic; optional migration allow flag | Policy/review escalation and high risk | Yes | No | Migration files, schema paths, operation types, task purpose | Keep human review mandatory |
| 9 | Worker plan changes deployment scripts | No dedicated semantic classifier today | Later release/deploy stages may reveal impact | Yes | No | Deployment script paths, workflow files, profile references | Add high-risk deployment-script detector |
| 10 | Worker plan changes environment variable handling | `.env` file writes blocked, but code-level env handling is not semantically classified | Block if `.env`; otherwise ordinary diff | Yes | No | Env-related symbols, config paths, provider code, secret usage hints | Add secrets/env-handling classifier |
| 11 | Worker plan changes tenant/data isolation | No dedicated detector today | Ordinary workflow unless caught in review | Yes | No | Multi-tenant module paths, policy tags, auth/data-layer symbols | Add critical tenant-boundary classifier |
| 12 | Worker plan changes external API/provider behavior | Compatibility and file-path context may hint, but no provider-behavior detector | Ordinary flow with manual review | Yes | Rarely | Provider client paths, API surface change hints, integration tags | Add high-risk external-provider classifier |
| 13 | Worker plan changes test fixtures only | No dedicated low-risk classifier today | Treated like any other code change | Usually | Yes | Path classification for tests/fixtures only, operation types | Add explicit low-risk test-only recognition |
| 14 | Worker plan changes docs only | No dedicated low-risk classifier today | Treated like any other change except gates may be light | Usually | Yes | Docs path classifier, executable-path exclusion, diff summary | Add explicit docs-only low-risk classification |
| 15 | Quality gates fail | Quality gate runner and stored results | Run fails or later readiness blocks | Yes | Sometimes | Failed command, stderr category, changed module scope, retryability | Add bounded fix playbooks for lint/import/localized failures |
| 16 | Quality gates pass but coverage is weak | No coverage-strength model today | No special response | Yes | Sometimes | Coverage metadata, changed-file-to-test mapping, history | Add test-strength factor to confidence and escalation |
| 17 | Replay verification warns | Replay summary tracks passed/warning/failed checks | Warning shown; later policy/release may still proceed with review | Yes | Sometimes | Warning fingerprints, affected record types, prior accepted outcomes | Add warning memory and contextual replay severity |
| 18 | Policy requires review | Policy result status `requires_review` and review-required items | Review stages generated/reconciled; approval rationale required | Yes | No silent bypass | Policy rule ids, risk class, prior approvals, context | Keep human review mandatory; only improve guidance |
| 19 | Audit chain warning or mismatch | Audit verification and replay audit checks | Warning or block later stages | Yes | No | Chain failure type, scope, missing event details | Treat as material governance issue; block if integrity compromised |
| 20 | Review stage rejected | Review stage manager summary | Final approval blocked | Yes | No | Stage type, rationale, review source, replacement review path | Keep deterministic block until resolved |
| 21 | PR creation partial failure | PR request statuses and resumability detection | Retry/resume logic available; operator retries | Yes | Yes | Request state, reusable commit, branch state, existing PR state | Promote to explicit playbook with auto-recommendation |
| 22 | Branch mismatch | PR readiness compares current checkout to run branch | Warning; retry path checks out run branch first | Yes | Yes | Current branch, run branch, dirty-tree state | Safe auto-playbook under clean-tree conditions |
| 23 | Remote branch missing | Remote ref lookup in PR readiness and PR creation | Push happens during PR creation | Yes | Yes | Local branch SHA, remote branch existence, actor authorization | Auto-handle inside PR playbook only |
| 24 | Existing commit/PR detection mismatch | Reusable-commit detection and existing PR lookup | Reuse existing commit/PR or require manual recovery | Yes | Yes, carefully | Request history, reachable commit, approved scope, PR lookup | Normalize as resumability playbook state |
| 25 | Merge blocked | Merge readiness and hard release gates | Merge request blocked | Yes | No | Gate blockers, PR state, policy/replay/review/checklist | Keep human merge action and deterministic blocking |
| 26 | Deployment approval missing | Deployment readiness/execution readiness | Block deployment execution | Yes | No | Readiness result, environment, actor role | Keep human approval mandatory |
| 27 | Deployment health check fails | Health check result and health policy | `needs_attention` or `unhealthy`; later release actions block | Yes | Rarely | Health profile, status history, environment type, rollback options | No auto-handling in production; staged guidance only |
| 28 | Release checklist incomplete | Release checklist evaluation | Checklist `needs_attention` or `blocked` | Yes | No silent bypass | Checklist items, environment, policy/replay/review state | Keep checklist advisory/hard-gate behavior unchanged; improve summary |
| 29 | Sign-off missing or rejected | Release sign-off status and hard gates | Sign-off remains required or blocks completion | Yes | No | Checklist state, rationale, previous sign-offs | Keep explicit human sign-off mandatory |
| 30 | Stale evidence/replay/policy result | Partial detection only: evidence regenerated after decision, missing evaluations, stale request history | Usually warning or manual rerun | Yes | Yes, for recomputation only | Timestamps, run version/hash, changed-state markers, decision timestamps | Add freshness detector and safe rerun playbooks |

### Inventory conclusion

The Console already knows **where** danger arises. It does not yet know how to:

- normalize those danger points
- classify their real severity
- recognize repeated safe exceptions
- recommend the least-escalatory safe next action

---

## Risk classification audit

### Can the system classify run risk today?

**Partially.**

Today the system can:

- classify **protected-path** and **migration/lockfile** risk deterministically
- classify **quality/replay/policy/review** state deterministically
- classify **PR/git resumability** deterministically
- classify **release/deployment readiness** deterministically

Today the system cannot reliably classify:

- docs-only versus low-risk executable changes
- auth/session/security logic
- billing/pricing/payment logic
- tenant/data-isolation changes
- external-provider behavior changes
- reversibility or blast radius
- whether a warning is routine in the current context

### Current signal audit

| Signal | Available today? | Used today? | Current use | Main limitation |
|---|---|---|---|---|
| Files changed | Yes | Yes | Governance, approval report, PR readiness, release checklist | Path-based, not semantic |
| File paths | Yes | Yes | Protected path checks, migration/lockfile rules | Weak domain coverage |
| Operation types | Yes | Yes | Worker-plan validation/execution | Not risk-scored by domain |
| Task title/description | Yes | Limited | UX comparison and prompts | No task classification |
| Worker-plan summary | Yes | Limited | UX and evidence | No formal mismatch/risk model |
| Quality gate results | Yes | Yes | Blockers and checklist items | No repairability or test-strength model |
| Replay result | Yes | Yes | Policy, checklist, release blockers | Warning semantics not normalized |
| Policy status | Yes | Yes | Approval gating, review stages, release blockers | Rules are deterministic but coarse |
| Review stage state | Yes | Yes | Approval and release gating | No confidence-driven stage reduction |
| PR readiness | Yes | Yes | PR workflow and UX | Not generalized beyond PR subsystem |
| Release gate state | Yes | Yes | Merge/deploy/sign-off blocking | No unified danger-point layer |
| Deployment health | Yes | Yes | Health policy and checklist | No environment-sensitive recovery playbooks |
| Audit events | Yes | Yes | Replay/audit verification | No intelligence-specific audit objects |
| Branch/commit metadata | Yes | Yes | PR resumability and recovery | Narrowly scoped to PR flow |

### Proposed risk taxonomy

#### LOW

Examples:

- docs only
- test-only
- isolated UI copy
- staging-only notes
- non-executable metadata
- reversible simple file creation

| Field | Definition |
|---|---|
| Signals | Docs/test path-only changes, no protected or high-risk domains, low file count, reversible operations, no failed gates |
| Examples | `README.md`, docs guides, test fixture additions, label/copy-only UI tweaks |
| Required gates | Worker-plan validation, quality gates if present, evidence, replay, policy, human approval before PR according to current configuration |
| Possible auto-handling later | Recompute-only steps, stale-result refresh, known-safe warning grouping, low-risk playbook suggestions |
| Escalation rule | Can move to **ask for confirmation** or later **auto-continue through non-destructive evidence/policy/replay** if confidence is high |

#### MEDIUM

Examples:

- normal app logic
- UI components with behavior
- API route logic
- data transformation logic
- integration glue
- PR/release workflow changes

| Field | Definition |
|---|---|
| Signals | Executable code changes without protected domains, moderate file scope, normal gate results, no critical data sensitivity |
| Examples | feature logic, routing, service integration, non-sensitive workflow plumbing |
| Required gates | Existing gates plus final human approval before PR/merge progression |
| Possible auto-handling later | Safe recomputation, safe git/PR recovery playbooks, bounded fix suggestions with operator confirmation |
| Escalation rule | Continue to PR readiness only with strong confidence; final human decision remains mandatory |

#### HIGH

Examples:

- auth/session/security
- billing/pricing
- database schema/migrations
- deployment scripts
- secrets/env handling
- tenant/data isolation
- external provider behavior
- audit/governance logic
- release gates
- destructive operations

| Field | Definition |
|---|---|
| Signals | Protected-domain path rules, migration detection, environment/security symbols, governance files, provider/client surface changes |
| Examples | auth middleware, session handling, migrations, payment code, deploy profiles, audit/release gate logic |
| Required gates | Strong deterministic validation, required review stages, explicit rationale, final human approval, no silent continuation |
| Possible auto-handling later | Only non-mutating analysis and guided operator summaries |
| Escalation rule | Require review stage and final approval; no auto-merge or auto-deploy |

#### CRITICAL

Examples:

- production data access
- credential handling
- payment execution
- permission escalation
- direct deployment automation
- bypassing human approval
- multi-tenant boundary changes

| Field | Definition |
|---|---|
| Signals | Secrets/auth/payment/tenant-boundary domains, governance-bypass attempts, direct prod-impacting automation paths |
| Examples | secret rotation code, payment execution code, role escalation, approval-bypass logic |
| Required gates | Explicit senior operator authorization, mandatory review, full rationale, audit emphasis, no automation |
| Possible auto-handling later | None beyond detection and explanation |
| Escalation rule | Block entirely unless explicitly authorized by senior operator policy |

### Risk readiness conclusion

The current system can support **A1 deterministic risk classification** because the raw signals already exist. It cannot yet support **adaptive or memory-based risk interpretation** because the data is not normalized into intelligence-layer entities.

---

## Known-warning / exception memory audit

### Current readiness

The system already stores many ingredients of future warning memory:

- **decision records** with outcome, rationale, risk snapshot, evidence hash, and audit linkage
- **policy results** with rule-level blockers, warnings, and review-required items
- **replay results** with failed and warning checks
- **PR requests** with retry history, commit reuse, branch/PR reconciliation, and failure messages
- **audit events** with append-only chronology

That means the Console has **history**, but not yet **memory**.

### What the current system can already prove

- A replay warning happened on a specific run
- A policy review requirement happened on a specific run
- A PR retry resumed using an existing commit or PR
- A decision was approved, rejected, or stopped with rationale
- Evidence was regenerated after a decision

### What it cannot yet learn reliably

- "This replay warning on docs-only changes is usually accepted"
- "New file not in index is often safe in README smoke tasks"
- "Branch mismatch is a safe recovery when the run branch still exists and the tree is clean"
- "This warning should only be considered routine in staging, never in production"

### Missing normalization

Current records are not enough because they lack:

- warning fingerprints
- normalized warning messages
- risk class at time of decision
- allowed and forbidden contexts
- confidence and staleness rules
- later outcome linkage such as "approved and no downstream issue"

### Proposed future known-warning memory model

| Field | Purpose |
|---|---|
| `warning_fingerprint` | Stable hash of normalized warning meaning plus source |
| `warning_source` | Replay, policy, PR recovery, quality gate, checklist, health, audit, etc. |
| `normalized_message` | Canonical message stripped of run-specific ids and timestamps |
| `affected_files` | Normalized file/path set involved when the warning occurred |
| `task_type` | Docs/test/ui-copy/app-logic/release/deploy/etc. |
| `risk_classification` | LOW/MEDIUM/HIGH/CRITICAL at time of decision |
| `approval_history` | Count and recent approved outcomes in matching contexts |
| `rejection_history` | Count and recent rejected outcomes in matching contexts |
| `last_seen` | Freshness and staleness control |
| `confidence` | Machine-derived confidence from repeated same-context outcomes |
| `operator_notes` | Human explanation of why the warning was accepted or rejected |
| `expiration_rule` | Automatic decay or invalidation after time, code drift, or policy-version change |
| `allowed_contexts` | Environment, task type, file classes, risk ceiling, repo type |
| `forbidden_contexts` | Production, protected domains, auth/billing/tenant/security, etc. |

### Known-warning memory guardrail

Known-warning memory must **never** silently bypass governance. Its purpose is only to:

- reduce unnecessary escalation
- improve recommendation quality
- separate recurring benign warnings from novel or material risk

It should only lower escalation when:

- the fingerprint is a strong match
- the current context is explicitly allowed
- the risk level is low or medium
- confidence is high
- no protected or critical domain is involved

---

## Playbook / recovery automation audit

The current system already contains isolated recovery logic, especially in PR creation. Those recoveries should become explicit playbooks before any automation is added.

| Playbook | Trigger condition | Safe preconditions | Automated action allowed later? | Human approval needed? | Rollback / recovery plan | Audit event | Confidence threshold | Test requirements |
|---|---|---|---|---|---|---|---:|---|
| Checkout run branch before retry | Current branch differs from run branch | Run branch exists, tree state understood, no protected-path drift | Yes | No for same-run branch recovery | Return to prior branch if checkout fails or drift detected | `PLAYBOOK_BRANCH_RECONCILED` | 0.95 | Git-state unit tests and PR retry integration tests |
| Reuse existing run commit | Reusable commit detected | Commit reachable from run branch and matches approved scope | Yes | No | Fall back to manual recovery if commit unreachable | `PLAYBOOK_COMMIT_REUSED` | 0.98 | Commit-reachability and scope-matching tests |
| Skip push when remote already matches | Remote branch SHA matches reusable commit | Same branch, same commit, no remote drift | Yes | No | Retry normal push if remote mismatch appears | `PLAYBOOK_REMOTE_REUSED` | 0.98 | Remote-ref reconciliation tests |
| Record existing PR instead of creating duplicate | Existing PR found for run branch | Branch match, PR open or recorded, scope match | Yes | No | Surface mismatch if PR state inconsistent | `PLAYBOOK_EXISTING_PR_RECORDED` | 0.97 | Existing-PR detection tests |
| Re-index repo after new file/index mismatch | Worker plan creates file not in latest index | Registered repo, file scope low/medium risk, no protected domain | Yes | Usually no | Keep original index snapshot and rerun safely | `PLAYBOOK_REINDEX_TRIGGERED` | 0.90 | File-index refresh tests |
| Re-run replay when stale | Replay missing or older than current evidence snapshot | Evidence present, no unresolved failed replay | Yes | No | Preserve prior replay row; keep both results | `PLAYBOOK_REPLAY_REFRESHED` | 0.95 | Evidence/replay freshness tests |
| Re-run policy when stale | Policy result older than current evidence or replay state | Latest signals available, no policy engine error | Yes | No | Preserve prior policy row; keep both results | `PLAYBOOK_POLICY_REFRESHED` | 0.95 | Policy freshness tests |
| Attempt lint-only fix | Quality gate fails on lint in changed files only | Low/medium risk, changed-file-local fix, bounded attempts, no protected domains | Yes, later | Yes in A3 | Revert worker-attempt diff or request-fix if broader drift appears | `PLAYBOOK_LINT_FIX_ATTEMPTED` | 0.85 | Diff-bounded fix tests and retry-limit tests |
| Attempt missing-import/build fix | Build fails from missing import or symbol in changed module | Low/medium risk, bounded scope, changed files only, tests available | Yes, later | Yes in A3 | Revert attempt if fix expands scope or new risk appears | `PLAYBOOK_BUILD_FIX_ATTEMPTED` | 0.80 | Compile-failure classification tests |
| Attempt changed-module test fix | Tests fail in directly changed module | Low/medium risk, no protected areas, bounded attempts, no flaky-suite signal | Yes, later | Yes in A3 | Revert attempt or escalate if failure spreads | `PLAYBOOK_TEST_FIX_ATTEMPTED` | 0.80 | Module-local test failure classification tests |

### Playbook conclusion

The system is already closest to A3 in one narrow area:

- **branch / commit / PR reconciliation**

Every other playbook area still needs:

- explicit triggers
- confidence thresholds
- rollback rules
- audit events
- scope limits

---

## Escalation policy audit

### Proposed escalation actions

- **Handle automatically**
- **Ask for confirmation**
- **Require review stage**
- **Require final approval**
- **Block entirely**

### Escalation rules

1. **Risk level can only raise severity, never lower it.**
2. **Governance area touched** and **data sensitivity** can force review or block regardless of confidence.
3. **Known-warning confidence** can reduce escalation by at most one level, and never for high/critical domains.
4. **Reversibility** and **blast radius** matter only after risk and governance-area checks.
5. **Model confidence alone is never sufficient.**

### Proposed escalation matrix

| Conditions | Proposed action | Notes |
|---|---|---|
| LOW risk + high confidence + small blast radius + reversible + tests pass + no protected area + known-warning confidence high | Handle automatically | Limited to non-destructive recomputation and safe playbooks; still no auto-approve/merge/deploy |
| LOW risk + medium confidence or weak tests | Ask for confirmation | Good for stale replay/policy refresh, re-index, or retry-safe PR recovery |
| MEDIUM risk + high confidence + reversible + no governance-sensitive area | Ask for confirmation or require final approval depending stage | May auto-continue through evidence/policy/replay later, but not through approval/merge/deploy |
| MEDIUM risk + low confidence or broad blast radius | Require review stage | Especially for app logic with unclear side effects |
| HIGH risk regardless of confidence | Require review stage and final approval | No auto-actions beyond analysis and guidance |
| HIGH risk + protected/governance/release/deploy area | Require final approval | Review and rationale should remain explicit |
| CRITICAL risk regardless of confidence | Block entirely unless senior operator explicitly authorizes | Never auto-handle secrets/auth/payment/tenant-boundary/approval-bypass cases |
| Production target + any unresolved health/policy/replay/review issue | Block or require final approval depending severity | Deployment target can raise escalation by itself |
| Known warning in allowed low-risk context + high fingerprint confidence + no forbidden context | Reduce from review to confirmation at most | Never bypass mandatory governance boundaries |

### Recommended implementation principle

The escalation engine should be **deterministic first**:

- compute risk
- compute confidence
- compute blast radius
- compute reversibility
- derive escalation

Only after that should a model be allowed to produce an explanation.

---

## Data model gap audit

The current schema already has strong operational records, but it lacks intelligence-layer entities that normalize risk, danger points, memory, and escalation.

| Proposed entity | Purpose | Key fields | Source data | Retention | Audit requirements | Needed now or later |
|---|---|---|---|---|---|---|
| `run_risk_assessments` | Persist one auditable risk assessment per run evaluation | `id`, `run_id`, `version`, `risk_level`, `risk_score`, `confidence_score`, `blast_radius`, `reversibility`, `rationale_json`, `created_at` | Task, run, worker plan, changed files, policy, replay, review, release state | Append-only, retained with run | Full append-only audit event on create | **Now (A1)** |
| `danger_point_events` | Normalize all detected danger points | `id`, `run_id`, `stage`, `danger_type`, `severity`, `status`, `details_json`, `recommended_action`, `created_at`, `resolved_at` | Validation, governance, policy, replay, PR, release, health signals | Append-only plus resolved marker | Append-only create/update-by-supersession | **Now (A1)** |
| `warning_fingerprints` | Stable normalized warning identity | `id`, `fingerprint_hash`, `source`, `normalized_message`, `path_scope_json`, `operation_scope_json`, `created_at` | Policy, replay, PR, quality-gate, health warnings | Long-lived, versioned | Audit create/retire | Later (A2) |
| `known_warning_decisions` | Store operator outcomes per fingerprint | `id`, `fingerprint_id`, `run_id`, `decision`, `actor_label`, `context_json`, `notes`, `created_at` | Decision records plus warning fingerprints | Long-lived with staleness rules | Audit on write | Later (A2) |
| `recovery_playbooks` | Declarative playbook definitions | `id`, `code`, `name`, `trigger_type`, `preconditions_json`, `allowed_actions_json`, `forbidden_contexts_json`, `risk_ceiling`, `active` | Product policy/config | Versioned | Audit create/change/retire | Later (A3) |
| `playbook_runs` | Execution history for playbooks | `id`, `playbook_id`, `run_id`, `trigger_event_id`, `status`, `confidence_score`, `actions_json`, `outcome_json`, `actor_type`, `created_at` | Playbook engine and run state | Append-only | Audit create and completion | Later (A3) |
| `confidence_assessments` | Persist confidence factor breakdowns | `id`, `run_id`, `subject_type`, `subject_id`, `confidence_score`, `factor_json`, `rules_version`, `created_at` | Risk engine and warning memory | Append-only | Audit on create | Later (A4) |
| `escalation_decisions` | Persist system escalation recommendations | `id`, `run_id`, `subject_type`, `risk_level`, `escalation_action`, `reason_json`, `derived_from_assessment_id`, `created_at` | Risk assessments, danger points, confidence, policy | Append-only | Audit on create | Later (A4) |
| `operator_feedback` | Capture whether recommendations were useful/correct | `id`, `run_id`, `danger_point_id`, `feedback_type`, `accepted`, `notes`, `created_at` | UI feedback and decision actions | Medium-term retention | Audit on create | Later (A2) |
| `auto_action_permissions` | Policy-controlled autonomy ceilings by environment/profile | `id`, `environment`, `risk_ceiling`, `allowed_playbooks_json`, `forbidden_domains_json`, `created_at`, `retired_at` | Admin policy | Versioned | Strong audit/change control | Later (A4/A6) |
| `risk_policy_versions` | Versioned taxonomy and thresholds | `id`, `version`, `taxonomy_json`, `thresholds_json`, `created_by`, `created_at`, `retired_at` | Intelligence policy config | Long-lived | Audit create/retire | **Now (A1)** |

### Data model conclusion

For A1, the minimum viable new entities are:

1. `run_risk_assessments`
2. `danger_point_events`
3. `risk_policy_versions`

Everything else can come later.

---

## Proposed A1 Danger Point Interpreter architecture

### Goal

Create a deterministic interpretation layer that sits between raw governance signals and operator guidance, without changing approval, merge, deploy, or release authority.

### Inputs

- task
- worker plan
- changed files
- quality gates
- replay
- policy
- review stages
- approval state
- PR state
- release gates
- deployment health
- historical decisions
- known warnings
- path risk rules

### Outputs

- risk score
- risk level
- danger points
- confidence
- recommended next action
- auto-handled actions list
- escalation requirement
- rationale
- playbook recommendation
- operator-facing summary
- audit event payload

### Design principles

1. **Deterministic rules first**
2. **Optional model-assisted explanation second**
3. **Human approval for policy changes**
4. **Full audit trail**
5. **No silent bypass of gates**

### Proposed flow

1. **Collect raw signals**
   - Pull from the same sources already used by `build-run-workflow-summary.ts`, policy, replay, PR readiness, and release evaluators.
2. **Detect danger points**
   - Convert raw warnings/blockers/state mismatches into normalized `danger_point` objects.
3. **Classify run risk**
   - Use deterministic taxonomy rules plus domain/path heuristics to assign LOW/MEDIUM/HIGH/CRITICAL and a numeric score.
4. **Compute confidence**
   - In A1 this should be deterministic and factor-based, not model-based.
5. **Recommend playbooks**
   - In A1 this is recommendation-only; no execution.
6. **Derive escalation**
   - Decide whether to continue, confirm, require review, require final approval, or block.
7. **Build operator summary**
   - Produce a compact run intelligence summary for the UI.
8. **Persist audit artifacts**
   - Defer persistence until after the read-only A1 UI proves useful. The first implementation can stay derivable from existing run records.

### Proposed module structure

| File | Responsibility |
|---|---|
| `src/lib/engineer-console/intelligence/danger-point-types.ts` | Shared enums, types, risk levels, confidence bands, escalation actions |
| `src/lib/engineer-console/intelligence/detect-danger-points.ts` | Deterministically convert raw signals into normalized danger points |
| `src/lib/engineer-console/intelligence/classify-run-risk.ts` | Aggregate danger points into a risk score and risk level |
| `src/lib/engineer-console/intelligence/known-warning-fingerprints.ts` | Normalize warnings into stable fingerprints; A2 grows from here |
| `src/lib/engineer-console/intelligence/recommend-playbooks.ts` | Suggest safe playbooks; A1 recommendation only |
| `src/lib/engineer-console/intelligence/derive-escalation.ts` | Map risk/confidence/blast radius/reversibility to escalation action |
| `src/lib/engineer-console/intelligence/build-intelligence-summary.ts` | Produce operator summary and audit payload from assessments |
| `src/components/engineer-console/run-intelligence-card.tsx` | Read-only operator-facing card for risk, danger points, confidence, and next action |

### Integration points

- **Run page:** extend the existing run summary flow so `build-run-workflow-summary.ts` can feed `build-intelligence-summary.ts`.
- **Command center:** the command center should continue to show lifecycle guidance; the intelligence card should explain *why* the run is considered risky or routine.
- **Approval, PR, deployment, sign-off routes:** continue using existing deterministic authority checks. The intelligence layer is advisory in A1.

### Proposed A1 UI contract

The `run-intelligence-card.tsx` surface should be read-only and show:

- overall risk level and score
- top danger points
- confidence band
- recommended next action
- recommended review/escalation level
- known-safe warnings grouped separately from true blockers
- links to the raw panels that substantiate the summary

It should **not**:

- approve
- request fix
- stop
- create PRs
- merge
- deploy
- sign off

### Architecture conclusion

A1 should act as an **interpreter**, not an **authority**.

---

## Guardrails / non-negotiables

The intelligence layer must:

- never bypass protected-path policy
- never approve its own work
- never merge without authorized policy
- never deploy without authorized policy
- never suppress critical or security warnings
- never trust model confidence alone
- never treat repeated approval as safe across different contexts
- never auto-handle secrets, auth, payment, or tenant-boundary changes
- never remove audit history
- never hide risk from the operator
- never execute shell outside existing safe wrappers
- never bypass worker-plan validation
- never let model-generated content write files directly
- never convert advisory memory into silent policy bypass
- never reduce escalation for production-sensitive or governance-sensitive areas based on history alone

---

## Must-build first

1. **Deterministic danger-point normalization**
2. **Run-level risk classification**
3. **Append-only risk assessment records**
4. **Read-only run intelligence card**
5. **Freshness detection for evidence, replay, and policy**

These are the minimum viable A1 capabilities.

---

## Later enhancements

- Known-warning fingerprints and memory
- Operator feedback capture
- Safe recovery playbooks
- Confidence-based escalation
- Model-assisted explanations
- Configurable autonomy profiles by environment

---

## What not to automate yet

Do **not** automate:

- auth/session/security changes
- billing/pricing/payment logic
- database schema and migrations
- secrets or environment-variable handling
- tenant/data-boundary changes
- policy/risk rule changes
- approval, merge, deploy, or sign-off
- critical replay or audit-integrity warnings
- release-gate overrides
- broad test/build remediation loops without explicit operator confirmation

---

## Recommended phased roadmap

### A1-Audit

- **Goal:** establish the current-state audit and architecture proposal
- **Scope:** docs only, no behavior changes
- **Files likely touched:** `docs/intelligence-layer-audit.md` and short references in existing docs
- **Risks:** misreading governance maturity as autonomy maturity
- **Tests needed:** `npm test`, `npm run build`
- **Acceptance criteria:** audit published, product code unchanged, governance behavior unchanged

### A1

- **Goal:** deterministic danger-point detection and risk classification with no auto-actions
- **Scope:** add intelligence types, detectors, classifiers, read-only risk summary UI, and recommendation-only playbooks with no new persistence
- **Files likely touched:** `src/lib/engineer-console/intelligence/*`, `src/components/engineer-console/run-intelligence-card.tsx`, run summary/route/UI files, docs, and tests
- **Risks:** accidental coupling to approval/PR/deploy authority; over-warning noise
- **Tests needed:** unit tests for danger-point detection, risk classification, escalation derivation, UI rendering, no-governance-regression tests
- **Acceptance criteria:** every run can render an intelligence summary, no mutation authority changes, no gate bypasses, no auto-actions executed, and no new persistence is required

### A2

- **Goal:** known-warning fingerprints and operator feedback
- **Scope:** warning normalization, decision memory, operator feedback capture, warning-confidence derivation
- **Files likely touched:** intelligence memory modules, schema, decision/audit integration, UI feedback surfaces
- **Risks:** overgeneralizing repeated approvals across different contexts
- **Tests needed:** fingerprint stability tests, context-match tests, forbidden-context tests, staleness/expiration tests
- **Acceptance criteria:** repeated warnings can be recognized in matching low-risk contexts, but governance is never bypassed

### A3

- **Goal:** safe recovery playbooks with human-confirmed automation
- **Scope:** branch/PR/replay/index-refresh playbooks first; later bounded lint/build/test repair suggestions
- **Files likely touched:** playbook engine, PR/release integration, audit events, UI confirmation flows
- **Risks:** over-broad action scope, hidden recovery side effects
- **Tests needed:** playbook trigger/precondition tests, rollback tests, audit tests, actor-boundary tests
- **Acceptance criteria:** approved playbooks can run with clear audit history and no authority expansion beyond configured scope

### A4

- **Goal:** confidence-based escalation and low-risk auto-continue through non-destructive gates
- **Scope:** confidence factors, escalation matrix, freshness auto-refresh, low-risk continuation rules
- **Files likely touched:** confidence/escalation modules, policy versions, UI explanations, settings/config surfaces
- **Risks:** confidence overreach, warning suppression, operator surprise
- **Tests needed:** escalation-matrix tests, confidence-factor tests, forbidden-domain tests, regression tests for high/critical risk
- **Acceptance criteria:** only low-risk, reversible, high-confidence, non-sensitive situations can continue automatically, and all such continuations are audited

### A5

- **Goal:** model-assisted explanations and remediation suggestions
- **Scope:** explain risk rationale and recommend next steps using model assistance, while deterministic rules remain authoritative
- **Files likely touched:** explanation adapters, prompt builders, intelligence UI, audit schema for explanation provenance
- **Risks:** persuasive but incorrect explanations, false operator trust
- **Tests needed:** deterministic-vs-model precedence tests, provenance display tests, failure-mode tests
- **Acceptance criteria:** models can explain and suggest, but never override deterministic risk or escalation decisions

### A6

- **Goal:** configurable autonomy profiles
- **Scope:** conservative, balanced, aggressive staging-only, and production locked-down profiles
- **Files likely touched:** policy/config, profile selection UI, intelligence settings, environment-specific enforcement
- **Risks:** unsafe profile drift, staging assumptions leaking into production
- **Tests needed:** profile-policy tests, environment guard tests, migration tests for policy versions
- **Acceptance criteria:** autonomy profiles can only loosen low-risk behavior where explicitly permitted, while production remains locked down by default

---

## Recommended immediate next phase

**Next phase:** **A1 - deterministic danger-point detector, risk classifier, and run intelligence card**

That phase is the right next step because:

- the raw signals already exist
- the audit surface is strong
- operator UX already has a place to display the result
- it adds interpretation without changing authority

It is the highest-value next step that keeps governance intact.

---

## Final audit conclusion

The Engineering Console does **not** need weaker governance to become more useful. It needs an interpretation layer.

Today it already knows:

- what changed
- what failed
- what passed
- what was reviewed
- what was approved
- what was blocked
- what was deployed
- what was signed off

What it does not yet know is:

- which warnings are routine versus material
- which failures are safely recoverable
- which runs are low-risk and reversible
- when confidence is high enough to reduce operator interruption without weakening governance

That is the exact job of **A1 - Danger Point Interpreter**.
