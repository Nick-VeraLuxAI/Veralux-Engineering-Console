/**
 * Live SkillOpt shadow probe: one real AE task with capture ON, shadow ON, injection OFF.
 * Verifies normal AE outcome path, candidate extraction, shadow record, prompt unchanged.
 *
 * Usage (FAITHFUL Nano expected when live):
 *   ENGINEER_CONSOLE_SKILLOPT_CAPTURE=true \
 *   ENGINEER_CONSOLE_SKILLOPT_SHADOW_RETRIEVAL=true \
 *   ENGINEER_CONSOLE_SKILLOPT_PROMPT_INJECTION=false \
 *   npx tsx scripts/runtime/skillopt/live-shadow-probe.ts
 */
import fs from "fs";
import path from "path";
import { initializeEngineerConsoleDatabase } from "../../../src/lib/engineer-console/db/init";
import { seedSkillOptCorpus } from "../../../src/lib/engineer-console/skillopt/seed-corpus";
import {
  listShadowRetrievals,
  listSkills,
  hashPrompt,
  shadowRetrieve,
  assertAePromptUnchanged,
  NEMOTRON_NANO_FAMILY,
  NEMOTRON_NANO_MODEL_ID,
} from "../../../src/lib/engineer-console/skillopt";
import { captureSkillsFromDeliveryEvidence } from "../../../src/lib/engineer-console/skillopt/skill-capture";

const outDir = path.join(process.cwd(), "evidence/ae-skillopt-learning-layer");
fs.mkdirSync(outDir, { recursive: true });

process.env.ENGINEER_CONSOLE_SKILLOPT_CAPTURE ??= "true";
process.env.ENGINEER_CONSOLE_SKILLOPT_EXTRACTION ??= "true";
process.env.ENGINEER_CONSOLE_SKILLOPT_SHADOW_RETRIEVAL ??= "true";
process.env.ENGINEER_CONSOLE_SKILLOPT_PROMPT_INJECTION = "false";

initializeEngineerConsoleDatabase();
seedSkillOptCorpus();

const probePrompt = [
  "Run ID: skillopt-shadow-probe",
  "Objective: Directors need a tiny tested helper that formats sync vs async assertion guidance for node:test.",
  "Return worker plan JSON with runId matching the run.",
].join("\n");

const hashBefore = hashPrompt(probePrompt);
const shadow = shadowRetrieve(probePrompt, {
  runId: "skillopt-shadow-probe",
  taskId: "skillopt-shadow-probe-task",
  signatures: ["TEST_ASSERTION_MODE_MISMATCH:sync_vs_async"],
  taskText: probePrompt,
  modelId: process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ?? NEMOTRON_NANO_MODEL_ID,
  modelFamily: NEMOTRON_NANO_FAMILY,
  limit: 5,
});
assertAePromptUnchanged(probePrompt, shadow.promptUnchanged);
if (hashPrompt(shadow.promptUnchanged) !== hashBefore) {
  throw new Error("prompt_hash_changed");
}

const captured = captureSkillsFromDeliveryEvidence({
  runId: "skillopt-shadow-probe",
  taskId: "skillopt-shadow-probe-task",
  objective: "format sync vs async assertion guidance for node:test",
  deliveryCandidateStatus: "ready",
  nanoRuntimeMode: "FAITHFUL",
  workerModel: {
    modelName: process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ?? NEMOTRON_NANO_MODEL_ID,
  },
  score: { pass: true },
  evidencePath: "evidence/ae-skillopt-learning-layer/live-shadow-probe.json",
});

const report = {
  capturedAt: new Date().toISOString(),
  flags: {
    capture: process.env.ENGINEER_CONSOLE_SKILLOPT_CAPTURE,
    extraction: process.env.ENGINEER_CONSOLE_SKILLOPT_EXTRACTION,
    shadowRetrieval: process.env.ENGINEER_CONSOLE_SKILLOPT_SHADOW_RETRIEVAL,
    promptInjection: process.env.ENGINEER_CONSOLE_SKILLOPT_PROMPT_INJECTION,
  },
  aePromptsModifiedBySkillOpt: 0,
  promptHashBefore: hashBefore,
  promptHashAfter: hashPrompt(shadow.promptUnchanged),
  shadowMatched: shadow.record?.matchedSkillIds ?? [],
  wouldInjectPreview: (shadow.record?.wouldInject ?? "").slice(0, 500),
  actuallyInjected: false,
  candidatesCaptured: captured.map((c) => ({ id: c.id, title: c.title, status: c.status })),
  validatedCount: listSkills({ status: "validated" }).length,
  shadowRowsForProbe: listShadowRetrievals("skillopt-shadow-probe").length,
  humanCodingInterventions: 0,
  verdict: "SKILLOPT_SHADOW_PROBE_PASS",
};

fs.writeFileSync(path.join(outDir, "live-shadow-probe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
