# Engineering Console Architecture Map

## Audit Object

This audit covers `Veralux-Engineering-Console` as the governed execution/build layer for the VeraLux ecosystem. It uses prior source-of-truth docs from `Veralux-Observational-Layer` and `Veralux-System` as context, especially the conclusion that `Veralux-System` owns Vera-side routing/bridge UI while this repo owns Console-side execution evidence and workspaces.

## Stack And Entry Points

- Next.js app with React 19, `better-sqlite3`, Vitest, Playwright, TypeScript (`package.json`).
- Main UI pages live under `src/app/(main)/engineer/*`.
- API routes live under `src/app/api/engineer-console/**`.
- Core domain code lives under `src/lib/engineer-console/**`.
- Operational evidence artifacts are committed under `evidence/**`.
- Runtime/architecture closeout docs live under `docs/runtime/**` and `docs/architecture/**`.

Confidence: High.

## High-Level Architecture

| Layer | Purpose | Evidence |
|---|---|---|
| UI | Engineer dashboard, projects, tasks, runs, repos, compatibility | `src/app/(main)/engineer/page.tsx`, `src/app/(main)/engineer/projects/page.tsx`, `src/app/(main)/engineer/runs/[id]/page.tsx` |
| API | Console task/run/project/prototype/bridge/workspace/release endpoints | `src/app/api/engineer-console/**/route.ts` |
| DB/storage | SQLite initialization, schema patches, row mappers | `src/lib/engineer-console/db/init.ts`, `src/lib/engineer-console/db/schema-patches.ts` |
| Task/run management | Create/list/update tasks and runs, quality gates, approval reports | `src/lib/engineer-console/task-manager/task-manager.ts`, `src/lib/engineer-console/run-manager/run-manager.ts` |
| Prototype loop | Deterministic Phase 29A tiny CLI prototype and follow-on controlled-apply/integration-candidate flows | `src/lib/engineer-console/prototype-loop/*` |
| Acceptance gates | Readiness/approval decision from tests, scope, secrets, evidence, approval, role, fallback, senior, workspace | `src/lib/engineer-console/prototype-loop/acceptance-threshold.ts` |
| Project orchestration | Requirement attempts, worker assignment, worktree workspace handling, retry/escalation | `src/lib/engineer-console/project-orchestration/*` |
| Workspace isolation | Git worktrees, detached/candidate/integration workspaces, path claims, hashes | `src/lib/engineer-console/project-orchestration/execution-workspace-manager.ts`, `controlled-workspace-git.ts` |
| Evidence bundles | Redacted/hashable persisted run evidence bundle | `src/lib/engineer-console/governance/evidence-bundles/*` |
| Model/runtime | Model role routing, Nemotron Nano defaults, senior/Super/AirLLM experiments, runtime supervisor | Historical path `model-routing/model-role-routing.ts` is gone; live policy is `docs/source-of-truth/local-model-runtime-strategy.md` plus `src/lib/engineer-console/model-router/local-model-runtime-strategy.ts`. Super/AirLLM stub remains experimental. |
| Docs/evidence | Phase closeouts, runtime proofs, audits, runbooks | `docs/runtime/*`, `docs/architecture/*`, `evidence/**` |

## Major Subsystems Found

- Governed prototype/build loop: implemented but narrow/fixed around a tiny word-count CLI proof (`src/lib/engineer-console/prototype-loop/phase-29a-prototype-loop.ts`).
- Vera-to-Console prototype bridge endpoints: implemented under `src/app/api/engineer-console/prototype-loop/*`.
- Controlled apply and integration candidate: implemented as deterministic isolated workspace/candidate flows (`prototype-controlled-apply.ts`, `prototype-integration-candidate.ts`).
- Acceptance threshold engine: implemented and tested (`acceptance-threshold.ts`, `acceptance-threshold.test.ts`).
- Project orchestration/worktree execution: implemented separately from the narrow prototype-loop path (`project-orchestration/*`).
- Evidence bundles/governance artifacts: implemented (`governance/evidence-bundles/*`).
- Model role routing: implemented as role config/routing, but not a fully productionized Role Runtime Policy v1 (`model-role-routing.ts`).
- Senior/Super/AirLLM: present as experiments/proofs/candidates; senior remains blocked or unproven in key paths (`model-role-routing.ts`, `docs/runtime/*`, `evidence/mixtral-airllm-cold-senior/*`).

## Architecture Conclusions

**Autonomous Engineer V1 override:** the live mutation substrate is worker-plan + QC. The Autonomous Engineer loop lives in `src/lib/engineer-console/autonomous-engineer/`. Isolated execution uses per-run git worktrees in `src/lib/engineer-console/workspace/run-worktree.ts`. Canonical UI is `/engineer`, `/engineer/tasks/[id]`, `/engineer/runs/[id]`.

The rows above that cite `prototype-loop/*`, `project-orchestration/*`, and `/engineer/projects` are **historical audit claims**. Those modules/routes are not present under `src/` as AE backends and must not be treated as the current control plane. See `docs/source-of-truth/autonomous-engineer-v1.md`.

- The Console has two execution stories: a narrow, live-proven Vera prototype loop and a broader project-orchestration/worktree system. Confidence: High. **Drift:** Vera remains a separate path; AE uses worker-plan, not prototype-loop or project-orchestration.
- The Vera bridge currently targets prototype-loop endpoints with deterministic candidate content; it is not a generic build/debug/review execution interface. Confidence: High.
- Evidence and workspace hardening are real code, including hashes/redaction/worktree path guards. Confidence: High for the project orchestration layer; Medium for the prototype bridge because it relies heavily on caller-supplied lineage rather than rehydrating upstream evidence.
- Full production integration execution after integration candidate remains outside the current Vera prototype path. Confidence: High (`docs/runtime/phase-46-console-production-integration-candidate-v1.md`).
