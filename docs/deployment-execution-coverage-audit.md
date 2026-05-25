# Deployment Execution Coverage Audit (Phase 8B.5)

**Date:** 2026-05-23  
**Scope:** Controlled deployment execution only (no new strategies, rollback, health checks, GH Actions triggers, cloud APIs, arbitrary shell, or model execution).

## 1. Executive summary

Phase 8B.5 audited the deployment execution surface end-to-end: profile configuration, readiness gates, command execution, authorization, output redaction, audit/evidence/replay integration, API routes, UI panel, and tests.

**Verdict: PASS with targeted hardening applied.**

The system is **admin-only**, **profile-gated**, **fail-closed**, and uses **`spawn` with `shell: false`**. Full stdout/stderr is not persisted; summaries are redacted and hashed. Deployment does not run from approval alone.

### Gaps found and fixed in 8B.5

| Gap | Fix |
|-----|-----|
| `github_actions_future` profiles could not be loaded for visibility; parse rejected them entirely | Profiles with `github_actions_future` now load with `enabled: false` (`allowed` forced false) |
| Duplicate execution race between readiness check and spawn | Re-check succeeded/running execution for same approval immediately before `running` status |
| Redaction missing `authorization`, `cookie`, `private_key` patterns | Added patterns in `redact-deployment-output.ts` |
| No dedicated `spawn` safety test | Added `execute-deployment-profile.spawn.test.ts` |
| Test coverage gaps for disabled/unknown/future profiles, viewer auth, DB redaction, failure audit | Expanded `deployment-execution.test.ts` |

## 2. Profile safety coverage

| Control | Status |
|---------|--------|
| Profiles loaded only from `ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON` (server env) or test override | Pass |
| Client cannot supply command, args, workingDirectory, timeout, strategy | Pass — POST body accepts only `deploymentApprovalId`, `deploymentProfile` |
| Public profile API exposes metadata only (`name`, `environmentName`, `strategy`, `enabled`) | Pass — `GET /api/engineer-console/deployment/profiles` |
| Disabled profiles cannot execute | Pass — `allowed: false` + `resolveExecutableDeploymentProfile` |
| Profile environment must match approval environment | Pass — readiness + manager |
| Unknown profile fails closed | Pass |
| `github_actions_future` cannot execute | Pass — `allowed` forced false; strategy blocked at execute |
| No default profiles unless env configured | Pass — empty array when env unset |

## 3. Command execution safety coverage

| Control | Status |
|---------|--------|
| `spawn(command, args, { shell: false })` | Pass — verified in code and spawn unit test |
| No `shell: true` in engineer-console | Pass — static search |
| No string-built shell commands | Pass |
| No user-entered command strings | Pass |
| Timeout enforced | Pass — profile `timeoutMs`, SIGTERM on expiry |
| Working directory profile-controlled | Pass |
| Exit code captured | Pass |
| Failed/succeeded status persisted | Pass |
| Duplicate successful execution blocked | Pass — readiness + pre-run re-check |
| No automatic rollback | Pass |
| No deploy from approval alone | Pass — requires `createDeploymentExecution` |

## 4. Authorization coverage

| Control | Status |
|---------|--------|
| GET profiles / executions: viewer+ (`authorizeRead`) | Pass |
| POST execution: admin (`authorizeMutation`, `minRole: "admin"`) | Pass |
| Operator cannot execute | Pass — tested |
| Viewer cannot execute | Pass — tested |
| Unauthenticated blocked when auth enabled | Pass — route guards |
| CSRF/same-origin on POST | Pass — `authorizeMutation` |
| Authenticated actor overrides client `actorLabel` | Pass — `resolveHumanActor` |
| Models cannot execute | Pass — `AUDIT_ACTOR_TYPES.MODEL` rejected in manager |

## 5. Readiness gate coverage

`evaluateDeploymentExecutionReadiness` blocks when:

