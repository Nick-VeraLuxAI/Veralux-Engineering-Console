# Scorecard Readiness Report

## Summary

This repo is ready for several subsystem scorecards, but not final cross-repo completion scoring. The key blockers are bridge contract freezing, full evidence rehydration rules, final integration execution boundaries, and Role Runtime Policy v1.

No percentages are assigned in this report.

## Scorecards That Can Be Created Now

| Subsystem | Readiness | Basis |
|---|---|---|
| Prototype-loop governance foundation | Ready | Code/tests/evidence/docs exist for Phase 29A and follow-on prototype phases. |
| Acceptance threshold engine | Ready | Central code and tests exist; limitations are explicit. |
| Prototype controlled apply and integration candidate | Ready with narrow scope | Deterministic isolated candidate flows are implemented and tested. |
| Project orchestration foundation | Ready for first-pass scorecard | Code/tests/routes exist for projects, requirements, attempts, workspaces. |
| Evidence bundle foundation | Ready | Hash/redaction/persistence code exists. |
| Operator UI/status visibility | Ready for first-pass scorecard | UI routes/components/tests/scripts exist. |
| Runtime/model routing foundation | Ready for gap scorecard | Role routing exists but policy is incomplete. |

## Scorecards Requiring Cross-Repo Evidence

| Subsystem | Required external evidence |
|---|---|
| Vera-to-Console bridge | `Veralux-System` bridge client, Vera routes/UI, request/response contract tests |
| Approval-before-integration | Vera user approval UX, Console candidate response handling, final production integration decision path |
| Role Runtime Policy v1 | `Veralux-System` model registry/routing and Console model routing consolidation |
| Governed builder loop end-to-end | Vera task classification to Console execution to Vera summary to user approval |
| Evidence lineage end-to-end | Vera evidence ids/paths to Console evidence artifacts and back to Vera UI |

## Sufficiency By Requested Area

| Requested area | Is this repo sufficient to score alone? | Notes |
|---|---|---|
| Engineering Console governance foundation | Mostly yes | Task/run, gates, evidence, audit ledger, release controls, workspaces exist. |
| Vera-to-Console bridge | No | Console side exists; Vera side and cross-repo contract need `Veralux-System`. |
| Governed builder loop | Partially | Fixed prototype path is strong; general build/debug/review loop is not proven. |
| Evidence/lineage/workspace hardening | Partially | Strong inside Console; bridge lineage rehydration needs more proof. |
| Approval-before-integration | Partially | Strong for prototype/candidate no-mutation flags; final integration approval path not implemented in prototype chain. |
| Runtime/model/senior review policy | No | Local routing exists but shared runtime policy is incomplete. |
| Operator UI/status visibility | Mostly yes | UI exists; final scorecard should inspect browser/e2e proof freshness. |

## Highest-Confidence Areas

- Prototype loop readiness and evidence generation.
- Acceptance threshold gates.
- No-main-tree mutation for prototype controlled apply/candidate phases.
- Task/run persistence and quality gate storage.
- Git worktree workspace metadata/path/hash foundation.
- Evidence bundle hashing/redaction/persistence.

## Lowest-Confidence / Most Ambiguous Areas

- General arbitrary coding loop.
- Cross-repo Vera bridge contract enforcement.
- Upstream evidence rehydration/hash verification.
- Final production integration after candidate creation.
- Senior reviewer runtime readiness.
- Shared role/model policy across Vera and Console.

## Blocking Questions Before Scorecards Freeze

1. Is the denominator for “governed builder loop” the Phase 29A prototype path, the project-orchestration worktree path, or both?
2. What is the canonical Vera-to-Console contract artifact and version?
3. Should Console reject bridge requests unless it can rehydrate and hash-verify every upstream evidence path?
4. Which repo owns final integration approval and production mutation after Phase 46?
5. Are `.controlled-apply` and `.integration-candidates` folder workspaces sufficient, or must prototype bridge phases use git worktrees?
6. Which checks are required for each task class: tests, lint, typecheck, build, secret scan, scope scan, policy review?
7. What exact statuses should Vera display for blocked/failed/degraded Console runs?
8. Should project-orchestration worktree execution replace the deterministic prototype-loop path for real build tasks?
9. What models are allowed per role, and what approvals are required for cloud/fallback/senior use?
10. Does the approval model require distinct approver/executor RBAC identities, or are phase validators plus admin-gated review actions sufficient?
11. What smoke/browser evidence must be current before a subsystem can be scored as operational?

## Recommended Next Step

Create a cross-repo source-of-truth merge document that aligns:

- `Veralux-System/docs/source-of-truth/implementation-audit/04-engineering-console-bridge-audit.md`
- This repo’s `03-vera-console-bridge-audit.md`
- This repo’s `02-governed-builder-loop-audit.md`
- This repo’s `06-runtime-model-senior-review-audit.md`

The merge should freeze a denominator for: Vera intake, Console execution, evidence/lineage, user approval, integration, and runtime policy.
