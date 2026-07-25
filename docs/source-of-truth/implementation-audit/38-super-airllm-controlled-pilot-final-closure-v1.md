# 38 — Super AirLLM Controlled-Pilot Final Closure (v1)

Status: **VERALUX SUPER CONTROLLED PILOT READY** —
`super_airllm_controlled_pilot_ready` (live run `final-cp-20260725T163327Z`;
see §13). Historical blocked verdicts are preserved below and in
`.download-logs/super-airllm-final-closure/` — earlier revisions of this
document recorded `super_airllm_final_closure_blocked` for the NVML mismatch
(later resolved) and the subsequent ENOSPC-terminated live run
`final-cp-20260725T054331Z` (30/32 tokens).

This records the complete S8–S17 lineage and the S17 second-lifecycle
integration. Implementation, automated tests, fixture/end-to-end
verification, and (as of `final-cp-20260725T163327Z`) the **live**
second-lifecycle proof are complete. This document does **not** claim
production readiness, native FP8, or default senior routing.

---

## 1. Lineage (S8–S17)

| Phase | Meaning | Commit / status |
|-------|---------|-----------------|
| S13.1 | Bounded S13 shutdown | `79bc766…` — `s13_1_bounded_shutdown_ready_with_emergency_fallback` |
| S15 | Senior-review acceptance | `e0b6173…` (tree `3dd85da…`) |
| S15.1 | Bounded long-form (32 tokens) | exec `1846495…`, docs `6c787ae…` — `s15_1_bounded_long_form_ready` |
| S16 | Gated quality-report decision (Phase 2U) | impl `1a57426…`, exec `c6fcc7e…`, docs `becc7b2…` — `s16_gated_quality_report_decision_ready` |
| S17 | Gated PR-readiness decision (Phase 2X) | impl `1333b7e…` (tree `0fe3b0b…`) |

Final-closure branch: `feature/super-airllm-final-controlled-pilot`
(created from the S16 closeout commit `becc7b2…`).

## 2. Runtime architecture

```text
executionMode          = modelopt_fake_quant_cuda   (NOT native FP8)
generationStrategy     = full_prefix_recomputation   (NO KV-cache decoding)
verifiedMaxNewTokens   = 32
nativeFp8KernelProven  = false
fallbackDetected       = false
```

S13 is a loopback-only (`127.0.0.1:8091`) queue-serialized service. Console
Nano (`nemotron-nano-console-8082`, GPU 1) is interrupted **at request time**
to free the GPU for the 120B model, then restored. Vera Nano
(`nemotron-nano-vera-8081`, GPU 0) is unaffected. S13.1 provides bounded
shutdown with an emergency fallback.

## 3. S16 quality-report integration (Phase 2U)

Existing gate `reviewVeraPostPatchQualityReport` (`APPROVE/REJECT VERA
POST-PATCH QUALITY REPORT`) reused unchanged. An explicitly accepted senior
review may inform, but never make, the operator decision. Frozen and ready.

## 4. S17 second-lifecycle integration (Phase 2X — PR readiness)

### Selected gate

`prepareVeraPullRequest` (Phase 2X), confirmation `PREPARE VERA PULL
REQUEST`, prerequisite step `implementation_commit_created`, resulting step
`implementation_pull_request_prepared`, artifact
`implementation-pull-request-preparation.json`
(`veralux.vera.implementation-pull-request-preparation.v1`). It occurs after
quality-report approval and commit creation, and before the irreversible PR
creation (Phase 2Y `CREATE VERA PULL REQUEST`, reserved/unimplemented) —
the safest second integration point.

### Four independent decision boundaries

1. **Senior execution approval** (S14) — authorizes one S13 request only.
2. **Senior review acceptance** (S15) — binds the exact senior artifact.
3. **PR-readiness operator decision** (S17) — `mark_pr_ready` /
   `mark_pr_not_ready` / `request_pr_readiness_revision`.