| Gate | Status |
|------|--------|
| No / wrong approval | Pass |
| Approval not `approved` / rejected | Pass |
| Readiness check blocked | Pass |
| Missing merge request / not merged / no merge SHA | Pass |
| Missing evidence bundle | Pass |
| Policy blocked | Pass |
| Replay missing or failed | Pass |
| Review stages pending/rejected | Pass |
| Environment inactive | Pass |
| Profile mismatch / disabled / unknown / non-executable strategy | Pass |
| Prior successful execution for approval | Pass |

`createDeploymentExecution` re-evaluates readiness before insert/run.

## 6. Output redaction coverage

| Control | Status |
|---------|--------|
| Full stdout/stderr not stored in DB | Pass — in-memory only during run |
| Summary truncated (800 chars) | Pass |
| SHA-256 output hash stored | Pass |
| Secret-like patterns redacted | Pass — token, api_key, password, secret, authorization, cookie, private_key, bearer, PEM keys |
| API public shape excludes command/args/raw logs | Pass — `toPublicDeploymentExecution` |
| Evidence bundle summary counts/status only | Pass |
| Replay package: id, status, profile, exitCode, hash prefix only | Pass |
| Audit payloads: no full logs; message capped | Pass |

## 7. Audit / evidence / replay coverage

| Event | Status |
|-------|--------|
| `DEPLOYMENT_EXECUTION_STARTED` | Pass |
| `DEPLOYMENT_EXECUTION_SUCCEEDED` | Pass |
| `DEPLOYMENT_EXECUTION_FAILED` | Pass — non-zero exit and timeout |
| Audit payload free of secrets/full logs | Pass |
| Evidence refreshed after execution | Pass |
| Replay includes execution summary | Pass |
| Execution history append-only (status updates on same row only) | Pass — by design |

## 8. Forbidden-pattern search results

Searched `src/lib/engineer-console/release/deployment-execution/` and deployment execution call sites:

| Pattern | Result |
|---------|--------|
| `shell: true` | None |
| `exec(` / `execSync(` | None (only `ControlledDeploymentExecutor.exec` method name) |
| `gh workflow run` | None |
| `kubectl` | None |
| Cloud provider SDK deploy calls | None |
| `createDeploymentExecution` outside API route + tests | None |

## 9. UI and API surface (Stage 0)

- **Module:** `src/lib/engineer-console/release/deployment-execution/`
- **API:** `deployment/profiles`, `runs/[id]/deployment-executions` (GET/POST)
- **UI:** `deployment-execution-panel.tsx` — profile selector, approval selector, execute (admin), history
- **Docs:** `docs/deployment-execution.md`, `docs/deployment-gates.md` (cross-link)

## 10. Tests added/updated

- `deployment-execution.test.ts` — disabled/unknown/future profiles, viewer 403, DB redaction, failure audit events, client cannot override command
- `execute-deployment-profile.spawn.test.ts` — `shell: false` and args array

Required scenario checklist: **all 15 covered**.

## 11. Verification

| Command | Result |
|---------|--------|
| `npm test` | **262 passed** (32 files), including 25 deployment-execution tests |
| `npm run build` | **Success** (Next.js 15.5.18) |
| `git status --short` | 5 modified + 2 new files (audit doc + spawn test) |

## 12. Remaining limitations

- **Concurrent POST race:** Two admins could still insert two `pending` rows; pre-run check blocks second `running`/duplicate success but does not use DB-level unique constraint.
- **`command_label` in DB:** Internal operator diagnostic; not exposed via public API.
- **In-memory log cap (64KB):** Process output truncated before redaction/hash; sufficient for summary, not a full log archive.
- **Profile config errors:** Invalid `ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON` throws at load time (fail-fast).
- **No deployment strategies beyond `fixed_command`** in this phase.

## 13. Recommended next phase

**Phase 8C — Post-deploy verification (optional):** health/readiness probes *after* controlled execution, still without arbitrary shell or model-triggered deploys. Alternatively **Phase 9 — External CI integration** with explicit `github_actions_future` workflow dispatch behind the same approval/readiness gates (still no client-supplied commands).
