# Super AirLLM Repair — S15.1 Bounded Long-Form Senior Generation (v1)

## Status

**S15.1 READY — BOUNDED LONG-FORM GENERATION**

Verdict: `s15_1_bounded_long_form_ready`

## S15 live-closeout baseline

- Parent: `6f5fa9040d4b402196c7b426bf39f88b38c7c2f7`
- Live-closeout commit: `e0b6173e292c02b8925ee08994d60163237e1419`
- Tree: `3dd85daf9362f2894dd677fdfbc47a504781c795`
- Message: `Record live S15 senior-review verification`

## S15.1 immutable baseline

- Branch: `feature/super-airllm-s15-1-long-form-generation`
- Implementation commit: `7b5dd3687fdae3fa6d6f2ceeff8c81cf304ac0c1` (`Add bounded long-form senior generation`)
- Live tip (includes FSM + verify tooling fixes): `1846495ec119afcbf568f2377de9b7abbb79619e`
- Parent of implementation: `e0b6173e292c02b8925ee08994d60163237e1419`

## Current token-generation architecture

- Prior limit: `maxNewTokens ∈ {1, 2}`
- Configured limit: `32`
- Verified limit: `32` (live-proven)
- Strategy: `full_prefix_recomputation` (not KV-cache serving)
- Each generated token requires one full 88-layer pass
- Each token step runs in a fresh worker process
- Durable progress: `generated-tokens.json` + `token-steps/NNNN/step.json`
- Between-token resume reconstructs prefix from completed steps and continues at the first incomplete step
- Cancellation checked before Nano interruption, between tokens, and during worker wait
- Partial/cancelled outputs are preserved but not S15-acceptable

## Generation limits

Derived from model config (`max_position_embeddings = 262144`) and operational bounds:

- `configuredMaxNewTokens = 32`
- `verifiedMaxNewTokens = 32`
- `maxPromptTokens = 4096`
- `maxCombinedContextTokens = 4128`
- `maxOutputBytes = 65536`
- Greedy only; `temperature = 0`; no sampling
- EOS token id `2`; optional explicit `stopTokenIds`
- Arbitrary stop strings rejected without token-id conversion

## S14 approval-scope expansion

- Approval binds `maxNewTokens` ceiling
- A 2-token approval cannot authorize 32 tokens
- A 32-token approval may stop early on EOS
- Invariants unchanged: `defaultRoute=false`, `automaticSelection=false`, `explicitApprovalRequired=true`, `localOnly=true`, `maxConcurrentRequests=1`

## S15 review integration

- S15 requests senior review only through S14
- Comparison runs only on complete senior output
- Partial/cancelled/failed senior output cannot be accepted
- Operator acceptance remains separate from S14 execution approval
- Accepted senior output still cannot execute actions (`downstreamActionAuthorized = false`)

## Live verification run

- Run ID: `s15-1-live-20260721T235130Z`
- Artifact dir: `.download-logs/s15-1-long-form-generation/s15-1-live-20260721T235130Z/`
- Canonical: `.download-logs/super-s15-1-long-form-generation-result.json`

### Scenario results

| Scenario | Result |
|---|---|
| 1 — Hello / 1 token | `[1044]` match |
| 2 — France / 2 tokens | `[6993, 32876]` match |
| 3 — 8 tokens | `[1531, 1032, 1049, 1057, 1057, 1048, 1115, 7455]` → ` The 1990s saw` |
| 4 — 32-token S15→S14→S13 | 32 tokens completed; operator `accept_senior`; no action authorized |
| 5 — cancel after tokens | 2 tokens preserved; `s15AcceptanceEligible=false`; Nano restored |
| 6 — resume after worker kill | Interrupted after `[1531, 1032]`; resumed at step 3; final `[1531, 1032, 1049, 1057]` with no duplicate prefix |
| 7 — repeated requests | Two sequential Hello requests; serialized; Nano healthy |

### Senior review output (scenario 4 excerpt)

```text
 Use the exact labels: finding:, recommendation:.
Do not add explanations.
</think>
finding: missing null check in parser
recommendation: add unit
```

Structurally usable for comparison/acceptance (findings + recommendations labels present). Quality is not the sole technical criterion.

### Prompt hash (scenario 4)

`0c6fead0a64daba8c85a8add6f99d857049e3fc5960c53cbe32b89643a2542b5`

### S13 request (scenario 4)

`s13-20260722T012641Z-0c0e84ccd6`

## Performance

- Full-prefix recomputation: up to N complete 88-layer passes for N tokens
- Observed ~8–10 minutes per token on this host
- 32-token senior review completed with `completionReason: max_new_tokens`
- S13.1 shutdown after live suite: ~1s elapsed in verifier poll window; port 8091 released

## Nano lifecycle

- Console Nano (`:8082`) interrupted for generation and restored
- Vera Nano (`:8081`) remained healthy throughout
- Post-run both Nanos report `Nemotron-Nano-30B-A3B-NVFP4`

## Execution classification

```text
Quantized topology executed: yes (modelopt fake-quant CUDA path)
Modelopt fake-quant CUDA path executed: true
Native extension available: false (as previously recorded)
Native FP8 kernel proven: false
Fallback detected: false
Generation strategy: full_prefix_recomputation
Verified maximum generated tokens: 32
```

## Automated tests (at implementation)

```text
PYTHONPATH=vendor/airllm-nemotronh .venv-airllm/bin/python -m pytest vendor/airllm-nemotronh/tests/ -q
→ 209 passed

npx vitest run src/lib/engineer-console/experimental/super-airllm/
→ 122 passed

Focused S15.1 Vitest: 9 passed
Focused S15 workflow: 21 passed
Focused S14: 23 passed
```

## What this is not

- Not native FP8
- Not efficient KV-cache serving
- Not token streaming to clients
- Not production throughput
- Not unlimited generation
- Not autonomous senior review
- Not S16
- Not production readiness

## Final verdict

`s15_1_bounded_long_form_ready`

## Next gate

**S16 AUTHORIZED AS THE NEXT GATE**

S16 (definition only — do not implement automatically): gated use of one explicitly accepted senior review inside one narrowly selected VeraLux lifecycle decision, while preserving every existing action and execution approval.
