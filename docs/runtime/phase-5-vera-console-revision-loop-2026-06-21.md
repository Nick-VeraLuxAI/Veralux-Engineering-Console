# Phase 5 Vera Console Revision Loop - 2026-06-21

## Purpose

Phase 5 adds a bounded Vera <-> Console revision loop for prototype/build work. Console runs governed prototype rounds, Phase 4 evaluates each round with the acceptance threshold engine, Vera reviews the evidence, and Vera can request a focused revision when readiness is not proven.

This phase does not add runtime supervision, AirLLM/Super, Qwen fallback, senior escalation, broad task execution, production UI, or integration.

## Flow

```text
Vera sends structured build_prototype spec
-> Console runs governed prototype round
-> acceptance threshold evaluates readiness
-> Console returns evidence/verdict/failures
-> Vera reviews evidence against acceptance criteria
-> if ready: Vera produces approval summary/question
-> if not ready: Vera creates focused revision request
-> Console performs another governed round
-> loop stops at ready, blocked, or max rounds
```

No integration happens before explicit user approval.

## Round Schema

Each `PrototypeRevisionRound` records:

- `round_number`
- `input_spec`
- `console_action_taken`
- `files_changed`
- `commands_run`
- `acceptance_threshold`
- `evidence_path`
- `vera_review_result`
- `revision_request`
- `status`

Round status values:

- `ready_for_user_approval`
- `revision_requested`
- `blocked`
- `max_rounds_reached`

## Loop Limits

The loop uses the existing assignment limits, especially `max_revision_rounds`, defaulting to 3 when not provided. It does not retry forever. When max rounds are reached without readiness, the final result is `max_rounds_reached` and no approval question is emitted.

## Vera Review Behavior

Vera review reads the Console evidence and Phase 4 threshold verdict.

If the evidence is ready:

- no revision request is created
- the final approval question is emitted

If the evidence is not ready:

- Vera creates a focused revision request
- the request includes failed gates, blocked gates, unresolved issues, and a concrete requested change
- requests are scoped to the isolated prototype workspace

Example first-round revision request from proof:

```text
Revise only the isolated prototype workspace to satisfy gate(s): task_tests. First issue: Latest configured task-specific test results failed or did not run.
```

## Console Revision Behavior

Console accepts the structured revision request and performs another governed prototype round. In Phase 5 this remains deterministic/proof-harness based, but the loop shape is real and testable: every round writes evidence and receives a fresh acceptance verdict.

## Acceptance Threshold Per Round

Every round includes a Phase 4 threshold verdict. A round cannot be ready unless `evaluateAcceptanceThreshold(...)` returns `ready_for_user_approval`.

Final loop readiness requires:

- final round threshold verdict is ready
- Vera evidence review reports ready
- approval question is generated
- integration is false

## Safety Boundaries

- Prototype files stay under `.prototype-loop/<task-id>`.
- No integration before explicit approval.
- Role policy is respected.
- No fallback is used.
- Qwen remains forbidden.
- Senior/Super remains blocked.
- AirLLM/Super is not started.
- Vera does not write to repositories.
- Console writes only inside governed prototype workspaces.
- Missing/unknown roles fail closed through Phase 3 role policy.

## Proof Harness

Run:

```text
npx tsx scripts/prototype-loop/run-prototype-loop-v1-revision-loop.ts --proof-run-root .prototype-loop/phase-5-proof-runs
```

The harness demonstrates:

- direct-ready case: 1 round, ready for approval
- revision-needed case: first round fails `task_tests`, Vera requests a focused revision, second round passes
- no integration performed
- no fallback used
- senior/Super not used
- final approval question generated only after final readiness

Proof result paths:

- `.prototype-loop/phase-5-proof-runs/direct-ready/prototype-revision-loop-prototype-loop-v1-99fce319cf42-result.json`
- `.prototype-loop/phase-5-proof-runs/revision-then-ready/prototype-revision-loop-prototype-loop-v1-99fce319cf42-result.json`

Final revision scenario evidence path:

```text
.prototype-loop/phase-5-proof-runs/revision-then-ready/evidence/round-2/prototype-loop-v1-99fce319cf42.json
```

## Remaining Gaps

Future phases may add runtime supervisor/recovery, AirLLM/Super compatibility proof, senior escalation, richer worker-generated revisions, and UI surfaces. Those remain explicit non-goals for Phase 5.
