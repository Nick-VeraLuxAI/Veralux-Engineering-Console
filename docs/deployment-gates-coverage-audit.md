# VeraLux Engineering Console — Phase 8A.5 Deployment Gate Coverage Audit

**Audit date:** 2026-05-23  
**Scope:** Deployment readiness evaluation and deployment approval (Phase 8A)  
**Auditor role:** Principal release-security review

## Executive summary

Phase 8A deployment gates are **substantially complete** and **fail-closed** for approval when auth is enabled. All five deployment API handlers use the correct guards. Readiness evaluation enforces merge, evidence, policy, replay, and review prerequisites. **No deploy execution path exists.**

**Gaps found and remediated in this audit:**

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| D1 | **High** | `createDeploymentApproval` trusted a stale stored readiness check; run could degrade after evaluation (e.g. evidence removed) and still be approved | Re-run `evaluateDeploymentReadiness` at approval time; block `approved` when current status is `blocked` |
| D2 | **Medium** | `DEPLOYMENT_READINESS_EVALUATED` audit events used `actorType: system` while humans triggered evaluation | `deployment-audit-lifecycle.ts` records `human` when operator/admin evaluates; passes `actorType` from manager |
| D3 | **Low** | Evidence bundle `deploymentGates` summary not updated after approval | `createDeploymentApproval` awaits `refreshRunEvidenceBundle` after persisting approval |

**Test coverage expanded:** 14 → **26** cases in `deployment-gates.test.ts`.

---

## 1. Route coverage table

Legend: **RO** = GET read-only. **M** = POST mutation. Guards apply when `ENGINEER_CONSOLE_AUTH_ENABLED=true`.

| Route | Method | Class | Min role | Guard | Status |
|-------|--------|-------|----------|-------|--------|
| `/api/engineer-console/deployment/environments` | GET | RO | viewer | `authorizeRead` | Pass |
| `/api/engineer-console/runs/[id]/deployment-readiness` | GET | RO | viewer | `authorizeRead` | Pass |
| `/api/engineer-console/runs/[id]/deployment-readiness` | POST | M | operator | `authorizeMutation` + CSRF | Pass |
| `/api/engineer-console/runs/[id]/deployment-approval` | GET | RO | viewer | `authorizeRead` | Pass |
| `/api/engineer-console/runs/[id]/deployment-approval` | POST | M | **admin** | `authorizeMutation` + CSRF | Pass |

**Totals:** 5 handlers across 3 route modules. **0 unguarded data handlers** when auth enabled.

---

## 2. Readiness gate coverage

| Gate | Enforced in `evaluateDeploymentReadiness` | Test |
|------|------------------------------------------|------|
| Approved human decision | Yes | `blocks when run is not approved` |
| PR exists (`pr_created`) | Yes | `blocks when PR does not exist` |
| Merge request merged | Yes | `blocks when PR not merged` |
| Merge SHA present | Yes | `blocks when merge SHA is missing` |
| Evidence bundle | Yes | `blocks without evidence bundle` |
| Policy not blocked | Yes | `blocks on blocked policy` |
| Replay passed | Yes | `blocks on missing or failing replay` |
| Review stages approved | Yes | `blocks on pending or rejected review stage` |
| Quality gates passed | Yes (via policy re-eval / gate failure) | `blocks on blocked policy` |
| Protected-path blockers | Yes | `blocks on protected-path governance blockers` |
| Environment active | Yes | `blocks when deployment environment is inactive` |
| Supported deployment strategy | Yes | Covered by `DEPLOYMENT_STRATEGIES` allowlist |
| Production rationale at **approval** | Yes (not readiness blocker) | `production environment requires rationale` |
| `requires_review` rationale at approval | Yes | `requires_review readiness requires admin rationale` |

Readiness status: `passed` | `blocked` | `requires_review` (warnings / policy review / production warning).

---

## 3. Role matrix

