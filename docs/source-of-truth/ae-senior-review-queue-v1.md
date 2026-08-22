# AE Senior Review Queue / Operator Command V1

Status: **IMPLEMENTED (DOMAIN / SERVICE ONLY)**  
Date: 2026-08-22  
Does **not** auto-run from the AE loop.  
Does **not** start or stop FreeToken / Nano.  
Does **not** add a database migration.  
Does **not** add Console UI in V1.  
Does **not** approve, merge, or deploy.

Machine-readable: `src/lib/engineer-console/senior-escalation/queue.ts`  
Invocation: `ae-governed-live-senior-invocation-v2.md`  
Package: `ae-senior-escalation-package-v1.md`

### Final verdict

`SENIOR REVIEW QUEUE V1 COMPLETE`  
`NO AE LOOP AUTO-CALL`  
`NO UI IN V1`  
`SENIOR OUTPUT IS ADVISORY`

---

## What V1 does

V1 is the operator command layer on top of Senior Escalation Package V1 and Governed Live Senior Invocation V2.

1. **Stage** a package into an in-memory queue item (no network)
2. **Inspect** status, reasons, and whether a live call is currently invokable
3. **Request** senior review only with explicit operator intent and the confirmation phrase `REQUEST_SENIOR_REVIEW`
4. The request calls `invokeSeniorReview` through existing V2 gates
5. Store the advisory result (raw + parsed if available) on the queue item
6. Human gates remain required

Process-local store (`createSeniorReviewQueueStore()`) is still the live queue. Durable per-run evidence now also writes `seniorReview` onto `engineer_autonomous_run_states.state_json`. See `ae-senior-review-durable-evidence-v1.md`.

---

## Statuses

| Status | Meaning |
|---|---|
| `not_requested` | Reserved / unused after staging |
| `package_ready` | Package staged; other V2 gates pass except operator approval |
| `blocked` | Staging or invocation gates failed, or operator intent was missing |
| `requested` | Operator confirmed; live call in flight |
| `succeeded` | Advisory senior response stored |
| `failed` | Chat/network failed after a requested call |
| `cancelled` | Operator cancelled; no further auto-call |

Every item has `advisoryOnly: true` and `humanGatesStillRequired: true`.

---

## Operator command

```ts
stageSeniorReviewPackage({ package, env, store })
summarizeSeniorReviewQueueItem(item)
requestSeniorReviewForPackage({
  itemId, // or package
  operatorRequested: true,
  operatorId,
  confirmationText: "REQUEST_SENIOR_REVIEW",
  env,
  fetchFn,
  store,
})
```

Staging never fetches. A request without `operatorRequested`, `operatorId`, or the exact confirmation phrase does **not** call chat completion.

DeepSeek must already be manually serving on `127.0.0.1:1919`. Senior env must be explicitly enabled. FreeToken is not started by this module.

---

## What V1 does not do

- No AE loop import / auto-call
- No auto-serve / Docker / model start-stop
- No default-worker change (`nano-fast` / 8081 remains)
- No DeepSeek-as-worker
- No retry loop on DeepSeek
- No approval or merge from senior output

Run-detail panel (confirmation phrase, advisory display): `ae-senior-review-panel-v1.md`.

How an operator requests review: open an AE run, type `REQUEST_SENIOR_REVIEW`, click **Request Senior Review**.

---

## Next

Review-workspace Evidence display: `ae-senior-review-evidence-panel-v1.md`.

Related: `ae-governed-live-senior-invocation-v2.md`, `ae-senior-escalation-package-v1.md`, `ae-senior-review-durable-evidence-v1.md`.
