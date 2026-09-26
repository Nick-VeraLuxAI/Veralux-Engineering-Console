# Super AirLLM Repair — S16 Gated Quality-Report Decision (v1)

## Status

**S16 READY — GATED QUALITY-REPORT DECISION**

Verdict: `s16_gated_quality_report_decision_ready`

## S15.1 baseline

- Executable live-fix tip: `1846495ec119afcbf568f2377de9b7abbb79619e`
- Documentation tip: `6c787aeb647ba6ab3944a35bd29457ccf2eef279`
- Executable source-manifest digest: `cea755aca9d56f9e7dd7936c262b538198767f8e4b35c227209e1e82571ed840`
- Verdict: `s15_1_bounded_long_form_ready`
- Max new tokens: `32`
- Execution mode: `modelopt_fake_quant_cuda`
- Generation strategy: `full_prefix_recomputation`
- `nativeFp8KernelProven = false`
- `automaticSeniorSelection = false`
- `defaultSeniorRoute = false`

## Selected quality-report gate

S16 extends the existing Phase 2U gate — it does **not** create a parallel approval system.

| Field | Value |
|---|---|
| Gate name | `post_patch_quality_report_decision` |
| Phase label | 2U |
| Create entry | `runVeraPostPatchQualityGates` |
| Review entry | `reviewVeraPostPatchQualityReport` |
| API route | `POST /api/engineer-console/runs/{id}/vera-post-patch-quality-report-review` |
| Approve confirmation | `APPROVE VERA POST-PATCH QUALITY REPORT` |
| Reject confirmation | `REJECT VERA POST-PATCH QUALITY REPORT` |
| Run status | remains `waiting_for_approval` |
| Step after gates | `implementation_post_patch_quality_gates_completed` |
| Approved step | `implementation_post_patch_quality_report_approved` |
| Rejected step | `implementation_post_patch_quality_report_rejected` |
| Downstream | Phase 2V `prepareVeraCommitProposal` (separately gated) |
| Approval | one-use (duplicate → 409) |

There is no LLM default-worker review on this gate. S16 uses a **deterministic summary** of the quality report as `defaultReview` (`runtimeId: deterministic-quality-report-summary`).

## Current lifecycle behavior

1. Post-patch quality report produced (`post-patch-quality-report.json`, SHA-256 of pretty JSON).
2. Run waits at `implementation_post_patch_quality_gates_completed`.
3. Operator posts approve/reject with exact confirmation phrase.
4. Governance notes record decision + approved/rejected hash.
5. Downstream commit-proposal readiness still requires separate Phase 2V authorization.

## Three approval boundaries

1. **Senior execution approval (S14)** — authorizes S14 to call S13. Does not accept the review. Does not approve the quality report.
2. **Senior review acceptance (S15)** — authorizes the exact completed senior artifact to inform S16. Does not approve/reject the quality report.
3. **Quality-report operator decision (Phase 2U / S16 Gate 3)** — only this boundary may mark the report approved/rejected, update lifecycle step, write the decision artifact, and set downstream eligibility for Phase 2V readiness checks.

Runtime assertions reject gate substitution.

## S16 decision context

Schema: `s16_quality_report_decision_context_v1`

Durable fields include quality-report ref + hashes, default review, optional accepted senior review (with execution + acceptance references), recommendation summary, operator decision (with reviewed hashes), and lifecycle effect (`appliedBySenior` always `false`).

Before operator decision: `qualityReportDecision = pending`, `downstreamEligible = false` — even when senior is accepted.

## Senior-review prompt

Deterministic prompt built from quality-report summary/hash, default review/hash, 32-token max, explicit advisory language:

> You are advising a human operator.  
> You do not approve or reject this report.  
> You do not authorize downstream actions.

Prompt text + SHA-256 preserved with generation metadata.

## Recommendation extraction

Narrow structured form only: `approve | reject | needs_revision | neutral` via `recommendation: <value>` lines. Invalid / free-form positive language → `neutral`. Raw output always preserved. Parsing failure does not block default-only operator path.

## Operator overrides

Operator may follow, override, or disregard senior recommendation. Disagreements recorded (`followedSeniorRecommendation`, recommendation summary disagreements). No model approval artifact is created.

## Staleness

Changes to quality-report hash, default-review hash, senior-review hash, comparison hash, or acceptance binding mark the context stale. Stale senior cannot influence a new decision. Prior operator decisions are never silently rebound.

## Idempotency

- Duplicate senior request (same S15 idempotency key) returns existing correlation.
- Duplicate identical operator decision returns existing applied result (one lifecycle transition).
- Conflicting terminal decision rejected.

## Recovery

`recover()` returns pending contexts after restart without auto-approve, auto-reject, or duplicate lifecycle application.

## No-action boundary

S16 cannot apply patches, create commits/PRs, merge, deploy, send external messages, or modify other lifecycle gates. Action counters remain zero.