| Action | viewer | operator | admin |
|--------|--------|----------|-------|
| List environments | Yes | Yes | Yes |
| GET deployment readiness / approval history | Yes | Yes | Yes |
| POST evaluate deployment readiness | No | Yes | Yes |
| POST approve / reject deployment | No | No | Yes |

Verified by route guards and tests: `rejects viewer role`, `operator can evaluate… admin required for approval`.

---

## 4. Approval behavior

| Requirement | Status | Notes |
|-------------|--------|-------|
| Blocked readiness cannot be approved | Pass | Stored + **live** re-eval (D1 fix) |
| `requires_review` requires admin rationale | Pass | Uses current readiness at approval |
| Production requires admin rationale | Pass | Even when readiness is `passed` |
| Reject persists with rationale | Pass | `rejected deployment approval persists` |
| Approval does not deploy | Pass | No shell/gh/cloud calls in module |
| Audit events emitted | Pass | `DEPLOYMENT_*` lifecycle |
| Evidence bundle summary | Pass | `deploymentGates` after approval (D3) |

---

## 5. Actor and audit coverage

| Check | Status |
|-------|--------|
| `resolveHumanActor` overrides client `actorLabel` when auth on | Pass — `resolveHumanActor ignores client actorLabel` |
| Readiness audit uses human actor | Pass — D2 fix; `readiness audit uses human actor label` |
| Approval/rejection audit uses resolved `actorLabel` | Pass — from API → manager → `auditDeploymentApproved` / `Rejected` |
| Models cannot evaluate or approve | Pass — `DeploymentGateError` in manager |

**Residual:** `DEPLOYMENT_READINESS_EVALUATED` payload does not include `operatorId` (same limitation as Phase S1 decision audit).

---

## 6. No-deploy safety confirmation

Searched `src/lib/engineer-console/release/deployment-gates/` for:

- `exec`, `spawn`, `kubectl`, `terraform`, `gh workflow`, deploy CLIs — **none**
- Terminal API — **not added**
- GitHub Actions triggers — **not added**
- Cloud provider APIs — **not added**
- Auto-deploy — **not present** (approval is DB + audit only)

`createDeploymentApproval` only inserts into `engineer_deployment_approvals` and refreshes evidence.

---

## 7. UI coverage

| Check | Status |
|-------|--------|
| States approval does not deploy | Pass — panel header copy |
| No deploy button | Pass — only Evaluate / Approve / Reject |
| Blocked approval disabled | Pass — `approvalBlocked` disables Approve |
| Rationale required hint | Pass — `(required for approval)` when production or `requires_review` |

---

## 8. Gaps fixed (detail)

### D1 — Stale readiness on approval (High)

**Before:** Approval checked only the JSON snapshot from when the readiness check was created.

**After:** `createDeploymentApproval` calls `evaluateDeploymentReadiness` again for `approved` decisions and blocks if current status is `blocked`.

### D2 — Audit actor for readiness evaluation (Medium)

**Before:** `auditDeploymentReadinessEvaluated` always used `actorType: system`.

**After:** Uses `human` when `actorType` is human; `actorLabel` from authenticated evaluation path.

### D3 — Evidence bundle refresh (Low)

**After:** `await refreshRunEvidenceBundle({ runId })` following approval/rejection so `deploymentGates` summary is current.

---

## 9. Test and build results

```text
npm test  → 237 passed (30 files), including 26 deployment-gates tests
npm run build → success
```

---

## 10. Recommendation — next phase

**Phase 8B — Controlled deploy execution (future)**

- Separate module with explicit allowlisted deploy adapters (no arbitrary shell)
- Require existing `DEPLOYMENT_APPROVED` audit + fresh readiness re-check immediately before any deploy
- GitHub Actions / environment secrets as optional integrations behind admin config
- Rollback as a distinct audited action, not implicit in approval

Do **not** wire deploy execution into `createDeploymentApproval`; keep approval as governance record-only.
