# 33 — Super AirLLM Repair S14: Gated Senior-Worker Adapter (v1)

# Final status (post-verification)

```text
S14 READY — GATED FAKE-QUANT SENIOR ADAPTER
s14_gated_senior_adapter_ready_fake_quant
```

| Repo | Branch | S14 tip commit |
| --- | --- | --- |
| Engineering Console | `repair/super-airllm-s14-senior-adapter` | `55abb4afceceb498f8aaf7acee94dfa9e56b1b48` |
| VeraLux System | `repair/super-airllm-s14-senior-adapter` | `36d97d80237edc8f94ce4b301d535a40cd307faa` |
| S13 immutable | parent | `614377b02fa7ee06976fd58aeccaa7965a96b6e6` |

Live run: `.download-logs/s14-senior-adapter-verification/20260721T175152Z-55abb4af/`

Deterministic tokens confirmed: Hello `[1044]`; France `[6993, 32876]`.

---


Status: implementation complete; immutable baseline / live routing verification require paired authorization flags.

## S13 baseline (immutable)

| Field | Value |
| --- | --- |
| Branch | `repair/super-airllm-s13-local-service` |
| Commit | `614377b02fa7ee06976fd58aeccaa7965a96b6e6` |
| Tree | `782cb94c468e80ea2dee782d2af22ba1fe784d89` |
| Source-manifest digest | `854cb103721d2064bcbffc862ea941857c13dccc3bab3c5b0a4124b887e0d3e2` |
| Executable SHA-256 | `49b64865355bc1f436910c6ed85e8c24b96fd65bbe86ad949fcfaeda8549017f` |
| Endpoint | `http://127.0.0.1:8091` |
| Verdict | `s13_local_service_ready_fake_quant` |

S14 does **not** amend the S13 commit.

## S14 repositories and branches

| Repository | Branch | Role |
| --- | --- | --- |
| VeraLux Engineering Console | `repair/super-airllm-s14-senior-adapter` | S14 adapter (HTTP client to S13), approval gate, correlation, verification CLI |
| VeraLux System | `repair/super-airllm-s14-senior-adapter` | Registry gated metadata + eligibility helpers; no CUDA / no Nano stop |

Coordinated: System owns routing/registry truth; Console owns the S13 client adapter and durable correlation for experimental senior generation.

## Prior senior block (preserved)

Builder Loop V2a still returns `ready: false` with:

```text
senior_model_execution_not_implemented_v2a
```

S14 does **not** remove that block for arbitrary Builder Loop execute. Gated senior generation is a separate Console adapter path with explicit approval artifacts.

## Existing routing state

| Item | Value |
| --- | --- |
| Registry entry | `airllm-nemotron-super-120b-senior-candidate` |
| Prior health | `candidate` |
| After promotion helper | `gated_available` (never `healthy`) |
| Senior role | `console_senior_reviewer` |
| Default worker | `local-nemotron-nano-30b-console` (`console_default_worker`) |
| Auto-select rule | `selectRuntimeForRole` only selects when `health_state === "healthy"` |

## Adapter architecture (Console)

Home: `src/lib/engineer-console/experimental/super-airllm/s14-senior-adapter/`

| Component | Responsibility |
| --- | --- |
| `s13-client.ts` | Loopback-only HTTP client (`GET /v1/health`, `/v1/readiness`, `POST/GET /v1/generations`, cancel) |
| `approval-gate.ts` | `s14_senior_execution_approval_v1` + SHA-256 binding (request, runtime, scope, expiry, one-use) |
| `route-gate.ts` | Eligibility; senior designation alone insufficient |
| `correlation-store.ts` | Atomic JSON correlation under isolated state root |
| `senior-runner.ts` | Decide → validate S13 → submit → poll → complete / cancel / reconcile |
| `fallback-policy.ts` | Default off; only pre-submission eligible codes; no worker-identity disguise |
| `registry-view.ts` | Truthful gated registry facts (`defaultRoute=false`, fake-quant, not native FP8) |
| `state-map.ts` | S13 states → `senior_*` adapter states |

The adapter **must not**: import model weights / AirLLM loader, allocate CUDA, stop Nano, or reproduce S13 queue/worker logic.

## Approval gate

Artifact schema: `s14_senior_execution_approval_v1`

Bindings:

- VeraLux request ID
- Runtime ID (`airllm-nemotron-super-120b-senior-candidate`)
- Operation `senior_generate` (inspection ≠ execution)
- Approver identity + timestamp
- Scope: `maxNewTokens` ∈ {1,2}, `generationPolicy: greedy`
- Optional expiry; one-use by default
- `artifactHash` over canonical fields

Unapproved / mismatched / expired / scope-expanded requests receive stable reason codes and **never** call S13.

