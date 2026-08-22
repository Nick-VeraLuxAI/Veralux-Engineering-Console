# Autonomous Engineer — post-V1 backlog

Not in V1 RC. No commitment to schedule. **Do not implement on the freeze branch without a new qualification cycle.**

## Intelligence / product (post-V1)

- Q1 remaining specimen (`attempt_limiter_feature`) if a 3/3 triad is later required
- Historical robust-matrix gaps (`rate_limit_feature` / some concurrency) — requal, do not silently raise semantic budgets
- Active SkillOpt prompt injection after A/B gate (see `ae-skillopt-learning-layer-v1.md`)
- Read-only Console UI for SkillOpt candidates / shadow hits
- Additional model families using the 9-step onboarding playbook
- Super / AirLLM as AE worker remains **forbidden** unless a separate product + qualification program exists

## Ops / packaging (non-intelligence)

- Align operator `.env.local` FAITHFUL URL (8082) vs CONTROL (8081) without committing secrets
- GPU1 exclusive policy automation (pause Video-Gen when starting FAITHFUL)
- Publish/tag **Autonomous Engineer V1 RC1** when an operator authorizes tags
- Open PR from combined SkillOpt branch when an operator authorizes

## Explicitly not backlog-as-V1-hotfix

- Prompt / heuristic / Nano weight / Super / semantic-budget / QC-weakening changes
- SkillOpt injection on by default

---

*End of post-V1 backlog.*
