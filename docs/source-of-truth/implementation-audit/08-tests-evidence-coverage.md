# Tests And Evidence Coverage

## Test Inventory

The repo has broad Vitest coverage and Playwright scripts:

- Unit/service/API tests: `src/lib/engineer-console/**/*.test.ts`.
- E2E scripts: `test:e2e`, `test:e2e:gates`, `test:e2e:auth`, `test:e2e:release` in `package.json`.
- Verification scripts: `verify:ci`, DB backup verification, UI audit (`package.json`).

The discovered test set includes at least 196 `*.test.ts` / `*.spec.ts` files under the repo.

## Coverage By Feature

| Feature | Evidence quality | Supporting code/tests/proofs |
|---|---|---|
| Prototype loop Phase 29A | High | `prototype-loop-v1.ts`, `phase-29a-prototype-loop.ts`, `phase-29a-prototype-loop.test.ts`, `phase-29a-prototype-loop-api.test.ts`, `docs/runtime/phase-29a-prototype-loop-v1-closeout.md`, `evidence/prototype-loop-v1/*` |
| Acceptance threshold engine | High | `acceptance-threshold.ts`, `acceptance-threshold.test.ts`, `docs/runtime/phase-30-acceptance-threshold-engine-v1-closeout.md` |
| Revision/implementation-plan/apply-proposal | High for deterministic prototype path | `prototype-loop-revision.ts`, `prototype-implementation-planning.ts`, `prototype-apply-proposal.ts`, matching tests, `docs/runtime/phase-33`, `phase-38`, `phase-40` |
| Controlled apply | High for isolated deterministic candidate flow | `prototype-controlled-apply.ts`, API/test files, `docs/runtime/phase-43-console-controlled-apply-execution-v1.md`, `evidence/prototype-controlled-apply/*` |
| Integration candidate | High for candidate recording, Low for final integration execution | `prototype-integration-candidate.ts`, tests, `docs/runtime/phase-46-console-production-integration-candidate-v1.md`, `evidence/prototype-integration-candidates/*` |
| Project orchestration | Medium/High | `project-orchestration/*`, tests, APIs under `projects`, `requirements`, `attempts`, `workspaces` |
| Git worktree workspace isolation | High | `execution-workspace-manager.ts`, `controlled-workspace-git.ts`, `execution-workspace-manager.test.ts` |
| Evidence bundles | Medium/High | `governance/evidence-bundles/*`, `docs/evidence-bundles.md`, run routes for evidence bundle/regenerate |
| Release/PR/deployment gates | Medium | Release modules/routes/docs under `docs/architecture/*` and `src/lib/engineer-console/release/*`; needs cross-run proof review |
| Operator UI/status | Medium | UI pages/components and UI tests such as `mainline-runtime-ui.test.ts`; Playwright scripts exist |
| Model routing | Medium | `model-role-routing.ts`, `model-role-routing.test.ts`, runtime docs/evidence |
| Senior/Super/AirLLM | Low/Medium | Proof/candidate tests and evidence under `airllm-*`, `super-*`, `mixtral-airllm-cold-senior/*`; not promoted into mainline policy |
| Cross-repo Vera bridge | Medium | Console endpoint tests plus `Veralux-System` bridge client audit; needs integrated contract test across repos |

## Evidence Docs And Proof Artifacts

Docs:

- `docs/runtime/*` phase closeouts.
- `docs/architecture/*` governed release/deployment phase docs.
- `docs/evidence-bundles.md`
- `docs/review-stages.md`
- `docs/policy-results.md`
- `docs/operator-runbook.md`
- `docs/security-auth.md`
- `docs/hard-release-gates.md`
- `docs/production-readiness-audit.md`

Evidence:

- `evidence/prototype-loop-v1/*`
- `evidence/prototype-implementation-plans/*`
- `evidence/prototype-apply-proposals/*`
- `evidence/prototype-controlled-apply/*`
- `evidence/prototype-integration-candidates/*`
- `evidence/nano-mainline-runtime/*`
- `evidence/mixtral-airllm-cold-senior/*`
- `evidence/airllm-*`, `evidence/super-*`, `evidence/senior-escalation/*`, `evidence/runtime-supervisor/*`

## Features Without Full Proof

- General-purpose Vera build/debug/review loop beyond the fixed CLI prototype.
- Final production integration execution after Phase 46 integration candidate.
- Full cross-repo bridge contract/version compatibility.
- Full upstream evidence rehydration and hash verification in the prototype bridge path.
- Final Role Runtime Policy v1 shared across Vera and Console.
- Senior/Super reviewer promotion into governed runtime.

## Narrow/Demo-Only Tests

- Prototype-loop tests verify deterministic tiny CLI behavior rather than arbitrary coding.
- Mainline runtime tests around `mainline-runtime/*` are proof/demo oriented.
- AirLLM/Super tests prove environment/probes/candidates, not stable production reviewer routing.

## Docs Claiming Future Behavior

- `docs/runtime/phase-46-console-production-integration-candidate-v1.md` explicitly says no branch, PR, commit, deployment, or production integration executor is created and final approval/execution remains future.
- `docs/runtime/phase-30-acceptance-threshold-engine-v1-closeout.md` explicitly says broader merge/deploy/production readiness surfaces still use existing governance-specific readiness models.
