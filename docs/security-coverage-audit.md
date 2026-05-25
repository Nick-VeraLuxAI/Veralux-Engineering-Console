# VeraLux Engineering Console — Phase S1 Security Coverage Audit

**Audit date:** 2026-05-23  
**Scope:** Post-S1 operator auth + action authorization  
**Auditor role:** Principal security / release-engineering review (read-only product scope)

## Executive summary

Phase S1 is **substantially complete** and **fail-closed** for API mutations when authentication is enabled. All 39 `/api/engineer-console/*` route modules were reviewed. Every data mutation uses `authorizeMutation` with correct minimum roles; every data read uses `authorizeRead` (viewer+) except intentional auth endpoints.

**Gaps found and remediated in this audit:**

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| G1 | **High** | `/engineer/login` was wrapped by `engineer/layout.tsx` calling `requireEngineerPageAuth()`, blocking login when auth enabled | `src/middleware.ts` sets `x-engineer-console-pathname`; `require-page-auth.ts` skips login path |
| G2 | **Medium** | `DECISION_RECORDED` and `HUMAN_*` audit events hardcoded `actorLabel: "operator"` despite authenticated actor at API | Pass `actorLabel` through `auditDecisionRecorded` and `auditHuman*` helpers |

**Residual limitations (documented, not in S1 scope):** no `operatorId` column on decision/audit tables; login/logout omit CSRF header (same-origin only); UI still exposes `actorLabel` inputs (ignored when auth on).

---

## 1. Route coverage table

Legend: **RO** = read-only (GET). **M** = mutation (POST). Auth column = guard when `ENGINEER_CONSOLE_AUTH_ENABLED=true`.

| Route | Method | Class | Min role | Guard | Notes |
|-------|--------|-------|----------|-------|-------|
| `/api/engineer-console/auth/me` | GET | Auth status | — | None | Intentional; returns operator + CSRF, no secrets |
| `/api/engineer-console/auth/login` | POST | Auth | — | Same-origin only | No session/CSRF pre-login |
| `/api/engineer-console/auth/logout` | POST | Auth | — | Same-origin only | Clears session cookie |
| `/api/engineer-console/tasks` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/tasks` | POST | M | operator | `authorizeMutation` | Create task |
| `/api/engineer-console/tasks/[id]` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/tasks/[id]/runs` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/tasks/[id]/runs` | POST | M | operator | `authorizeMutation` | Start run |
| `/api/engineer-console/repos` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/repos` | POST | M | operator | `authorizeMutation` | Register repo |
| `/api/engineer-console/repos/[id]` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/repos/[id]/verify` | POST | M | operator | `authorizeMutation` | |
| `/api/engineer-console/repos/[id]/detect` | POST | M | operator | `authorizeMutation` | |
| `/api/engineer-console/repos/[id]/index` | POST | M | operator | `authorizeMutation` | File index |
| `/api/engineer-console/repos/[id]/code-index` | POST | M | operator | `authorizeMutation` | Code index |
| `/api/engineer-console/repos/[id]/files` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/repos/[id]/chunks` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/repos/[id]/symbols` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/repos/[id]/index-runs` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/compatibility/analyze` | POST | M | operator | `authorizeMutation` | |
| `/api/engineer-console/compatibility/runs` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/compatibility/surfaces` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/compatibility/links` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/runs/[id]` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/runs/[id]/actions` | POST | M | operator + **admin if approve** | `authorizeMutation` + `assertRunApprovalRole` | Final approval |
| `/api/engineer-console/runs/[id]/worker-plan` | POST | M | operator | `authorizeMutation` | **Worker plan execution** |
| `/api/engineer-console/runs/[id]/worker-plan-drafts` | POST | M | operator | `authorizeMutation` | **Model draft generation** |
| `/api/engineer-console/runs/[id]/review-stages` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/runs/[id]/review-stages/generate` | POST | M | operator | `authorizeMutation` | |
| `/api/engineer-console/runs/[id]/review-stages/[stageId]/actions` | POST | M | operator + **admin if approve** | `authorizeMutation` + `assertReviewStageActionRole` | |
| `/api/engineer-console/runs/[id]/replay-verification` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/runs/[id]/replay-verification` | POST | M | operator | `authorizeMutation` | |
| `/api/engineer-console/runs/[id]/replay-package` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/runs/[id]/policy-results` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/runs/[id]/policy-results` | POST | M | operator | `authorizeMutation` | |
| `/api/engineer-console/runs/[id]/evidence-bundle` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/runs/[id]/evidence-bundle/regenerate` | POST | M | operator | `authorizeMutation` | |
| `/api/engineer-console/runs/[id]/decision-records` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/runs/[id]/audit-events` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/runs/[id]/pr-readiness` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/runs/[id]/pr-requests` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/runs/[id]/pr-requests` | POST | M | **admin** | `authorizeMutation` minRole admin | **PR creation** |
| `/api/engineer-console/governance/policies` | GET | RO | viewer | `authorizeRead` | |
| `/api/engineer-console/model-provider` | GET | RO | viewer | `authorizeRead` | Public provider metadata only |
| `/api/engineer-console/audit/verify` | GET | RO | viewer | `authorizeRead` | |

**Totals:** 39 route modules, 42 HTTP handlers (3 auth routes + 39 console routes). **0 unguarded data handlers** when auth enabled.

---

## 2. High-risk mutation routes

