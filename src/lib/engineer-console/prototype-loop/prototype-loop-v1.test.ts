import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runPrototypeLoopV1,
  validateConsoleAssignment,
  type PrototypeLoopConsoleAssignment,
} from "./prototype-loop-v1";

const proofRequest = "Vera, build a tiny CLI tool that reads a text file and returns word count, character count, and the top 5 repeated words. Keep it as a prototype only and ask me before implementing it anywhere.";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

function assignment(overrides: Partial<PrototypeLoopConsoleAssignment> = {}): PrototypeLoopConsoleAssignment {
  return {
    assignment_type: "prototype_loop_v1_console_build",
    task_id: "prototype-loop-v1-test",
    objective: "Build a tiny CLI tool that reads a text file and returns word count, character count, and the top 5 repeated words.",
    acceptance_criteria: [
      "CLI accepts a text file path.",
      "CLI reports word count.",
      "CLI reports character count.",
      "CLI reports the top 5 repeated words.",
      "Automated tests pass.",
      "Evidence bundle is generated.",
      "Final output asks for user approval before implementation.",
    ],
    test_expectations: ["node --test word-count-cli.test.mjs"],
    allowed_file_scope: [".prototype-loop"],
    risk_level: "low",
    evidence_requirements: ["task_id", "test_results", "approval_required"],
    approval_policy: {
      approval_required: true,
      integration_allowed: false,
      implementation_policy: "Prototype only. User approval required before implementation.",
    },
    loop_limits: {
      max_implementation_loops: 5,
      max_repair_attempts_per_failing_gate: 3,
      max_revision_rounds: 3,
    },
    model_role_requirements: {
      vera: {
        role_id: "vera_command",
        endpoint: "http://127.0.0.1:8081/v1",
        model: "Nemotron-Nano-30B-A3B-NVFP4",
        repository_write_allowed: false,
        fallback_allowed: false,
      },
      console: {
        role_id: "console_default_worker",
        endpoint: "http://127.0.0.1:8082/v1",
        model: "Nemotron-Nano-30B-A3B-NVFP4",
        repository_write_allowed: true,
        fallback_allowed: false,
      },
      senior: {
        role_id: "console_senior_worker",
        status: "blocked_unproven",
        fallback_allowed: false,
      },
    },
    structured_build_request: {
      task_id: "prototype-loop-v1-test",
      original_user_request: proofRequest,
      clarification_behavior: {
        requires_clarification: false,
        safe_default_rationale: ["Use an isolated Console prototype workspace."],
      },
    },
    ...overrides,
  };
}

async function tempRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-loop-v1-"));
  tempRoots.push(root);
  return root;
}

describe("Prototype Loop v1 Console runner", () => {
  it("validates a structured Vera assignment", () => {
    expect(() => validateConsoleAssignment(assignment())).not.toThrow();
  });

  it("rejects assignments that would integrate without approval", () => {
    const bad = assignment({
      approval_policy: {
        approval_required: true,
        integration_allowed: true,
        implementation_policy: "Integrate immediately.",
      },
    });

    expect(() => validateConsoleAssignment(bad)).toThrow("PROTOTYPE_LOOP_APPROVAL_POLICY_VIOLATION");
  });

  it("rejects Qwen routes and non-blocked senior role", () => {
    expect(() => validateConsoleAssignment(assignment({
      model_role_requirements: {
        ...assignment().model_role_requirements,
        console: { model: "qwen", fallback_allowed: false },
      },
    }))).toThrow("PROTOTYPE_LOOP_QWEN_ROUTE_FORBIDDEN");

    expect(() => validateConsoleAssignment(assignment({
      model_role_requirements: {
        ...assignment().model_role_requirements,
        senior: { status: "available", fallback_allowed: false },
      },
    }))).toThrow("PROTOTYPE_LOOP_SENIOR_MUST_REMAIN_BLOCKED");
  });

  it("builds the isolated CLI prototype and produces ready evidence", async () => {
    const repoRoot = await tempRepo();
    const evidence = await runPrototypeLoopV1(assignment(), { repoRoot, now: new Date("2026-06-21T16:00:00.000Z") });

    expect(evidence.status).toBe("passed_with_skips");
    expect(evidence.readiness_status).toBe("passed_with_skips");
    expect(evidence.tests_passed).toBe(true);
    expect(evidence.approval_required).toBe(true);
    expect(evidence.integration_allowed).toBe(false);
    expect(evidence.integration_performed).toBe(false);
    expect(evidence.secret_scan_result.status).toBe("passed");
    expect(evidence.diff_scope_check.status).toBe("passed");
    expect(evidence.readiness_verdict).toBe("passed_with_skips");
    expect(evidence.acceptance_threshold.ready).toBe(true);
    expect(evidence.acceptance_threshold.approval_allowed).toBe(true);
    expect(evidence.threshold_engine_output.readiness_status).toBe("passed_with_skips");
    expect(evidence.threshold_engine_input.approval_policy).toMatchObject({
      approval_required: true,
      integration_allowed: false,
      integration_performed: false,
    });
    expect(evidence.threshold_engine_gates.map((gate) => gate.id)).toContain("task_tests");
    expect(evidence.acceptance_threshold.required_gates).toContain("task_tests");
    expect(evidence.acceptance_threshold.required_gates).toContain("role_policy");
    expect(evidence.acceptance_threshold.skipped_gates).toContain("optional_lint_typecheck_build");
    expect(evidence.blocking_failures).toEqual([]);
    expect(evidence.files_created_or_changed).toEqual([
      ".prototype-loop/prototype-loop-v1-test/word-count-cli.mjs",
      ".prototype-loop/prototype-loop-v1-test/word-count-cli.test.mjs",
      ".prototype-loop/prototype-loop-v1-test/sample.txt",
    ]);

    const saved = JSON.parse(await fs.readFile(evidence.evidence_path, "utf8")) as typeof evidence;
    expect(saved.final_readiness_status).toBe("passed_with_skips");
    expect(saved.acceptance_threshold.status).toBe("passed_with_skips");
    expect(saved.threshold_engine_output.approval_allowed).toBe(true);
  });

  it("repairs and retries failed test gates within the configured limit", async () => {
    const repoRoot = await tempRepo();
    let calls = 0;
    const evidence = await runPrototypeLoopV1(assignment(), {
      repoRoot,
      commandRunner: async (_cwd, command) => {
        calls += 1;
        return {
          command,
          status: calls === 1 ? "failed" : "passed",
          exitCode: calls === 1 ? 1 : 0,
          stdout: "",
          stderr: calls === 1 ? "simulated failing gate" : "",
          durationMs: 1,
        };
      },
    });

    expect(evidence.tests_passed).toBe(true);
    expect(evidence.repair_attempts).toBe(1);
    expect(evidence.test_results).toHaveLength(2);
    expect(evidence.status).toBe("passed_with_skips");
    expect(evidence.acceptance_threshold.approval_allowed).toBe(true);
  });
});