4. **PR-creation approval** (Phase 2Y) — separate; never authorized by S17.

No earlier gate substitutes for a later one (`assertGatesAreSeparate`).

### Senior influence, staleness, idempotency, recovery, no-action

- Accepted senior review may influence only display/recommendation/rationale;
  it cannot change run state, set readiness, or authorize PR creation
  (`assertSeniorCannotChangeLifecycle`, `appliedBySenior:false`,
  `prCreationAuthorized:false`).
- Recommendation extraction is strict (`ready|not_ready|needs_revision|
  neutral`); anything else → `neutral`. Raw output preserved.
- Staleness: any change to PR preparation / default review / quality-report /
  branch / commit / senior review / comparison marks the context stale and
  rejects a decision on old hashes.
- Idempotency: duplicate `mark_pr_ready` returns the existing decision;
  conflicting terminal decisions are rejected.
- Recovery: pending contexts recovered without auto-mark-ready / auto-PR /
  duplicate lifecycle application.
- No-action boundary: `apply_patch`, `git_commit`, `push_branch`,
  `create_pr`, `approve_pr`, `merge`, `deploy` all rejected with zeroed
  counters.

## 5. Tests

```text
209  pytest (vendor/airllm-nemotronh/tests)
164  Super AirLLM Vitest (incl. 22 S17, 20 S16, 21 S15, 23 S14, 9 S15.1)
 28  PR-readiness (14) + quality-report gate tests
```

## 6. Fixture / contract / end-to-end verification (passed)

- S17 scenarios 1–10 (default-only, blocked senior, unaccepted senior,
  accepted follow, accepted override, stale, idempotent+conflict,
  cancellation, no-action, no-default) — all pass.
- End-to-end Variant A (default-only): quality-report approve → PR mark-ready,
  PR creation pending; no senior used.
- End-to-end Variant B (senior-advisory): operator **overrode** the senior on
  the quality-report decision and **followed** the senior on the PR-readiness
  decision, proving the senior is advisory, not authoritative. PR creation
  remains pending.

## 7. No-action proof

```text
Patch applied by senior:     false
Commit created by senior:    false
Branch pushed by senior:     false
PR created by senior:        false
Merge performed by senior:   false
Deployment performed by senior: false
```

The Phase 2Y PR-creation gate remains separate and pending.

## 8. Live proof — BLOCKED (host GPU driver/library mismatch)

