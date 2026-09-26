# Super AirLLM Controlled-Pilot Operator Runbook

Scope: operating the gated VeraLux senior reviewer (repaired Nemotron Super
120B) as a **controlled internal pilot**. This is not a production deployment.

The senior model is optional, explicitly requested, gated by execution
approval, separately accepted before it can influence a decision, advisory
only, and unable to perform any action or become a default route.

---

## 0. Execution classification (read first)

```text
executionMode          = modelopt_fake_quant_cuda   (NOT native FP8)
generationStrategy     = full_prefix_recomputation   (NO KV-cache decoding)
verifiedMaxNewTokens   = 32
nativeFp8KernelProven  = false
fallbackDetected       = false
```

Do not describe the runtime as native FP8. Do not claim KV-cache serving.
A senior review is bounded to at most 32 generated tokens.

---

## 1. Start S13 (local loopback service)

S13 binds loopback-only on `127.0.0.1:8091`. Never expose it remotely.

```bash
cd /home/ndesantis/Documents/GitHub/Veralux-Engineering-Console
S13_LOCAL_SERVICE_FOREGROUND=1 \
  ./scripts/runtime/super-airllm/run-s13-local-service.sh \
  --serve --bind-host 127.0.0.1 --bind-port 8091 \
  --state-root .download-logs/s13-service-state \
  --shutdown-deadline-seconds 60 --shutdown-mode cancel_active \
  --allow-request-time-nano-interruption \
  --confirm-request-time-nano-interruption \
  --gpu-uuid <GPU-UUID>
```

## 2. Verify health / readiness

```bash
curl -s http://127.0.0.1:8091/v1/health     | jq
curl -s http://127.0.0.1:8091/v1/readiness  | jq
curl -s http://127.0.0.1:8091/v1/runtime    | jq
```

Expected before a request:
- `health.healthy = true`, `bind` starts with `127.0.0.1`
- `readiness.acceptingRequests = true`, `recoveryRequired = false`
- `health.executionMode = modelopt_fake_quant_cuda`, `nativeFp8KernelProven = false`

Console Nano (8082) is only interrupted **at request time** (state
`stopping_nano` during processing), then restored after the request.

## 3. Request a senior review (advisory, optional)

Senior review is never automatic. Two lifecycle decisions can consume an
accepted senior review:
- Quality-report decision (S16, Phase 2U)
- PR-readiness decision (S17, Phase 2X)

The default (deterministic) review is always produced and preserved
regardless of whether a senior review is requested.

## 4. Create a one-use senior execution approval (Gate 1)

Authorizes S14 to submit exactly one S13 request. It does **not** accept the
review. Use the S14 approval machinery (`createSeniorApprovalArtifact`) bound
to the specific `veraRequestId` and `approvalReference`, `maxNewTokens = 32`.

## 5. Accept or reject the senior review (Gate 2)

After S13 returns bounded output, S15 records the senior result and the
operator explicitly `accept_senior` or `reject_senior`, confirming the
default, senior, and comparison hashes. Only an accepted, non-stale review
may inform a decision. Rejection leaves the default-only path fully usable.

## 6. Apply the lifecycle operator decision (Gate 3)

- Quality report (S16): `approve_quality_report` / `reject_quality_report`
  (confirm `APPROVE VERA POST-PATCH QUALITY REPORT`).
- PR readiness (S17): `mark_pr_ready` / `mark_pr_not_ready` /
  `request_pr_readiness_revision`. `mark_pr_ready` requires typing exactly
  `PREPARE VERA PULL REQUEST` and drives the existing Phase 2X prepare.

The operator may follow, override, or disregard the senior recommendation.
A senior "ready"/"approve" never auto-advances; "not_ready"/"reject" never
auto-blocks.

## 7. PR creation remains separately gated (Gate 4)

Marking PR-ready does **not** create a PR. PR creation is Phase 2Y
(`CREATE VERA PULL REQUEST`) and requires its own separate approval. S16/S17
never create, push, approve, or merge a PR.

## 8. Cancel a request

Issue the S14/S15 cancellation path. The default review remains available,
no accepted senior influence is recorded, and Console Nano is restored.

## 9. Recover a request (after restart)

On restart, pending decision contexts are recovered, S15/S14/S13
correlations reconnected, artifact hashes validated, and stale contexts
marked. Recovery never auto-accepts, auto-approves, auto-marks-ready, or
duplicates a lifecycle application.

## 10. Shut down S13 (bounded)

```bash
curl -s -X POST http://127.0.0.1:8091/v1/shutdown | jq
```

Expected: bounded shutdown (`s13_shutdown_complete`), Nano restored,
port `8091` released, `exitCode 0`, SIGKILL unused in normal closure
(S13.1 bounded shutdown with emergency fallback).

## 11. Verify Nano health after any senior request

```bash
curl -s http://127.0.0.1:8082/v1/models | jq '.data[].id'   # Console Nano
curl -s http://127.0.0.1:8081/v1/models | jq '.data[].id'   # Vera Nano
```

Both must list `Nemotron-Nano-30B-A3B-NVFP4`.

## 12. Diagnose blocked readiness

- `senior_service_not_ready: s13_not_accepting` → wait until
  `readiness.acceptingRequests = true` before submitting.
- `senior_recovery_required` → run recovery; do not force.
- `source_commit_mismatch` / `source_manifest_mismatch` → the S13 baseline
  fingerprint must match the running executable source.
- Stale decision context → regenerate/re-accept a review for the changed
  artifact; a prior decision is never silently rebound.

## 13. Fake-quant vs native-FP8

The runtime executes ModelOpt fake-quant on CUDA. Native FP8 kernels are
**unproven**. Do not represent pilot results as native FP8 performance.
