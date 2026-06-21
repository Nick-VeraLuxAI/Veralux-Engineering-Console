import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { runPrototypeLoopLifecycleV1, type PrototypeLoopHandoff } from "./prototype-loop-lifecycle";
import type { PrototypeLoopConsoleAssignment } from "./prototype-loop-v1";

const proofRequest = "Vera, build a tiny CLI tool that reads a text file and returns word count, character count, and the top 5 repeated words. Keep it as a prototype only and ask me before implementing it anywhere.";
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function tempRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-loop-lifecycle-"));
  tempRoots.push(root);
  return root;
}

function assignment(): PrototypeLoopConsoleAssignment {
  return {
    assignment_type: "prototype_loop_v1_console_build",
    task_id: "prototype-loop-v1-lifecycle-test",
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
      task_id: "prototype-loop-v1-lifecycle-test",
      original_user_request: proofRequest,
      clarification_behavior: {
        requires_clarification: false,
        safe_default_rationale: ["Use an isolated Console prototype workspace."],
      },
    },
  };
}

function handoff(): PrototypeLoopHandoff {
  return {
    vera_request: proofRequest,
    classification: {
      task_type: "build_prototype",
      requires_clarification: false,
      clarification_questions: [],
      safe_default_rationale: ["Use an isolated Console prototype workspace."],
    },
    structured_build_request: assignment().structured_build_request,
    console_assignment: assignment(),
  };
}

describe("Prototype Loop Phase 1B lifecycle", () => {
  it("runs natural-language handoff through Console evidence and Vera approval review", async () => {
    const repoRoot = await tempRepo();
    const proofRunRoot = path.join(repoRoot, ".prototype-loop", "phase-1b-proof-runs");
    const result = await runPrototypeLoopLifecycleV1({
      request: proofRequest,
      repoRoot,
      proofRunRoot,
      createHandoff: async () => handoff(),
      reviewEvidence: async (evidencePath) => {
        const evidence = JSON.parse(await fs.readFile(evidencePath, "utf8")) as {
          status: string;
          workspace_path: string;
        };
        return {
          evidence_status: evidence.status,
          ready_for_approval: true,
          revision_request: null,
          user_facing_summary: {
            approval_question: "Do you want me to implement this prototype into the target repo, keep it as a prototype only, or discard it?",
            ready_for_approval: true,
            what_was_created: "A tiny word-count CLI prototype.",
            where_created: evidence.workspace_path,
          },
        };
      },
    });

    expect(result.lifecycle_status).toBe("PASS");
    expect(result.blocker_code).toBeNull();
    expect(result.evidence_path).toContain("prototype-loop-v1-lifecycle-test.json");
    expect(result.approval_required).toBe(true);
    expect(result.integration_performed).toBe(false);
    expect(result.approval_question).toContain("implement this prototype");

    await expect(fs.stat(result.handoff_path)).resolves.toBeTruthy();
    await expect(fs.stat(result.console_result_path)).resolves.toBeTruthy();
    await expect(fs.stat(result.vera_review_path)).resolves.toBeTruthy();
    await expect(fs.stat(result.lifecycle_result_path)).resolves.toBeTruthy();
  });

  it("fails closed when Vera cannot produce a structured Console assignment", async () => {
    const repoRoot = await tempRepo();
    const result = await runPrototypeLoopLifecycleV1({
      request: "Tell me a story.",
      repoRoot,
      createHandoff: async () => ({
        vera_request: "Tell me a story.",
        classification: { task_type: "conversation", requires_clarification: true },
      }),
      reviewEvidence: async () => {
        throw new Error("review should not run");
      },
    });

    expect(result.lifecycle_status).toBe("BLOCKED");
    expect(result.blocker_code).toBe("PROTOTYPE_LOOP_HANDOFF_UNAVAILABLE");
    expect(result.evidence_path).toBeNull();
    expect(result.integration_performed).toBe(false);
  });
});
