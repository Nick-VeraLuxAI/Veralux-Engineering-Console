# Release Checklist Coverage Audit (Phase 8E.5)

**Date:** 2026-05-23  
**Scope:** Soft release checklist only (no hard gate, rollback, GitHub Actions, cloud APIs, alerting, auto-polling, model-triggered completion, or command execution).

## 1. Executive summary

Phase 8E.5 audited the release checklist surface end-to-end: builder, manager, audit lifecycle, API routes, UI panel, evidence/replay integration, documentation, and tests.

**Verdict: PASS with targeted hardening applied.**

The checklist is **advisory**, **database-state only**, **deterministic**, and **redacted at persist/API boundaries**. POST does not refresh evidence by default (no circular regeneration).

### Gaps found and fixed in 8E.5

| Gap | Fix |
|-----|-----|
| Approved deployment with no execution mapped to `not_started` | `deployment_executed` → `needs_attention` when approved but not executed |
| `checklist_json` persisted without redaction pass | `toStorableReleaseChecklistEvaluation()` redacts summaries, blockers, and actions |
| Audit failure path under-tested | Test with `refreshEvidence: true` failure asserts `RELEASE_CHECKLIST_FAILED` |
| POST no-evidence-refresh not tested | Test asserts `refreshRunEvidenceBundle` not called when `refreshEvidence: false` |
| Docs thin on GET `latest` vs `computed` and append-only history | Updated `docs/release-checklist.md` |

## 2. Determinism / no-execution coverage

| Control | Status |
|---------|--------|
| Evaluation reads DB state only | Pass — summaries/list/get from existing modules |
| No `fetch` | Pass — static source tests on builder + manager |
| No shell/commands | Pass — forbidden-pattern search clean |
| No deployment execution | Pass — no `createDeploymentExecution` in module |
| No merge execution | Pass — no `createMergeRequest` in module |
| No rollback / GH Actions / kubectl / cloud SDK | Pass |
| POST default `refreshEvidence: false` | Pass — API route + test |
| Deterministic for same DB state | Pass — pure `buildReleaseChecklist` |

## 3. Status mapping coverage

| Scenario | Expected | Status |
|----------|----------|--------|
| No PR/deployment lifecycle | `not_started` | Pass |
| Missing evidence with release intent | `blocked` | Pass |
| Policy blocked | `blocked` | Pass |
| Pending required review | `blocked` | Pass |
| PR created, not merged | `needs_attention` | Pass (documented) |
| Merged, no deployment approval | `needs_attention` | Pass |
| Approved, no execution | `needs_attention` | Pass (8E.5) |
| Deployment execution failed | `blocked` | Pass |
| Health policy unhealthy | `needs_attention` | Pass |
| Production policy `needs_attention` | `needs_attention` | Pass |
| Full lifecycle + healthy | `complete` | Pass |
| Unknown statuses | Safe defaults | Pass — fallback branches in builder |

## 4. Authorization coverage

| Control | Status |
|---------|--------|
| GET: viewer+ | Pass — `authorizeRead` |
| POST: operator+ | Pass — `authorizeMutation` |
| Viewer blocked from POST | Pass |
| Unauthenticated blocked when auth on | Pass — route guards + test env |
| CSRF/same-origin on POST | Pass |
| `resolveHumanActor` overrides client label | Pass |
| Models cannot evaluate | Pass — manager rejects `MODEL` |

## 5. Redaction / storage coverage

| Control | Status |
|---------|--------|
| No full command logs in `checklist_json` | Pass — not sourced |
| No full git diffs | Pass |
| No raw model prompts/outputs | Pass |
| No health response bodies | Pass — metadata summaries only |
| Secrets redacted on persist | Pass — `toStorableReleaseChecklistEvaluation` |
| Evidence summary: status/counts only | Pass |
| Replay summary: status/counts only | Pass — no `items` array |
| API public shape only | Pass — `toPublicReleaseChecklist` |

## 6. Audit / evidence / replay coverage

| Control | Status |
|---------|--------|
| `RELEASE_CHECKLIST_EVALUATED` | Pass |
| `RELEASE_CHECKLIST_FAILED` on inner failure | Pass (8E.5) |
| Audit payload: status + counts | Pass |
| No secrets/logs in audit | Pass — tested |
| Evidence bundle `releaseChecklist` summary | Pass |
| Replay package `releaseChecklist` summary | Pass |
| Append-only history | Pass — INSERT per evaluation |
| GET `latest` vs `computed` documented | Pass (8E.5) |

## 7. Forbidden-pattern search results

Searched `src/lib/engineer-console/release/release-checklist/` and `src/app/api/engineer-console/runs/[id]/release-checklist/`:

| Pattern | Result |
|---------|--------|
| `fetch(` | None |
| `child_process` / `exec` / `spawn` / `shell` | None |
| `rollback` / `gh workflow` / `kubectl` | None |
| Cloud SDK | None |
| `createDeploymentExecution` / `createMergeRequest` | None in checklist module |
| Model-triggered evaluation | Blocked in manager |

Note: `refreshRunEvidenceBundle` exists behind `refreshEvidence: true` only; API POST sets `false`.

## 8. Tests added/updated

`release-checklist.test.ts` — expanded from **18** to **23** cases, covering all 16 required checklist scenarios.

New module: `sanitize-release-checklist-evaluation.ts`.

## 9. Verification

| Command | Result |
|---------|--------|
| `npm test` | **334 passed** (36 files), including 23 release checklist tests |
| `npm run build` | **Success** (Next.js 15.5.18) |
| `git status --short` | 4 modified + 2 new files |

## 10. Recommended next phase

**Phase 8F — Optional hard release gate:** surface checklist `blocked` / production `needs_attention` as a soft UI gate on run completion (still no auto-rollback). Alternatively **Phase 9** — external CI checklist item correlation.
