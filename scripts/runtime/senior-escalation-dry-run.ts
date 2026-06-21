import {
  runSeniorEscalationLifecycle,
  type SeniorEscalationContext,
} from "../../src/lib/engineer-console/senior-escalation/senior-escalation-lifecycle";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function normalContext(): SeniorEscalationContext {
  return {
    taskId: "phase-7-normal-prototype",
    originalRequest: "Vera, build a tiny isolated word count CLI prototype and ask before implementation.",
    structuredSpec: {
      task_type: "build_prototype",
      prototype_scope: "isolated_prototype_only",
      approval_required: true,
    },
    riskClassification: "low",
    acceptanceCriteria: ["Automated tests pass", "No integration before approval"],
    complexityScore: 2,
    changeTags: [],
    evidencePaths: [],
    filesChanged: [],
    commandsRun: [],
    blockingFailures: [],
  };
}

function highRiskContext(): SeniorEscalationContext {
  return {
    taskId: "phase-7-high-risk-runtime-refactor",
    originalRequest: "Vera, review a runtime-sensitive architecture refactor and package senior review before any implementation.",
    structuredSpec: {
      task_type: "review",
      prototype_scope: "dry_run_only",
      approval_required: true,
      senior_review_requested: true,
    },
    riskClassification: "architecture security",
    acceptanceCriteria: [
      "Senior escalation package is generated.",
      "Senior role remains dry-run blocked.",
      "No AirLLM/Super/Qwen/fallback is used.",
      "Nano runtime remains healthy before and after.",
    ],
    complexityScore: 9,
    changeTags: ["large_refactor", "runtime_sensitive_change", "integration_sensitive_change"],
    userRequestedSeniorReview: true,
    evidencePaths: [],
    filesChanged: [],
    commandsRun: [],
    blockingFailures: [],
  };
}

async function main(): Promise<void> {
  if (hasFlag("--recover")) {
    throw new Error("PHASE_7_RECOVERY_NOT_ALLOWED_IN_SENIOR_DRY_RUN");
  }
  const evidenceRoot = argValue("--evidence-root") ?? "evidence/senior-escalation";
  const normal = await runSeniorEscalationLifecycle(normalContext(), { evidenceRoot });
  const highRisk = await runSeniorEscalationLifecycle(highRiskContext(), { evidenceRoot });
  const status = normal.status === "not_required" && highRisk.status === "dry_run_blocked" ? "PASS" : "BLOCKED";
  const result = {
    status,
    check_only: true,
    normal_task: {
      status: normal.status,
      senior_review_required: normal.senior_review_required,
      evidence_path: normal.evidence_path,
      preflight_runtime_status: normal.preflight_runtime_status,
      postflight_runtime_status: normal.postflight_runtime_status,
    },
    high_risk_task: {
      status: highRisk.status,
      senior_review_required: highRisk.senior_review_required,
      escalation_reasons: highRisk.escalation_reasons,
      senior_role_id: highRisk.senior_result.senior_role_id,
      senior_role_status: highRisk.senior_result.senior_role_status,
      senior_provider: highRisk.senior_result.senior_provider,
      senior_expected_model: highRisk.senior_result.senior_expected_model,
      package_path: highRisk.senior_result.package_path,
      evidence_path: highRisk.evidence_path,
      blocked_reason: highRisk.senior_result.blocked_reason,
      preflight_runtime_status: highRisk.preflight_runtime_status,
      postflight_runtime_status: highRisk.postflight_runtime_status,
    },
    fallback_used: normal.fallback_used || highRisk.fallback_used,
    airllm_super_used: normal.airllm_super_used || highRisk.airllm_super_used,
    qwen_used: normal.qwen_used || highRisk.qwen_used,
    integration_performed: normal.integration_performed || highRisk.integration_performed,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (status !== "PASS") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