## Registry promotion

System registry fields (actual names):

```text
health_state: candidate → gated_available   # via applyS14GatedSeniorPromotion()
gated_senior.default_route = false
gated_senior.automatic_selection = false
gated_senior.explicit_approval_required = true
gated_senior.local_only = true
gated_senior.native_fp8_kernel_proven = false
gated_senior.execution_mode = modelopt_fake_quant_cuda
gated_senior.max_concurrent_requests = 1
```

Promotion alone does **not** make Super selectable as a default; `healthy` remains required for `selectRuntimeForRole`.

## No-default invariants

- Ordinary requests (`seniorRequested` false) never submit to S13
- Healthy S13 does not change Nano default routes
- Registry promotion ≠ automatic senior selection
- Approvals do not leak to later requests
- Fallback from Nano to senior never occurs
- Senior use requires explicit route decision + approval

## S13 client contract

- Base URL must be loopback (`127.0.0.1` / `localhost` / `::1`); credentials rejected
- Submit body: `{ prompt, maxNewTokens: 1|2, generationPolicy: "greedy", requestKey }`
- Persist S13 `requestId` before polling
- Completion requires S13 `completed` + tokens + `nanoRestored: true` + no fallback

## Request correlation

Durable bidirectional map: VeraLux request ID ↔ S13 request ID, plus approval reference, idempotency key, states, terminal result/error. Duplicate same payload reuses correlation; conflicting payload rejected. Adapter restart reconciles nonterminal records without duplicate submit.

## Status mapping

| S13 | Senior adapter |
| --- | --- |
| queued | senior_queued |
| stopping_nano | senior_acquiring_runtime |
| streaming_layers / generating | senior_executing |
| restoring_nano | senior_operational_cleanup |
| completed | senior_completed |
| cancelled | senior_cancelled |
| recovery_required | senior_recovery_required |
| failed | senior_failed |

## Cancellation / timeouts / failure isolation

- Cancel persists intent → `POST .../cancel` → poll to terminal
- Separate deadlines: connect, queue, active, cleanup, cancellation
- Adapter timeout → `senior_status_unknown` with correlation preserved (no replacement request)
- Malformed / unavailable S13 does not crash the VeraLux process

## Fallback policy

Default **disabled**. Eligible only when request `allowFallback` and failure is pre-submission (e.g. service not ready / unavailable). Never disguise Nano output as Nemotron Super. Ambiguous / post-submission / cancel / nano-restore failures cannot silently fallback.

## Deterministic model results (S13 baseline)

| Prompt | Tokens |
| --- | --- |
| `Hello` | `[1044]` |
| `The capital of France is` | `[6993, 32876]` |

## Fake-quant vs native FP8

| Fact | Value |
| --- | --- |
| Execution mode | `modelopt_fake_quant_cuda` |
| Native ModelOpt FP8 extension | false |
| Native FP8 CUDA kernel proven | false |

S14 must not claim native FP8.

## Verification CLI

```bash
# Baseline freeze (paired flags required)
./scripts/runtime/super-airllm/run-s14-senior-adapter.sh \
  --allow-create-s14-baseline-commit --confirm-create-s14-baseline-commit

# Live routing verification (paired flags required; S13 on :8091)
./scripts/runtime/super-airllm/run-s14-senior-adapter.sh \
  --allow-s14-senior-routing-verification --confirm-s14-senior-routing-verification
```

Artifacts:

- `.download-logs/s14-senior-adapter-verification/<run-id>/`
- `.download-logs/super-s14-senior-adapter-result.json`

## Authorization

| Action | Flags |
| --- | --- |
| Immutable S14 baseline commit | `--allow-create-s14-baseline-commit` + `--confirm-create-s14-baseline-commit` |
| Real senior-routing verification | `--allow-s14-senior-routing-verification` + `--confirm-s14-senior-routing-verification` |

Do not reuse S11–S13 authorization flags as senior-routing approval.

## Limitations

- Not default large-model execution
- Not autonomous escalation
- Not remote S13
- Not concurrent senior requests
- Not token streaming / >2 tokens
- Not production rollout
- V2a Builder Loop execute path remains blocked

## Next gate (do not implement)

**S15: approved senior-review workflow integration** — gated lifecycle steps may request senior review, compare senior vs default-worker outputs, preserve both, and require explicit operator acceptance before senior results affect execution. Senior must not become the default decision-maker.

## Final verdict (implementation freeze pending auth)

When baseline + live scenarios pass under authorization:

```text
s14_gated_senior_adapter_ready_fake_quant
```

Without baseline authorization: `s14_baseline_commit_not_authorized`.  
Without routing verification authorization: `s14_runtime_verification_not_authorized`.
