# Build / Observe / Release governance modes

Status: **implemented (V1 slice)** — Engineering Console.

## Intent

Operator goals:

1. **Functional code** — Autonomous Engineer iterates until objective tests pass.
2. **Auditable logic** — Policy, review, evidence, and audit stay visible.
3. **Sandbox** — Verify in the isolated worktree before any release path.

Governance should be **observational during build**, and **hard-gated only for release**.

## Modes

| Mode | Env | AE Continue engineering | Policy `requires_review` | Post-accept next step |
|------|-----|---------------------------|--------------------------|------------------------|
| `build` | default when release gates off | Resumes same AE run | Observational (blocked still hard) | Worktree sandbox |
| `observe` | explicit | Same as build | Observational | Worktree sandbox; release panels advisory |
| `release` | when `RELEASE_GATES_ENABLED=true` or explicit | Ends run (legacy send-back) | Hard | PR / merge / deploy |

```env
ENGINEER_CONSOLE_GOVERNANCE_MODE=build
# or observe | release
# When unset: release if ENGINEER_CONSOLE_RELEASE_GATES_ENABLED=true, else build
```

## Continue engineering

In `build` / `observe`, the decision-card action formerly labeled **Send back** becomes **Continue engineering**:

1. Records a `request_fix` decision (audit trail preserved).
2. Appends operator feedback to AE constraints.
3. Transitions AE state `waiting_for_approval` → `diagnosing`.
4. Resumes `executeAutonomousLoop` in the background (same fire-and-forget pattern as starting a run).

In `release`, **Send back** still fails the run (no AE resume).

## Accept delivery

**Accept delivery** (approve) still records human acceptance and completes the run. It does **not** commit, PR, merge, or deploy. In build/observe, post-accept guidance points at the worktree sandbox instead of PR creation.

## Observational Layer

`Veralux-Observational-Layer` remains the future read-only analytics home. Today, audit/policy/evidence live on the run page in Engineering Console. Build mode keeps those as **signals**, not mid-build stop signs (except true `blocked` risk).

## Related

- `src/lib/engineer-console/governance/governance-mode.ts`
- `src/lib/engineer-console/autonomous-engineer/continue-engineering.ts`
- `docs/env-reference.md`
- `docs/source-of-truth/autonomous-engineer-v1.md`