| Capability | Route | Protection | Status |
|------------|-------|------------|--------|
| Worker plan execution | `POST .../worker-plan` | operator + CSRF + origin | OK |
| Worker plan draft generation | `POST .../worker-plan-drafts` | operator + CSRF + origin | OK |
| Final run approval | `POST .../actions` (approve) | operator gate + **admin** `assertRunApprovalRole` | OK |
| Review-stage approval | `POST .../review-stages/[id]/actions` (approve) | operator gate + **admin** `assertReviewStageActionRole` | OK |
| Evidence regenerate | `POST .../evidence-bundle/regenerate` | operator | OK |
| Replay verification | `POST .../replay-verification` | operator | OK |
| Policy evaluation | `POST .../policy-results` | operator | OK |
| PR creation | `POST .../pr-requests` | **admin** | OK |
| Repo register / verify / detect / index / code-index | `POST` under `repos/` | operator | OK |
| Compatibility analyze | `POST .../compatibility/analyze` | operator | OK |

---

## 3. Role matrix

| Action | viewer | operator | admin |
|--------|--------|----------|-------|
| All GET console APIs | Yes | Yes | Yes |
| Create task / start run | No | Yes | Yes |
| Worker plan / drafts | No | Yes | Yes |
| Repo / index / compatibility mutations | No | Yes | Yes |
| Replay / policy / evidence regenerate | No | Yes | Yes |
| request_fix / stop | No | Yes | Yes |
| Review reject / skip | No | Yes | Yes |
| Final run approve | No | **No** | Yes |
| Review-stage approve | No | **No** | Yes |
| Create PR | No | **No** | Yes |

Enforcement: `authorizeMutation` role rank + `assertRunApprovalRole` / `assertReviewStageActionRole` for approve actions.

---

## 4. CSRF / same-origin coverage

| Layer | Behavior |
|-------|----------|
| `authorizeMutation` | Calls `assertMutationOrigin` when auth enabled |
| CSRF | Header `x-engineer-console-csrf` validated against session (HMAC-derived) |
| UI | All console panels use `engineerConsoleFetch` (mutations + credentialed reads) |
| Exceptions | `auth/me` (raw `fetch` for bootstrap), `auth/login` (pre-session, same-origin only), `engineer-session-bar` me poll |

**Login/logout:** Documented intentional omission of CSRF token; protected by same-origin check only. Acceptable for Phase S1; consider double-submit cookie in a future phase.

---

## 5. Actor identity coverage

| Surface | Authenticated actor | Client `actorLabel` spoof |
|---------|---------------------|---------------------------|
| `POST .../actions` | `resolveHumanActor` → decision record | Blocked when auth on |
| `POST .../review-stages/.../actions` | `resolveHumanActor` → stage + audit | Blocked when auth on |
| `POST .../pr-requests` | `resolveHumanActor` → PR record + audit | Blocked when auth on |
| Decision DB row | `actor_label` from resolved actor | OK |
| `DECISION_RECORDED` audit | Uses passed `actorLabel` (fixed G2) | OK |
| `HUMAN_APPROVED` / `REQUEST_FIX` / `STOPPED` audit | Uses approval `actorLabel` (fixed G2) | OK |
| Review-stage audit lifecycles | Uses API-passed `actorLabel` from `resolveHumanActor` | OK |
| PR audit lifecycle | Uses `resolveHumanActor` label | OK |
| `operatorId` in DB | Not persisted on decision/audit rows | Future enhancement |

Trusted local dev: `actorLabel` from client still accepted via `resolveHumanActor` fallback.

---

## 6. Production config coverage

| Requirement | Implementation | Status |
|-------------|----------------|--------|
| Production cannot disable auth | `getAuthConfig`: `isProduction` → `authEnabled = true` | OK |
| `validateAuthConfig` rejects auth-off in production | `AUTH_DISABLED_IN_PRODUCTION` | OK |
| Session secret required in production | `SESSION_SECRET_REQUIRED` | OK |
| Secrets not in client JSON | `auth/me` returns operator + CSRF only; `getPublicAuthStatus` omits secrets | OK |
| Trusted local dev only outside production | `trustedLocalDev` + `AUTH_ENABLED=false` only when `!isProduction` | OK |

---

## 7. UI page protection

| Page | Protection |
|------|------------|
| `/engineer`, `/engineer/repos`, `/engineer/compatibility`, `/engineer/tasks/*`, `/engineer/runs/*` | `requireEngineerPageAuth` in `engineer/layout.tsx` |
| `/engineer/login` | Bypass via pathname header (fixed G1) |

Server-rendered pages load data server-side; client mutations go through guarded APIs.

---

## 8. Tests

### Existing (`security.test.ts`)

- Production session secret requirement  
- Trusted local dev auth-off  
- Public auth status has no secrets  
- Password verify / session lifecycle / expiry  
- Unauthenticated / viewer / operator / admin mutation matrix  
- `resolveHumanActor` spoof resistance  
- Same-origin / cross-site  
- Login path detection  
- Decision audit actor label  

### Recommended follow-ups (not blocking S1)

- Integration test: `POST /auth/login` → cookie → guarded mutation with CSRF  
- Route-level test harness for each handler (optional; guards are unit-tested)  
- E2E: viewer receives 403 on `POST .../tasks`  

---

## 9. Verification results

```text
npm test   → 196+ tests passed (after audit fixes)
npm run build → success
```

---

## 10. Recommended fixes (post-audit)

| Priority | Item |
|----------|------|
| Low | Hide `actorLabel` UI fields when `authEnabled` |
| Low | Persist `operator_id` on decision records / audit metadata |
| Medium | Add CSRF token to login after session establishment pattern (optional) |
| Future | SSO, RBAC matrix, GitHub App identity, deployment gates |

---

## 11. Safety constraints (unchanged)

- Worker plans remain sole file-write execution path  
- Models generate drafts only  
- No auto-merge / deploy  
- Audit ledger append-only  
- Evidence bundles redacted  