## Live verification

Launcher: `scripts/runtime/super-airllm/s16-quality-report-decision-verify.ts`

Flags:

- `--allow-s16-quality-report-verification --confirm-s16-quality-report-verification`
- Live senior: `--allow-s16-live-senior-review --confirm-s16-live-senior-review`
- Nano: `--allow-request-time-nano-interruption --confirm-request-time-nano-interruption`

### Live closeout

- Run ID: `s16-live-20260722T175458Z`
- Artifact dir: `.download-logs/s16-quality-report-decision/s16-live-20260722T175458Z/`
- Canonical: `.download-logs/super-s16-quality-report-decision-result.json`
- Verdict: `s16_gated_quality_report_decision_ready`

| Proof | Result |
|---|---|
| Default-only quality-report decision | passed |
| Unapproved senior blocked | passed |
| Live 32-token senior via S15→S14→S13 | passed (`max_new_tokens`) |
| Senior output preserved | passed |
| S15 acceptance required | `accept_senior` |
| Accepted senior visible in S16 | passed |
| Operator approval required | passed |
| Operator override of senior | `followedSeniorRecommendation = false` (fixture reject → operator approve) |
| Stale report rejection | passed |
| Cancel/fail fallback | passed |
| Duplicate prevention | passed |
| No-action boundary | all false |
| S13.1 shutdown | exit 0 in 3619 ms; SIGKILL unused; port 8091 released |

### Live senior review

- Prompt SHA-256: `833498c9e199750ed908c6fcc8515150ffa60bab3b4f79efdd47ab1bca33c2f6`
- Generated token IDs (32): `[1032, 1010, 9476, 1605, 2229, 17984, 1044, 67273, 1044, 1505, 7481, 4319, 1626, 11186, 2342, 1278, 11748, 1626, 19227, 1273, 54069, 1370, 2811, 1429, 13008, 1672, 36745, 19227, 1273, 54069, 1370, 2811]`
- Decoded (truncated): includes `{"recommendation": "approve"}` (JSON form → S16 extractor yields `neutral` unless labeled `recommendation:` line)
- S15 bundle: `s15-bundle-mrwdubpc-p1f7wlzf`
- S14 correlation: `s15-senior-req-mrwdubpc-9odoxkt9`
- S13 request: `s13-20260722T175502Z-8594b9b86c`
- Acceptance: `accept_senior`

### Operator decision (fixture scenario with accepted senior)

- Decision: `approve_quality_report`
- Senior recommendation followed: `false` (senior fixture recommended reject)
- Resulting step: `implementation_post_patch_quality_report_approved`
- Approved hash written by senior: `false`
- Downstream authorized by senior: `false`

## Nano lifecycle

Live senior path interrupted Console Nano through S13 request-time authorization, then restored. S13.1 bounded shutdown completed when this launcher started S13 (`exitCode=0`, `shutdownMs=3619`, `sigkillUsed=false`). Console Nano (8082) and Vera Nano (8081) healthy after cleanup.

## Fake-quant versus native-FP8

- Execution mode remains `modelopt_fake_quant_cuda`.
- `nativeFp8KernelProven = false` (unchanged).
- S16 never allocates CUDA, never stops Nano itself, never imports model-loading code; it calls S15 only.

## Limitations

S16 is **not**:

- autonomous approval or rejection
- automatic lifecycle advancement
- action execution
- native FP8
- default senior routing
- unrestricted lifecycle integration
- production readiness

Default-only quality-report decisions remain unchanged unless senior review is explicitly requested, generated, and accepted.

## Immutable S16 baseline

- Branch: `feature/super-airllm-s16-quality-report-decision`
- Parent (S15.1 docs tip): `6c787aeb647ba6ab3944a35bd29457ccf2eef279`
- Implementation commit: `1a57426c508a703a57878bcf428431addc5c5817` (`Add gated senior review to quality report decision`)
- Executable tip (Nano port fix): `c6fcc7e21a344fec6a15c02ad604bebf4e2f5e6f`
- Tree SHA (executable tip): `64726cc37006297b4ab2eb9a24a4d1626ef85db5`
- Live verification used executable tip `c6fcc7e21a344fec6a15c02ad604bebf4e2f5e6f`
- Source-manifest digest at live verify: `68c9caa4bbad71dd085b67d3f45dd0b49bfa93a000ecbeaef2fe5ea91868c251`

### Test counts

- Pytest: `209` passed
- Vitest super-airllm: `142` passed
- Focused S16: `20` passed
- Focused S15.1: `9` passed
- Focused S15: `21` passed
- Focused S14: `23` passed
- Quality-report gate: `25` passed

## Final verdict

`s16_gated_quality_report_decision_ready`

## Next gate (not started)

**S17:** reuse the accepted-senior-review policy in one second lifecycle decision (for example pull-request readiness), without making senior review automatic or bypassing any PR-creation approval.

Do not begin S17 from this document.