The live 32-token PR-readiness senior generation (S17→S15→S14→S13) started
correctly: S13 came up loopback-only, accepted the request, and began
request-time Console Nano interruption. It then failed with
`senior_recovery_required` because S13's GPU-by-UUID selection uses NVML, and
the host reports a **driver/library version mismatch** (`NVML library version:
595.84`). S13's shutdown could not restore Console Nano; `docker start
nemotron-nano-console-8082` fails with `nvidia-container-cli: nvml error:
driver/library version mismatch`.

Notably, CUDA **compute** still works for new processes (`torch.cuda.init()`
succeeds) — only NVML and the NVIDIA container runtime are affected. Fixing
this requires reloading the NVIDIA kernel modules or rebooting the host —
root-level, destructive to the currently-running Vera Nano, and outside this
program's authorization.

### Current runtime state
- Vera Nano (8081): healthy.
- Console Nano (8082): **down** (cannot restart until host driver fixed).
- Port 8091: free; no stray S13 processes.

## 9. Nano lifecycle

Console Nano was interrupted at request time as designed but could not be
restored due to the host NVML mismatch. This is a host operations condition,
not an S16/S17 defect.

## 10. Final commits

- S16 closeout (documentation tip): `becc7b2…`
- S17 implementation (immutable): `1333b7e…`
- Final-closure documentation/tooling: this commit.
- Readiness tag: **not created** (criteria not met while live proof blocked).

## 11. Limitations

Max verified output 32 tokens; full-prefix recomputation (slow); no KV-cache
serving; single active request; local-only; Console Nano interruption
required; fake-quant CUDA; native FP8 unproven; no default senior routing; no
autonomous action; human acceptance required; controlled pilot, not
production.

## 12. Verdict history

- 2026-07-24: `super_airllm_final_closure_blocked` — host NVML
  driver/library mismatch (§8, historical). Resolved by host operations.
- 2026-07-25 (run `final-cp-20260725T054331Z`): live generation reached
  30/32 tokens then failed with ENOSPC (root filesystem full; S13 state
  ~44 GiB). Recovery record: `final-cp-enospc-blocked-20260725T101236Z`;
  verdict remained `super_airllm_final_closure_blocked`.
- 2026-07-25 (run `final-cp-20260725T163327Z`): **live proof complete** —
  `super_airllm_controlled_pilot_ready` (§13).

## 13. Live closure — `final-cp-20260725T163327Z` (READY)

### Storage remediation (pre-run, operator-authorized)

Root free space was raised from 80 GiB to ~164 GiB (target ≥160 GiB) by
relocating ~92 GiB of regenerable/superseded data to
`/mnt/model-storage/veralux-super-airllm-archive/20260725/` (ext4, checksummed
rsync moves; see `storage-20260725T161424Z/storage-inventory.json` and
`storage-relocation-manifest.json` under
`.download-logs/super-airllm-final-closure/`). The Nano NVFP4 weights were
relocated to the archive SSD (full per-file SHA-256 verified against two
copies) and both Nano containers were recreated with the archive path
bind-mounted read-only; both returned healthy before the run. No tracked
repo files, decision records, or historical evidence were deleted.

### Live run facts

```text
runId                   = final-cp-20260725T163327Z
verdict                 = super_airllm_controlled_pilot_ready
status                  = VERALUX SUPER CONTROLLED PILOT READY
executionMode           = modelopt_fake_quant_cuda   (native FP8 false)
generationStrategy      = full_prefix_recomputation  (no KV cache)
tokens                  = 32/32 complete (max_new_tokens), no fallback
s13RequestId            = s13-20260725T163330Z-1e78f222d4
s14CorrelationId        = s15-senior-req-ms0l915h-988pzk5c
S13 bind                = 127.0.0.1:8091 (loopback only)
sourceCommit            = afdf30b51200323b5154722c4eae03ac1d9e27b7
executableSourceSha256  = 0d4b3a41273b9ab95460cbca1bae70e402229010a1333ca11261b20b4858f139
duration                = ~4.6 h live generation
disk                    = 164 GiB free at start, 117 GiB at completion (>=40 GiB floor held)
```

- S17 scenarios 1–10 **and** the live scenario all pass; end-to-end Variant A
  (default-only) and Variant B (senior-advisory) pass. In Variant B the
  operator **overrode** the senior on the quality-report decision
  (senior: reject → operator: approve) and **followed** the senior on the
  PR-readiness decision (senior: ready → operator: mark_pr_ready).
- Live senior review: S14 execution approval issued; S15 acceptance
  (`accept_senior`) recorded; S17 operator decision `mark_pr_ready` with
  `prCreationAuthorized:false` and resulting step
  `implementation_pull_request_prepared`. PR creation (Phase 2Y) remains
  pending and separate.
- Console Nano was interrupted at request time and restored; Vera Nano
  remained healthy throughout (`nano-lifecycle.json`).
- No-action proof: patch/commit/branch-push/PR/merge/deploy all `false`.
- Cleanup: S13 exit 0, SIGKILL false, shutdown 3.8 s, port 8091 released,
  both Nanos healthy, no residual workers.
- Canonical result: `.download-logs/super-airllm-final-closure-result.json`
  (+ timestamped copy `…-20260725T210852Z.json`); historical blocked results
  preserved unmodified.

### Classification

Controlled internal pilot readiness only — **not** production. All
limitations in §11 still apply.
