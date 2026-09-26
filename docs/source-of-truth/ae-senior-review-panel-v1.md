# AE Senior Review Run-Detail Panel V1

Status: **IMPLEMENTED**  
Date: 2026-08-22  
Does **not** auto-run from the AE loop.  
Does **not** start or stop FreeToken / Nano.  
Does **not** change `.env.local` or Docker.  
Does **not** let senior output approve, merge, or deploy.

Machine-readable: `src/lib/engineer-console/senior-escalation/run-panel.ts`  
UI: `src/components/engineer-console/senior-review-panel.tsx`  
API: `src/app/api/engineer-console/runs/[id]/senior-review/route.ts`  
Queue: `ae-senior-review-queue-v1.md`

### Final verdict

`SENIOR REVIEW RUN-DETAIL PANEL V1 COMPLETE`  
`ADVISORY ONLY`  
`NO ENV LEAK TO BROWSER`

---

## What V1 does

On an Autonomous Engineer run detail page, the operator can:

- See senior-review status and escalation reasons
- See whether senior review is currently requestable
- See blocked reasons as **safe labels** (no URLs, env names, or checkpoint paths)
- Type `REQUEST_SENIOR_REVIEW` and click **Request Senior Review**
- Read advisory senior judgment if the call succeeded

The button stays disabled until the confirmation phrase matches **exactly** (no trim) and V2 gates other than operator approval already pass.

---

## Safety

- Browser payload is `SeniorReviewPanelView` only
- No `127.0.0.1:1919`, `:8081`, `:8082`, `ENGINEER_CONSOLE_SENIOR_*`, or `/mnt/model-storage`
- Senior env is read only on the server
- POST uses existing `authorizeMutation` + CSRF
- Confirmation is passed through without normalization
- `humanGatesStillRequired` and `advisoryOnly` stay true
- AE loop still does not import this path

DeepSeek must already be manually serving. This panel does not start FreeToken.

---

## API

`GET /api/engineer-console/runs/:id/senior-review`  
Stages or refreshes the in-memory queue item for that run. No chat call.

`POST /api/engineer-console/runs/:id/senior-review`  
Body: `{ confirmationText }` (exact). Calls `requestSeniorReviewForPackage`.

---

## Next

Durable per-run storage: `ae-senior-review-durable-evidence-v1.md`. Review-workspace Evidence display: `ae-senior-review-evidence-panel-v1.md`.

Related: `ae-senior-review-queue-v1.md`, `ae-governed-live-senior-invocation-v2.md`, `ae-senior-review-durable-evidence-v1.md`, `ae-senior-review-evidence-panel-v1.md`, `frontend-engineering-console-audit.md`.
