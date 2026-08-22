# AE Senior Escalation Package V1

Status: **IMPLEMENTED (PACKAGE ONLY)**  
Date: 2026-08-22  
Does **not** call DeepSeek.  
Does **not** start FreeToken.  
Does **not** change the default Nano worker.  
Does **not** import into `loop.ts` / `worker-client.ts` / `worker-route.ts`.

Machine-readable: `src/lib/engineer-console/senior-escalation/`  
Profiles: `ae-runtime-profiles-v1.md`  
Inventory: `local-model-runtime-strategy.md`

### Final verdict

`SENIOR ESCALATION PACKAGE V1 COMPLETE`  
`NO LIVE SENIOR CALL`  
`DEEPSEEK REMAINS ON DEMAND`

---

## What V1 does

V1 is the packaging layer on top of the AE runtime-profile switchboard. It:

1. Decides whether a senior review is **recommended**
2. Builds a structured escalation package that can be shown or stored even when DeepSeek is down
3. Renders a deterministic senior-review prompt

Recommended senior profile is always `deepseek-senior`. `autoCallAllowed` is always `false`. `requiresManualServe` is always `true`.

---

## When escalation is recommended

| Reason | Trigger |
|---|---|
| `failed_qc` | QC marked failed, QC failure rows, or a failing test result |
| `repeated_failure_class` | Same failure class / identity appears at least twice |
| `repair_loop_exhausted` | Repair budget flag, `BUDGET_EXHAUSTED`, or `repairAttempts >= maxRepairAttempts` |
| `pr_readiness_review` | Delivery candidate, explicit PR-readiness, or stage `waiting_for_approval` |
| `architecture_review` | Architecture, orchestration, or payment (signal or keyword) |
| `persistent_state_risk` | Persistent state / database / schema / ledger |
| `auth_or_security_risk` | Auth, security, OAuth, JWT, CSRF, secrets |
| `approval_gate_risk` | Approval gates, human approval, sign-off, self-authorization |
| `data_contract_risk` | Data / API / schema contracts, OpenAPI |
| `large_context_diagnosis` | Explicit large-context diagnosis signal or keyword |

A small bounded implementation with **passing QC** and **no** domain / PR / exhaustion signals does **not** escalate. Keep it on `nano-fast` (or the current env worker).

---

## What V1 does not do

- No live HTTP call to `127.0.0.1:1919`
- No FreeToken / Docker start or stop
- No automatic enable of `ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED`
- No change to `ENGINEER_CONSOLE_LOCAL_MODEL_CODING_*` defaults (8081 / `nano-fast`)
- No AE loop routing
- No file mutation, PR, merge, or deploy
- No GLM profile

Governed live invocation (operator-requested only, no AE loop auto-call): `ae-governed-live-senior-invocation-v2.md`.  
Operator queue / command: `ae-senior-review-queue-v1.md`.  
Run-detail panel: `ae-senior-review-panel-v1.md`.

---

## DeepSeek safety

| Flag | Value |
|---|---|
| Profile | `deepseek-senior` |
| Status | `on_demand` |
| `autoCallAllowed` | false |
| `autoServe` | false |
| `requiresManualServe` | true |
| `concurrentWithNano` | false |

Current Nano containers occupy both GPUs. DeepSeek FTW uses GPU 0 TP1. Stop Nano on GPU 0 before serving, then restore Nano. Do not enable senior coding unless FreeToken is already listening on `127.0.0.1:1919`.

The package is still buildable when DeepSeek is not serving (`manuallyServing=false`). Store or show it; do not pretend a live review happened.

---

## Prompt shape

The renderer always emits these sections:

1. Role
2. Objective
3. Current Status
4. Evidence
5. Worker Attempts
6. Failures
7. Risks
8. Requested Senior Judgment
9. Required Output Format

The senior model must diagnose root cause, reject symptom-only patches, list missing evidence, propose the next **worker** mission (`nano-fast` or `nano-faithful`), name QC gates, and keep human approval gates in place.

---

## API

```ts
decideSeniorEscalation(input)
buildSeniorEscalationPackage(input)
renderSeniorEscalationPrompt(pkg)
```

`buildSeniorEscalationPackage` always sets `liveInvocation.networkCallMade = false`.

Related: `ae-runtime-profiles-v1.md`, `autonomous-engineer-v1.md`.
