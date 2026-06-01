# Hermes post-apply quality gates (Phase 10)

Phase 10 lets **Engineering Console** run **allowlisted quality gates** after a Hermes patch has been applied, capturing stdout/stderr and structured results as evidence.

## What this adds

- `POST /api/engineer-console/runs/{id}/hermes-worker/quality-gates/run`
- Gate IDs mapped to fixed `npm` invocations (`execFile`, **no shell**)
- Evidence artifacts under `{evidence}/quality-gates/{gateId}/`
- DB table `engineer_hermes_quality_gate_runs`
- Hermes worker panel UI: gate selection, required reason, per-gate results
- Bridge summary field `hermesPostApplyQualityGates`

## Ownership

| Actor | Post-apply gates |
|--------|------------------|
| Engineering Console | Validates, executes, records evidence |
| Hermes | No gate execution |
| VeraLux OS | Not involved |

## Eligibility

Gates run only when:

- Run exists with a **valid** worker plan
- Hermes patch application status is **`applied`** (not rolled back)
- Repo is registered and matches the packet
- Requested `gateId` is allowlisted in the packet `allowedCommands`
- Operator provides `approved: true` and a non-empty **reason**

## Command policy

| Gate ID | Fixed command | Invocation |
|---------|---------------|------------|
| `test` | `npm test` | `npm` + `["test"]` |
| `build` | `npm run build` | `npm` + `["run","build"]` |
| `lint` | `npm run lint` | `npm` + `["run","lint"]` |
| `typecheck` | `npm run typecheck` | `npm` + `["run","typecheck"]` |

Rejected: arbitrary strings, shell metacharacters, `git commit/push/merge`, `deploy`, `rm`, installs, etc.

If a script is missing from `package.json`, the gate is recorded as **skipped**.

## Evidence artifacts

Per gate:

- `quality-gates/{gateId}/stdout.log`
- `quality-gates/{gateId}/stderr.log`
- `quality-gates/{gateId}/result.json`

Batch summary: `quality-gates/batch-{batchId}-summary.json`

## Audit events

- `HERMES_QUALITY_GATES_REQUESTED`
- `HERMES_QUALITY_GATE_STARTED`
- `HERMES_QUALITY_GATE_PASSED` / `HERMES_QUALITY_GATE_FAILED`
- `HERMES_QUALITY_GATES_COMPLETED`

## Not sign-off

`notSignOff: true` on API responses and summaries. Passing gates does **not**:

- Approve the run
- Create engineering sign-off
- Mark merge or deploy ready
- Complete the run
- Roll back on failure

## Out of scope (Phase 10)

- VeraLux OS execution
- Hermes running gates
- Arbitrary operator-defined commands
- Auto-approval / auto-merge / auto-deploy
- Auto-rollback on gate failure

## Phase 11 recommendation

- Formal engineering sign-off workflow referencing patch apply + gate evidence
- Optional PR creation still governed separately by Console release controls
