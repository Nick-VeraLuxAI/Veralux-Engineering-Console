import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

async function load(modulePath) {
  return import(pathToFileURL(modulePath).href);
}

const {
  VERA_LOCAL_MODEL_CODING_TASK_ID,
  validateVeraLocalModelCodingProofHandoff,
} = await load(path.join(root, "src/lib/engineer-console/bridge/local-model-coding-proof-contract.ts"));
const {
  VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
  VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
} = await load(path.join(root, "src/lib/engineer-console/bridge/placeholder-module-card-contract.ts"));
const { runVeraLocalModelCodingProof } = await load(
  path.join(root, "src/lib/engineer-console/bridge/local-model-coding-proof.ts"),
);

const handoff = {
  schema_version: VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
  source: "veralux-system",
  requested_by: "operator",
  artifact_type: VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
  execution_mode: VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
  integration_mode: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  final_integration_authorized: false,
  repo_mutation_authorized: false,
  branch_creation_authorized: false,
  commit_creation_authorized: false,
  pr_creation_authorized: false,
  deploy_authorized: false,
  merge_authorized: false,
  arbitrary_execution_authorized: false,
  arbitrary_filesystem_path_authorized: false,
  system_source_of_truth: true,
  console_metadata_authoritative: false,
  coding_task_id: VERA_LOCAL_MODEL_CODING_TASK_ID,
  request: {
    module_card_name: "Local Model Coding Proof",
    purpose: "Prove local Nemotron can generate formatBuilderLoopDecisionLabel with tests in isolation.",
    scope: ["Generate formatBuilderLoopDecisionLabel utility with node:test coverage."],
    constraints: ["Isolated workspace only.", "No repo mutation."],
    risks: ["Model output may be invalid."],
    acceptance_criteria: [
      "approve -> Approved",
      "reject -> Rejected",
      "request_changes -> Changes requested",
      "unknown -> Unknown decision",
      "All tests pass in isolated workspace.",
    ],
    requested_artifact_type: VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
    integration_status: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  },
};

const validation = validateVeraLocalModelCodingProofHandoff(handoff);
if (!validation.ok) {
  console.error(JSON.stringify({ validation }, null, 2));
  process.exit(1);
}

const result = await runVeraLocalModelCodingProof(handoff, { cleanup: false });
const outPath = path.join(root, ".local-model-coding-proof-result.json");
fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: result.ok,
  status: result.status,
  model_used: result.model?.model_used ?? null,
  model_generation_real: result.model?.model_generation_real ?? null,
  endpoint: result.model?.endpoint ?? null,
  test_passed: result.tests?.passed ?? null,
  test_command: result.tests
    ? `${result.tests.command_executable} ${result.tests.command_args.join(" ")}`
    : null,
  repair_required: result.repair_loop?.repair_required ?? null,
  repair_attempts_count: result.repair_loop?.repair_attempts_count ?? null,
  total_attempts: result.repair_loop?.total_attempts ?? null,
  repair_prompt_summary: result.repair_loop?.repair_prompt_summary ?? null,
  files_changed: result.patch?.files_created_or_changed ?? [],
  evidence_id: result.evidence?.evidence_id ?? null,
  workspace_id: result.evidence?.workspace_id ?? null,
  errors: result.errors,
  warnings: result.warnings,
  result_file: outPath,
}, null, 2));

process.exit(result.ok ? 0 : 1);
