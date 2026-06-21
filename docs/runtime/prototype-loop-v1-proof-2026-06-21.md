# Prototype Loop v1 Proof - 2026-06-21

## Goal

Prototype Loop v1 proves the smallest live Jarvis-like workflow:

1. A user gives Vera a natural-language prototype request.
2. Vera classifies the request, records safe defaults, and creates a structured build request.
3. Vera hands a structured assignment to Engineering Console.
4. Console builds and tests in an isolated prototype workspace.
5. Console generates an evidence bundle.
6. Vera reviews evidence against acceptance criteria and asks the user whether to implement.

This proof does not integrate, merge, deploy, or modify production data.

## Architecture

Vera remains the command and orchestration layer. For Prototype Loop v1, Hermes implements deterministic intake and evidence review in `gateway/prototype_loop.py`.

Engineering Console remains the execution and governance layer. Prototype execution lives in `src/lib/engineer-console/prototype-loop/prototype-loop-v1.ts` and is callable through `scripts/prototype-loop/run-prototype-loop-v1-proof.ts`.

Model routing stays role-driven:

- Vera role: `vera_command`, `http://127.0.0.1:8081/v1`, `Nemotron-Nano-30B-A3B-NVFP4`, no repository writes.
- Console role: `console_default_worker`, `http://127.0.0.1:8082/v1`, `Nemotron-Nano-30B-A3B-NVFP4`, governed prototype writes only.
- Senior role: `console_senior_worker`, blocked as `blocked_unproven`; no AirLLM startup.
- Qwen: no route, fallback, or service is used.

## Vera Request

The live proof used:

```text
Vera, build a tiny CLI tool that reads a text file and returns word count, character count, and the top 5 repeated words. Keep it as a prototype only and ask me before implementing it anywhere.
```

## Clarification Behavior

Vera classified the request as `build_prototype` with no clarification required because the input, output, acceptance criteria, and prototype-only policy were present.

Vera recorded safe defaults:

- Use an isolated Console prototype workspace.
- Do not merge or integrate changes without explicit user approval.
- Use a local CLI script with no external network dependencies.

## Structured Build Request Schema

The Vera build request includes:

- `task_type`
- `objective`
- `user_intent_summary`
- `target_repo_or_workspace`
- `prototype_scope`
- `non_goals`
- `acceptance_criteria`
- `constraints`
- `risk_level`
- `required_tests`
- `evidence_requirements`
- `approval_required`
- `implementation_policy`
- `rollback_expectations`
- `model_role_requirements`
- `loop_limits`
- `original_user_request`
- `clarification_behavior`

## Console Execution Loop

Console receives `assignment_type: prototype_loop_v1_console_build` with objective, acceptance criteria, tests, allowed scope, risk, evidence requirements, approval policy, and loop limits.

For this proof Console created:

- `.prototype-loop/prototype-loop-v1-99fce319cf42/word-count-cli.mjs`
- `.prototype-loop/prototype-loop-v1-99fce319cf42/word-count-cli.test.mjs`
- `.prototype-loop/prototype-loop-v1-99fce319cf42/sample.txt`

Console ran:

```text
node --test word-count-cli.test.mjs
```

## Gates

Minimum gates for v1:

- Prototype tests pass.
- Diff scope remains inside `.prototype-loop/<task_id>`.
- Scoped secret scan passes.
- Evidence bundle is written.
- Approval remains required.
- Integration is not performed.

The live proof evidence reports all gates passed.

## Evidence Bundle Format

The evidence bundle includes:

- `task_id`
- `timestamp`
- `original_user_request`
- `vera_clarification_questions_or_safe_default_rationale`
- `structured_build_request`
- `console_assignment`
- `files_created_or_changed`
- `patch_diff_summary`
- `commands_run`
- `test_results`
- `lint_typecheck_results`
- `secret_scan_result`
- `diff_scope_check`
- `gates`
- `risk_assessment`
- `unresolved_issues`
- `final_readiness_status`
- `implementation_recommendation`
- `approval_required`
- `integration_performed`

Live proof evidence path:

```text
evidence/prototype-loop-v1/prototype-loop-v1-99fce319cf42.json
```

## Final Vera Summary

Vera reviewed Console evidence and produced `ready_for_user_approval`.

Summary:

- Created a tiny Node.js CLI that analyzes a text file and reports word count, character count, and the top 5 repeated words.
- Created it in `/home/ndesantis/Documents/GitHub/Veralux-Engineering-Console/.prototype-loop/prototype-loop-v1-99fce319cf42`.
- `node --test word-count-cli.test.mjs` passed with 2 tests.
- No unresolved issues were reported.
- No integration occurred.

Approval question:

```text
Do you want me to implement this prototype into the target repo, keep it as a prototype only, or discard it?
```

## Proof Results

Status: `PASS`

Preflight runtime checks passed for both Nano endpoints:

- `nemotron-nano-vera-8081` running on `127.0.0.1:8081`
- `nemotron-nano-console-8082` running on `127.0.0.1:8082`
- `/v1/models` returned `Nemotron-Nano-30B-A3B-NVFP4` on both endpoints
- exact smoke prompts returned `Vera route ready` and `Console route ready`
- GPUs 0 and 1 hosted vLLM engine processes
- no active Qwen process/service/container was found

The first live harness attempt failed before execution because Hermes was invoked from the Console working directory without `PYTHONPATH`. The second attempt produced ready Console evidence; Vera review was then rerun against the actual evidence path after correcting a shell-level hardcoded task ID. The implementation did not need code repair for this issue.

## Known Gaps

- Prototype Loop v1 uses a deterministic local runner rather than invoking a free-form model agent to author code.
- Lint/typecheck are recorded as not applicable for the isolated prototype workspace because it has no package configuration.
- Senior/Super remains intentionally unavailable until AirLLM escalation is separately proven.
- The handoff is a proof harness contract, not yet a UI/API workflow.

## Next Steps

- Expose the handoff and evidence review through the Vera and Console product surfaces.
- Add workspace retention/discard actions after user approval choice.
- Promote the deterministic runner into a model-authored worker path once governance gates are stable.
