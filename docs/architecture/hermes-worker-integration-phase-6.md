# Hermes worker integration (Phase 6)

Engineering Console prepares and optionally **exports** a bounded Hermes worker run packet for a governed run. VeraLux OS does not call Hermes. Hermes does not become source-of-truth and does not record sign-off.

## Roles

| Layer | Responsibility |
|--------|----------------|
| VeraLux OS | Create engineering requests; read status/evidence only |
| Engineering Console | Task, run, worker plan, repo/path/command policy, evidence, sign-off, audit |
| Hermes | External worker runtime (file handoff in this phase) |

## Phase 6 scope (safe / bounded)

- **Prepare** — Build `hermes-run-packet/v1`, persist dispatch row, packet hash snapshot, evidence placeholder, audit events.
- **Dispatch (export)** — Write packet JSON to Hermes inbox (`ENGINEER_CONSOLE_HERMES_INBOX` or `~/.hermes/inbox/engineering-console`). **No Hermes process invocation. No shell execution in Console for Hermes.**
- **UI** — Run page: “Prepare Hermes run” and “Dispatch to Hermes (export packet)” only in Engineering Console.

## Packet contents

- Task title and instructions (from task + worker plan summary)
- Target repo (Console-validated path), branch/worktree policy
- Allowed paths (from validated worker plan `allowedFiles` + operation paths)
- Forbidden paths (global Console deny list)
- Allowed commands (quality-gate commands only: `npm test`, `npm run build`, `npm run lint`, `npm run typecheck`)
- Expected quality gates
- Evidence placeholder path (Console-managed; Hermes output is **evidence input only**)

## Preconditions

1. Engineering Console **run** exists.
2. Latest **worker plan** is `validation_status = valid`.
3. Repository path passes `ENGINEER_CONSOLE_REPO_ROOTS` policy.

## API

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/engineer-console/runs/{id}/hermes-worker` | List dispatches |
| POST | `/api/engineer-console/runs/{id}/hermes-worker/prepare` | Prepare packet + DB + audit |
| POST | `/api/engineer-console/runs/{id}/hermes-worker/dispatch` | Export to inbox (`{ dispatchId? }`) |

## Audit

- `HERMES_RUN_PACKET_PREPARED` — payload includes `packetHash`, `workerPlanId`, path/command counts
- `HERMES_EVIDENCE_PLACEHOLDER_CREATED` — placeholder path
- `HERMES_RUN_DISPATCHED` — export path and hash (export-only)

## Environment

| Variable | Purpose |
|----------|---------|
| `ENGINEER_CONSOLE_HERMES_INBOX` | Directory for exported packet JSON files |
| `ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR` | Root for evidence placeholders (default: beside DB) |

## Explicit non-goals (this phase)

- VeraLux OS Hermes buttons or runners
- Hermes executing inside Console
- Merge, deploy, or Hermes sign-off
- Bypassing Console gates or re-enabling OS code runners

## Future phase

When Hermes runtime contract is stable, Console may call a Hermes adapter that **consumes** the same packet and writes only to the evidence placeholder—still without making Hermes source-of-truth.
