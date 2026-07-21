# Super AirLLM Repair — S15.1 Bounded Long-Form Senior Generation (v1)

## Status

Implementation baseline for S15.1. Live verification results are recorded after authorized runtime runs.

## S15 live-closeout baseline

- Parent: `6f5fa9040d4b402196c7b426bf39f88b38c7c2f7`
- Live-closeout commit: `e0b6173e292c02b8925ee08994d60163237e1419`
- Tree: `3dd85daf9362f2894dd677fdfbc47a504781c795`
- Message: `Record live S15 senior-review verification`

## S15.1 branch

- Branch: `feature/super-airllm-s15-1-long-form-generation`
- Parent: S15 live-closeout commit above

## Current token-generation architecture

- Prior limit: `maxNewTokens ∈ {1, 2}`
- Configured limit: `32`
- Verified limit target: `32` (only after live proof)
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
- `verifiedMaxNewTokens = 32` (claim only after live proof)
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
- Accepted senior output still cannot execute actions

## Execution classification

```text
Quantized topology executed: modelopt fake-quant CUDA path
Modelopt fake-quant CUDA path executed: true (when live)
Native extension available: false (as previously recorded)
Native FP8 kernel proven: false
Fallback detected: false (required)
Generation strategy: full_prefix_recomputation
Verified maximum generated tokens: pending live proof
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

## Live results

Filled after authorized S15.1 runtime verification.

## Final verdict

Pending live verification. Implementation automated tests must pass before runtime authorization is exercised.
