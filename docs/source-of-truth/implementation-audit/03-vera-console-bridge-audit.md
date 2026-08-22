# Vera-To-Console Bridge Audit

## Verdict

Console-side bridge support for Vera is implemented for the prototype-loop chain. The bridge validates required fields and safety flags, writes evidence, and returns Vera-facing summaries. It is not a standalone versioned cross-repo contract package, and downstream phases generally trust caller-supplied lineage fields rather than rehydrating all upstream evidence artifacts.

## Bridge Endpoints

| Endpoint | File | Purpose |
|---|---|---|
| `POST /api/engineer-console/prototype-loop/phase-29a` | `src/app/api/engineer-console/prototype-loop/phase-29a/route.ts` | Run fixed prototype loop |
| `POST /api/engineer-console/prototype-loop/revision` | `src/app/api/engineer-console/prototype-loop/revision/route.ts` | Run prototype revision |
| `POST /api/engineer-console/prototype-loop/implementation-plan` | `src/app/api/engineer-console/prototype-loop/implementation-plan/route.ts` | Create implementation plan artifact |
| `POST /api/engineer-console/prototype-loop/apply-proposal` | `src/app/api/engineer-console/prototype-loop/apply-proposal/route.ts` | Create apply proposal artifact |
| `POST /api/engineer-console/prototype-loop/controlled-apply` | `src/app/api/engineer-console/prototype-loop/controlled-apply/route.ts` | Materialize controlled apply workspace/evidence |
| `POST /api/engineer-console/prototype-loop/integration-candidate` | `src/app/api/engineer-console/prototype-loop/integration-candidate/route.ts` | Materialize integration candidate workspace/evidence |

Each route calls `ensureEngineerConsoleReady()` and `authorizeMutation()` with operator role (`src/app/api/engineer-console/prototype-loop/*.ts`, `src/lib/engineer-console/security/route-guards.ts`).

## Contracts / Schemas

Contracts are represented as TypeScript request/result interfaces in service files:

- `Phase29ABuildSpec` and `Phase29APrototypeLoopResult` (`phase-29a-prototype-loop.ts`).
- `PrototypeControlledApplyRequest/Result/Evidence` (`prototype-controlled-apply.ts`).
- `PrototypeIntegrationCandidateRequest/Result/Evidence` (`prototype-integration-candidate.ts`).

No standalone versioned NPM/shared contract package was found. Evidence schema versions are present in generated evidence objects, e.g. `veralux-console-prototype-controlled-apply/v1` and `veralux-console-prototype-integration-candidate/v1`.

## Validation And Trust Boundary

Implemented validation:

- Required ids/paths.
- Required readiness/check flags.
- Approval/integration flags.
- Safety constraints.
- Mutating or bypass intent patterns.
- Safe generated ids and child-path guards for new workspace/evidence paths.

Evidence:

- `validateControlledApplyRequest()` in `prototype-controlled-apply.ts`.
- `validateIntegrationCandidateRequest()` in `prototype-integration-candidate.ts`.

Important limitation:

- Controlled apply and integration candidate accept lineage ids and evidence paths from the request. They validate presence and flag consistency, but this audit did not find full upstream evidence rehydration/hash verification for every caller-supplied lineage artifact in the prototype bridge path.
- Prototype revision handling is stronger than later prototype phases because it reads parent evidence and checks ids/safety state before producing revision output (`src/lib/engineer-console/prototype-loop/prototype-loop-revision.ts`).

## Broader Vera Bridge

Beyond the prototype-loop API family, the repo has a production-oriented Vera bridge under:

- `src/app/api/engineer-console/runs/[id]/request-vera-execution-approval/route.ts`
- `src/app/api/engineer-console/runs/[id]/start-vera-execution/route.ts`
- `src/app/api/engineer-console/runs/[id]/vera-implementation-artifact-review/route.ts`
- `src/app/api/engineer-console/runs/[id]/vera-implementation-patch-proposal/route.ts`
- `src/app/api/engineer-console/runs/[id]/vera-implementation-patch-proposal-review/route.ts`
- `src/app/api/engineer-console/runs/[id]/apply-vera-patch-proposal/route.ts`
- `src/app/api/engineer-console/runs/[id]/vera-patch-content-draft/route.ts`
- `src/app/api/engineer-console/runs/[id]/vera-patch-content-draft-review/route.ts`
- `src/app/api/engineer-console/runs/[id]/apply-approved-vera-patch-content-draft/route.ts`
- `src/app/api/engineer-console/runs/[id]/run-vera-post-patch-quality-gates/route.ts`

Supporting code lives in `src/lib/engineer-console/bridge/*`, `src/lib/engineer-console/worker/*`, `src/lib/engineer-console/vera-executor/*`, and `src/lib/engineer-console/orchestrator/vera-implementation-run-pipeline.ts`.

This broader bridge appears stronger than the prototype bridge for evidence and mutation safety: it rehydrates run/task/governance state, checks artifact existence and hashes, blocks duplicate decisions, checks audit history for forbidden commit/PR/merge/deploy events, validates patch paths, and applies approved patch content to governed worktrees rather than the main checkout.

## Candidate Creation

Controlled apply:

- Creates `.controlled-apply/<controlled-apply-id>/`.
- Writes manifest and deterministic candidate files.
- Runs `node --check` and `node --test`.
- Writes evidence under `evidence/prototype-controlled-apply/<id>.json`.
- Keeps integration/merge/deploy/PR/production mutation false.

Evidence: `src/lib/engineer-console/prototype-loop/prototype-controlled-apply.ts`.

Integration candidate:

- Creates `.integration-candidates/<integration-candidate-id>/`.
- Writes manifest, intended target metadata, deterministic candidate files.
- Runs scoped checks.
- Writes evidence under `evidence/prototype-integration-candidates/<id>.json`.
- Marks final integration approval required and all production mutation flags false.

Evidence: `src/lib/engineer-console/prototype-loop/prototype-integration-candidate.ts`, `docs/runtime/phase-46-console-production-integration-candidate-v1.md`.

## Vera-Side Dependencies

Requires `Veralux-System` for:

- Vera task routing.
- Vera BFF endpoints.
- Bridge client.
- Operator UI.
- Vera-side validation/summarization of Console response.

Evidence in prior audit: `Veralux-System/docs/source-of-truth/implementation-audit/04-engineering-console-bridge-audit.md`.

## Tests

- `prototype-integration-candidate-api.test.ts`
- `prototype-integration-candidate.test.ts`
- `prototype-controlled-apply-api.test.ts`
- `prototype-controlled-apply.test.ts`
- `prototype-apply-proposal-api.test.ts`
- `prototype-apply-proposal.test.ts`
- `prototype-implementation-planning-api.test.ts`
- `prototype-implementation-planning.test.ts`
- `phase-29a-prototype-loop-api.test.ts`

## Gaps

- No frozen external bridge contract artifact found.
- Later prototype bridge phases do not appear to re-read/hash all upstream evidence artifacts before accepting caller lineage.
- The candidate content is deterministic/narrow.
- Final production integration execution is intentionally absent from the prototype bridge.
