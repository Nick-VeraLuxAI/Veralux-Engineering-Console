# AE Governed Live Senior Invocation V2

Status: **IMPLEMENTED (OPERATOR-REQUESTED ONLY)**  
Date: 2026-08-22  
Does **not** start or stop FreeToken / Nano.  
Does **not** auto-run from the AE loop.  
Does **not** approve, merge, or deploy.  
Does **not** change the default 8081 Nano worker.  
GLM remains parked.

Machine-readable: `src/lib/engineer-console/senior-escalation/invoke.ts`  
Package: `ae-senior-escalation-package-v1.md`  
Profiles: `ae-runtime-profiles-v1.md`

### Final verdict

`GOVERNED LIVE SENIOR INVOCATION V2 COMPLETE`  
`NO AUTO-SERVE`  
`NO AE LOOP AUTO-CALL`  
`SENIOR OUTPUT IS ADVISORY`

---

## What V2 does

V2 consumes a Senior Escalation Package V1 and may call DeepSeek-V4-Flash FTW at `http://127.0.0.1:1919/v1` **only** when every safety gate passes and an operator explicitly requested the call.

Senior output is advisory. Human gates stay required.

---

## Live call gates

A chat completion is allowed only when all of these are true:

1. A senior escalation package exists
2. The package recommends escalation
3. Recommended profile is `deepseek-senior`
4. `ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED=true`
5. Senior base URL is **explicitly** set
6. Senior model name is **explicitly** set to `deepseek-v4-flash-ftw-tp1`
7. Operator approval is present (`approved` + `invocationRequested` + `approvedBy`)
8. Endpoint is localhost only
9. Endpoint is not Nano `8081` or `8082`
10. Package `autoCallAllowed=false` (manual / operator invocation only)
11. Profile `requiresManualServe=true`, `autoServe=false`, `concurrentWithNano=false`
12. Package has not already recorded a live chat call
13. Health check against `/v1/models` (or `/health`) succeeds

If any gate fails: `status=blocked`, `networkCallMade=false` for chat, exact `blockedReasons`. No throw.

If the endpoint is down: `senior_endpoint_unavailable`. Health probes are not a chat completion.

---

## What V2 does not do

- Does not start FreeToken
- Does not stop Nano
- Does not auto-serve DeepSeek
- Does not import into `loop.ts` / `worker-client.ts` / `worker-route.ts`
- Does not make DeepSeek the AE worker
- Does not enable senior config by default
- Does not grant approval, PR, merge, or deploy authority
- Does not activate GLM

Operator must manually serve FreeToken on `127.0.0.1:1919` (after freeing GPU0 under the current layout), then explicitly enable senior env **and** request invocation.

---

## Client

`POST {baseUrl}/chat/completions`

| Field | Value |
|---|---|
| model | `deepseek-v4-flash-ftw-tp1` |
| temperature | 0 |
| max_tokens | 1200 (configurable) |
| tools | none |
| system | DeepSeek local identity; not Google/OpenAI/Anthropic; no files/shell/approvals |
| user | package `promptText` |

Identity system message corrects DeepSeek identity drift. The model must not claim another provider trained it.

---

## Response handling

- Valid JSON → `parsedReview` filled; `humanGatesStillRequired` forced true
- Unparseable text → `status=succeeded`, `parsedReview=null`, warning `unparseable_json`, raw text kept
- Chat network/HTTP failure → `status=failed`; Nano worker defaults unchanged
- Usage and `timingMs` recorded when available

---

## API

```ts
checkSeniorInvocationGates(request)
checkSeniorEndpointAvailable(baseUrl, fetchFn?)
parseSeniorReviewResponse(text)
invokeSeniorReview(request)
```

`SENIOR_INVOCATION_WIRED_INTO_AE_LOOP = false`.

Operator command / in-memory queue: `ae-senior-review-queue-v1.md`.  
Run-detail panel: `ae-senior-review-panel-v1.md`.

Related: `ae-senior-escalation-package-v1.md`, `ae-runtime-profiles-v1.md`, `autonomous-engineer-v1.md`.
