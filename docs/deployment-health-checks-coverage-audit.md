# Deployment Health Check Coverage Audit (Phase 8C.5)

**Date:** 2026-05-23  
**Scope:** Post-deployment HTTP health checks only (no rollback, GH Actions, cloud APIs, alerting, browser checks, auto-polling, arbitrary URLs, or model execution).

## 1. Executive summary

Phase 8C.5 audited the deployment health check surface end-to-end: profile configuration, readiness gates, HTTP execution, authorization, redaction/storage, audit/evidence/replay integration, API routes, UI panel, and tests.

**Verdict: PASS with targeted hardening applied.**

Health checks are **profile-gated**, **read-only** (HTTP GET only), **operator+** for execution, and **fail-closed**. Full response bodies are not stored; summaries are redacted and hashed.

### Gaps found and fixed in 8C.5

| Gap | Fix |
|-----|-----|
| POST body could include ignored `url` / probe config without error | Reject forbidden client config keys with HTTP 400 |
| HTTP method not explicitly tested as GET-only | `getHealthCheckHttpMethod()` + `execute-http-health-check.method.test.ts` |
| Audit/replay/evidence secret leakage not fully tested | Expanded tests for audit payloads, replay package, evidence summary |
| Unsupported profile type coverage thin | Readiness test for non-`http` type via test override |
| Operator authorization success not tested | Added operator `authorizeMutation` pass test |

## 2. Profile safety coverage

| Control | Status |
|---------|--------|
| Profiles from `ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON` only | Pass |
| Client cannot supply URL, method, headers, body, timeout, expected status | Pass — POST rejects forbidden keys; manager uses profile only |
| Public API: name, environment, type, enabled, hostname — not full URL | Pass |
| Unknown / disabled / unsupported type blocks | Pass |
| Environment must match deployment execution | Pass |
| No default profiles unless env configured | Pass — empty array when unset |

## 3. HTTP execution safety coverage

| Control | Status |
|---------|--------|
| HTTP GET only | Pass — `HEALTH_CHECK_HTTP_METHOD = "GET"`, no headers |
| URL from profile only | Pass |
| Timeout via `AbortController` | Pass |
| Status compared to `expectedStatus` | Pass |
| Response time captured | Pass |
| Body capped in memory (4KB) before summary | Pass |
| Summary redacted/truncated (800 chars) | Pass — reuses deployment redaction |
| SHA-256 hash stored | Pass |
| failed / unhealthy / healthy persisted correctly | Pass |

## 4. Authorization coverage

| Control | Status |
|---------|--------|
| GET profiles / history: viewer+ | Pass |
| POST: operator+ | Pass |
| Viewer blocked | Pass |
| Unauthenticated blocked when auth on | Pass — route guards |
| CSRF/same-origin on POST | Pass — `authorizeMutation` |
| `resolveHumanActor` overrides client label | Pass |
| Models blocked in manager | Pass |

## 5. Readiness gate coverage

Blocks when: execution missing, not `succeeded`, failed execution, env mismatch, no profiles, unknown/disabled/unsupported profile.

## 6. Redaction / storage coverage

| Control | Status |
|---------|--------|
| Full body not in DB | Pass |
| Secret patterns redacted | Pass — shared `redact-deployment-output` |
| Public API: no `checkedUrl`, hostname only | Pass |
| Evidence summary: counts/status only | Pass |
| Replay: metadata only, no body | Pass |
| Audit: hash prefix + short message, no body | Pass |

## 7. Forbidden-pattern search results

Searched `src/lib/engineer-console/release/deployment-health-check/` and health-check API routes:

| Pattern | Result |
|---------|--------|
| Client URL in execution path | None — profile URL only |
| Arbitrary headers / POST probes | None — GET only, no headers |
| `child_process` / `spawn` / `exec` | None |
| Cloud SDK / GH Actions / rollback | None |

## 8. Tests added/updated

- `deployment-health-check.test.ts` — **22** cases (was 15)
- `execute-http-health-check.method.test.ts` — **2** cases (new)

All 16 required scenario checklist items covered.

## 9. Verification

| Command | Result |
|---------|--------|
| `npm test` | **288 passed** (34 files), including 26 health-check tests |
| `npm run build` | **Success** (Next.js 15.5.18) |
| `git status --short` | 3 modified + 2 new files (audit doc + method test) |

## 10. Remaining limitations

- `checked_url` stored internally for ops; public shape uses hostname only
- No automatic health polling or alerting
- HTTP GET only (no HEAD/TCP/mTLS probes)
- Reruns allowed (operator explicit re-trigger)
- Invalid env JSON fails fast at load

## 11. Recommended next phase

**Phase 8D — Deployment health policies:** optional gate requiring latest health check `healthy` before release sign-off (still no rollback/auto-polling). Alternatively **Phase 9** — external CI health integration behind the same profile gates.
