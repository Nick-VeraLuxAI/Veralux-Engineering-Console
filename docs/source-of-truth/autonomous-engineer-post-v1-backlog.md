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

- Align operator `.env.local` to the local role split in `local-model-runtime-strategy.md` (8081 short worker / 8082 long worker; DeepSeek senior stays opt-in) without committing secrets
- Senior escalation packaging on top of `ae-runtime-profiles-v1.md` (do not auto-serve DeepSeek; do not replace the env-selected 8081 default worker)
- Governed live senior invocation V2: consume `ae-senior-escalation-package-v1.md` only after an operator manually serves FreeToken on 1919 (no auto-serve, no default-worker change)
- Senior Review UI / operator command / escalation queue that stores a package and calls `invokeSeniorReview` only after explicit operator intent
- Run-detail Senior Review panel on top of `ae-senior-review-queue-v1.md` (confirmation phrase, advisory display, no PR/merge authority)
- Durable senior-review evidence artifact per AE run (no release-gate authority)
- Done: Review-workspace Senior Review Advisory on the Evidence panel (`ae-senior-review-evidence-panel-v1.md`) — still not a release gate
- Optional hash-nav / `RUN_PANEL_IDS` entry for Senior Review Advisory so Overview request and Review evidence stay linked
- GPU1 exclusive policy automation (pause Video-Gen when starting FAITHFUL)
- Publish/tag **Autonomous Engineer V1 RC1** when an operator authorizes tags
- Open PR from combined SkillOpt branch when an operator authorizes

## Explicitly not backlog-as-V1-hotfix

- Prompt / heuristic / Nano weight / Super / semantic-budget / QC-weakening changes
- SkillOpt injection on by default

---

*End of post-V1 backlog.*
