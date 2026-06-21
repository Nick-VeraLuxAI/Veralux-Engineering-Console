import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runPrototypeRevisionLoop,
  type PrototypeRevisionVeraReview,
} from "./prototype-revision-loop";
import type { PrototypeLoopCommandResult, PrototypeLoopConsoleAssignment } from "./prototype-loop-v1";

const proofRequest = "Vera, build a tiny CLI tool that reads a text file and returns word count, character count, and the top 5 repeated words. Keep it as a prototype only and ask me before implementing it anywhere.";
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function tempRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-revision-loop-"));
  tempRoots.push(root);
  return root;
}

function assignment(overrides: Partial<PrototypeLoopConsoleAssignment> = {}): PrototypeLoopConsoleAssignment {
  return {
    assignment_type: "prototype_loop_v1_console_build",
    task_id: "prototype-loop-v1-revision-test",
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
        repository_write_allowed: false,
        fallback_allowed: false,
      },
      console: {
        role_id: "console_default_worker",
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
      task_id: "prototype-loop-v1-revision-test",
      original_user_request: proofRequest,
      clarification_behavior: {
        requires_clarification: false,
        safe_default_rationale: ["Use an isolated Console prototype workspace."],
      },
    },
    ...overrides,
  };
}

async function reviewEvidence(evidencePath: string): Promise<PrototypeRevisionVeraReview> {
  const evidence = JSON.parse(await fs.readFile(evidencePath, "utf8")) as {
    final_readiness_status: string;
    workspace_path: string;
    acceptance_threshold: {
      ready: boolean;
      status: string;
      failed_gates: string[];
      blocked_gates: string[];
      unresolved_issues: string[];
    };
  };
  if (evidence.acceptance_threshold.ready) {
    return {
      evidence_status: "ready_for_user_approval",
      ready_for_approval: true,
      revision_request: null,
      user_facing_summary: {
        what_was_created: "A tiny word-count CLI prototype.",
        where_created: evidence.workspace_path,
        ready_for_approval: true,
        approval_question: "Do you want me to implement this prototype into the target repo, keep it as a prototype only, or discard it?",
      },
    };
  }
  return {
    evidence_status: evidence.acceptance_threshold.status,
    ready_for_approval: false,
    revision_request: {
      reason_for_revision: "Acceptance threshold did not pass.",
      requested_change: `Fix gates: ${[
        ...evidence.acceptance_threshold.blocked_gates,
        ...evidence.acceptance_threshold.failed_gates,
      ].join(", ")}`,
      failed_gates: evidence.acceptance_threshold.failed_gates,
      blocked_gates: evidence.acceptance_threshold.blocked_gates,
      unresolved_issues: evidence.acceptance_threshold.unresolved_issues,
    },
    user_facing_summary: {
      ready_for_approval: false,
      where_created: evidence.workspace_path,
    },
  };
}

function alwaysFailingRunner(): (cwd: string, command: string) => Promise<PrototypeLoopCommandResult> {
  return async (_cwd, command) => ({
    command,
    status: "failed",
    exitCode: 1,
    stdout: "",
    stderr: "simulated threshold failure",
    durationMs: 1,
  });
}

describe("Prototype revision loop", () => {
  it("exits after a ready first round without extra revisions", async () => {
    const repoRoot = await tempRepo();
    const result = await runPrototypeRevisionLoop({
      assignment: assignment(),
      request: proofRequest,
      repoRoot,
      reviewEvidence,
    });

    expect(result.status).toBe("ready_for_user_approval");
    expect(result.ready_for_user_approval).toBe(true);
    expect(result.round_count).toBe(1);
    expect(result.rounds[0].revision_request).toBeNull();
    expect(result.final_approval_question).toContain("implement this prototype");
    expect(result.integration_performed).toBe(false);
  });

  it("requests a revision after a failed first round and passes on the second round", async () => {
    const repoRoot = await tempRepo();
    const result = await runPrototypeRevisionLoop({
      assignment: assignment(),
      request: proofRequest,
      repoRoot,
      reviewEvidence,
      commandRunnerForRound: (round) => round === 1 ? alwaysFailingRunner() : undefined,
    });

    expect(result.status).toBe("ready_for_user_approval");
    expect(result.round_count).toBe(2);
    expect(result.rounds[0].status).toBe("revision_requested");
    expect(result.rounds[0].revision_request?.failed_gates).toContain("task_tests");
    expect(result.rounds[1].status).toBe("ready_for_user_approval");
    expect(result.final_readiness_verdict).toBe("ready_for_user_approval");

    const finalEvidence = JSON.parse(await fs.readFile(result.final_evidence_path ?? "", "utf8")) as {
      revision_loop?: { round_count: number; round_history: Array<{ status: string }> };
    };
    expect(finalEvidence.revision_loop?.round_count).toBe(2);
    expect(finalEvidence.revision_loop?.round_history.map((round) => round.status)).toEqual([
      "revision_requested",
      "ready_for_user_approval",
    ]);
  });

  it("stops safely when max revision rounds are reached", async () => {
    const repoRoot = await tempRepo();
    const result = await runPrototypeRevisionLoop({
      assignment: assignment({
        loop_limits: {
          max_implementation_loops: 5,
          max_repair_attempts_per_failing_gate: 1,
          max_revision_rounds: 2,
        },
      }),
      request: proofRequest,
      repoRoot,
      reviewEvidence,
      commandRunnerForRound: () => alwaysFailingRunner(),
    });

    expect(result.status).toBe("max_rounds_reached");
    expect(result.ready_for_user_approval).toBe(false);
    expect(result.round_count).toBe(2);
    expect(result.final_approval_question).toBeNull();
  });

  it("blocks when threshold detects unsafe integration policy", async () => {
    const repoRoot = await tempRepo();

    await expect(runPrototypeRevisionLoop({
      assignment: assignment({
        approval_policy: {
          approval_required: true,
          integration_allowed: true,
          implementation_policy: "Unsafe integration.",
        },
      }),
      request: proofRequest,
      repoRoot,
      reviewEvidence,
    })).rejects.toThrow("PROTOTYPE_LOOP_APPROVAL_POLICY_VIOLATION");
  });
});
