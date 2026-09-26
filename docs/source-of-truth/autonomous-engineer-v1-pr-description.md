# Autonomous Engineer V1 RC — pull request description (prepared, not opened)

**Do not open this PR unless an operator explicitly authorizes.** This file is packaging only.

**Live-delivery gate (2026-08-21 packaging):** ordinary FAITHFUL smoke was **not** delivery-ready (`BUDGET_EXHAUSTED` / post-review). Final report verdict is `RELEASE CANDIDATE NOT READY` / `NOT READY TO OPEN PR` until a later live smoke is delivery-ready. Do not claim this file authorizes opening.

**Suggested title:** `feat(engineer-console): Autonomous Engineer V1 RC1 with passive SkillOpt`

**Suggested head:** `feature/ae-skillopt-learning-layer`  
**Suggested base:** `main`  
**Relation:** SkillOpt branch already contains AE V1 freeze packaging (`f57fce2`) as ancestor. Intelligence freeze remains `0ad49d4`. Do not merge SkillOpt into `feature/autonomous-engineer-v1` unless a combined candidate on that name is requested.

## Summary

- Freeze the qualified Autonomous Engineer V1 intelligence loop (`SHARED BASELINE RESTORED — Q1 CLOSED — ROBUST CODE QUALIFIED`).
- Ship SkillOpt as a **passive / shadow-only** learning layer: capture, extraction, curation, versioning, evidence linking, shadow retrieval.
- **Prompt injection remains OFF.** SkillOpt does not improve AE in this release; `AE PROMPTS MODIFIED BY SKILLOPT = 0`.
- Document FAITHFUL Nano ops (8082), GPU1 exclusive policy, CONTROL rollback (8081, below qualified envelope).

## What is not in this PR

- Active SkillOpt injection or any claim of quality gain from skills
- Super / AirLLM as AE worker
- Nano weight or serve-knob changes
- Raised semantic budgets / weakened QC, review, AC, or governance
- Temp probes, model blobs, secrets, scratch worktrees

## Test plan

- [ ] `npx vitest run src/lib/engineer-console/autonomous-engineer src/lib/engineer-console/worker-plan` → 170/170
- [ ] `npx vitest run src/lib/engineer-console/skillopt` → prompt hashes equal, `actuallyInjected=false`
- [ ] Quality-gate tests in `src/lib/engineer-console/bridge/run-vera-post-patch-quality-gates.test.ts` and readiness sibling
- [ ] Live FAITHFUL health: `curl http://127.0.0.1:8082/v1/models` → `max_model_len=262144`
- [ ] Optional live smoke: `npx tsx scripts/runtime/autonomous-engineer/live-v1-final-release-smoke.ts` with BASE_URL 8082
- [ ] Confirm `.env` does not enable `ENGINEER_CONSOLE_SKILLOPT_PROMPT_INJECTION`

## Reviewer notes

CONTROL Nano (`ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION=false`, BASE_URL 8081) is **not** the qualified envelope.

Release identifier recommendation: **Autonomous Engineer V1 RC1**. Do not create git tags unless authorized.

---

*End of prepared PR description.*
