# Deployment Health Policy Coverage Audit (Phase 8D.5)

**Date:** 2026-05-23  
**Scope:** Deployment health policy evaluation only (no rollback, deployment execution, GitHub Actions, cloud APIs, alerting, auto-polling, model-triggered actions, or hard release-completion gate).

## 1. Executive summary

Phase 8D.5 audited the deployment health policy surface end-to-end: policy definition, deterministic evaluation, hashing, manager persistence, auto-evaluation hooks, evidence/replay/audit integration, API routes, UI panel, documentation, and tests.

**Verdict: PASS with targeted hardening applied.**

Policy evaluation is **read-only over database state**, **deterministic**, **redacted at persist and API boundaries**, and **operator-gated** for mutation. Production deploys without a health check map to **`needs_attention`** (stricter than staging **`not_checked`**).

### Gaps found and fixed in 8D.5

| Gap | Fix |
|-----|-----|
| POST returned full internal `evaluation` object | POST now returns `{ ok, result }` only (public shape) |
| `result_json` persisted raw evaluation strings without redaction pass | `toStorableDeploymentHealthPolicyEvaluation()` allowlists fields and redacts warnings/blockers/recommendedAction |
| Policy history ordering could tie on `evaluatedAt` | Persist uses distinct `created_at` via `nowIso()` |
| Failed/non-succeeded execution by id mapped to generic “no execution” | Explicit `not_checked` + warning when execution exists but is not `succeeded` |
| Auth tests missing session secret env | Tests set `ENGINEER_CONSOLE_AUTH_ENABLED` + `SESSION_SECRET` like health-check suite |
| Audit failure path under-tested | Test with `refreshRunEvidenceBundle` failure asserts `DEPLOYMENT_HEALTH_POLICY_FAILED` |
| Staging no-check warning, pending/running, auth, storage leakage tests thin | Expanded `deployment-health-policy.test.ts` |

## 2. Determinism coverage

| Control | Status |
|---------|--------|
| Evaluation pure/read-only over DB | Pass — `evaluateDeploymentHealthPolicy` uses execution + health check lists only |
| No external URLs | Pass — no `fetch` in policy module (static source test) |
| No shell/commands | Pass — forbidden-pattern search clean |
| Policy hash deterministic | Pass — `hashDeploymentHealthPolicyDefinition` stable SHA-256 |
| Policy version stored per result | Pass — `policy_version` + `policy_hash` columns |
| Result JSON deterministic for auditing | Pass — storable allowlist + ISO `evaluatedAt` |
| No full health response body | Pass — evaluator never reads `output_summary` |
| No secrets in stored evaluation | Pass — redaction on persist; DB leakage test |
| Production no health check documented + tested | Pass |
| Staging no health check documented + tested | Pass |

## 3. Status mapping coverage

| Scenario | Expected | Status |
|----------|----------|--------|
| No successful deployment | `not_checked` | Pass |
| Staging success, no health check | `not_checked` + warning | Pass |
| Production success, no health check | `needs_attention` + warning | Pass |
| Latest `healthy` | `healthy` | Pass |
| Latest `unhealthy` | `unhealthy` + blocker | Pass |
| Latest `failed` | `needs_attention` + warning | Pass |
| `pending` / `running` | `needs_attention` | Pass |
| Non-succeeded execution by id | `not_checked` + status warning | Pass (8D.5) |
| Unknown check status | `needs_attention` | Pass — default branch |

## 4. Authorization coverage

| Control | Status |
|---------|--------|
| GET: viewer+ | Pass — `authorizeRead` |
| POST: operator+ | Pass — `authorizeMutation` minRole operator |
| Viewer cannot evaluate | Pass — 403 on mutation guard test |
| Unauthenticated blocked when auth on | Pass — route guards |
| CSRF/same-origin on POST | Pass — `authorizeMutation` |
| Authenticated actor overrides client `actorLabel` | Pass — `resolveHumanActor` in route |
| Models cannot evaluate | Pass — manager rejects `MODEL` actor |

## 5. Integration coverage

| Control | Status |
|---------|--------|
| Auto-eval after successful deployment | Pass — dynamic import in `deployment-execution-manager.ts` (wiring test + behavioral simulate test) |
| Auto-eval after health check completes | Pass — dynamic import in `deployment-health-check-manager.ts` |
| Failed auto-eval audited | Pass — `DEPLOYMENT_HEALTH_POLICY_FAILED` on inner failure |
| Evidence bundle includes policy summary | Pass |
| Replay package includes policy summary | Pass |
| API returns latest + history | Pass — GET `{ latest, history }` |
| UI displays latest + history | Pass — `deployment-health-policy-panel.tsx` |
| Result history append-only | Pass — INSERT-only persistence |

## 6. Redaction / storage coverage

| Control | Status |
|---------|--------|
| Result JSON: no full body | Pass |
| Result JSON: secrets redacted on persist | Pass — `toStorableDeploymentHealthPolicyEvaluation` |
| Evidence summary: status/metadata only | Pass |
| Replay: no body/secrets | Pass |
| Audit payloads: no body/secrets | Pass |
| API: no unsafe profile URL/config | Pass — public shape uses profile name, not URL |
| Secret-like patterns redacted | Pass — shared `redactDeploymentOutput` |

## 7. Forbidden-pattern search results

Searched `src/lib/engineer-console/release/deployment-health-policy/`:

| Pattern | Result |
|---------|--------|
| `fetch(` | None |
| `child_process` / `exec` / `spawn` / `shell` | None |
| `rollback` / `gh workflow` / `kubectl` | None |
| Cloud SDK / direct deployment execution | None |
| Model-triggered policy actions | Blocked in manager |

## 8. Tests added/updated

`deployment-health-policy.test.ts` — expanded from **12** to **23** cases covering:

1. No deployment → `not_checked`
2. Staging no health check → `not_checked` + warning
3. Production no health check → `needs_attention` + warning
4. Healthy → `healthy`
5. Unhealthy → `unhealthy` + blocker
6. Failed → `needs_attention`
7. Running / pending → `needs_attention`
8. Stable policy hash
9. Append-only history
10. Post-deploy then post-check auto-eval simulation
11. Manager wiring to execution + health check
12. Evidence/replay summary only
13. API public shape / no body fields
14. `result_json` excludes health check `output_summary` secrets
15. Viewer blocked / operator allowed (mutation guards)
16. Audit evaluated + failed events
17. Models blocked
18. Evaluator source: no fetch/shell/HTTP probe imports

New module: `sanitize-deployment-health-policy-evaluation.ts`.

## 9. Verification

| Command | Result |
|---------|--------|
| `npm test` | **311 passed** (35 files), including 23 deployment health policy tests |
| `npm run build` | **Success** (Next.js 15.5.18) |
| `git status --short` | 5 modified + 2 new files (audit doc + sanitize module) |

## 10. Remaining limitations

- Policy is **not** a hard release-completion gate (by design for 8D.5)
- No alerting, auto-polling, or rollback
- Auto-eval failures on missing run throw before audit (expected — run must exist)
- Latest health check per execution is first match in DESC list (same as 8C)
- Invalid historical DB statuses fall through to `needs_attention` with warning

## 11. Recommended next phase

**Phase 8E — Optional release gate:** surface deployment health policy `unhealthy` / production `needs_attention` as a **soft** release checklist item (still no auto-rollback). Alternatively extend **Phase 9** external CI correlation using policy status hashes in evidence bundles.
