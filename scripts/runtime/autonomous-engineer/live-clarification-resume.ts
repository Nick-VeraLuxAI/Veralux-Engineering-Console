/**
 * Resume the latest live clarification pause on the same run with answer "bar".
 */
import fs from "fs";
import path from "path";
import { initializeEngineerConsoleDatabase } from "../../../src/lib/engineer-console/db/init";
import { answerClarificationAndResume } from "../../../src/lib/engineer-console/autonomous-engineer/clarification";
import { getAutonomousState } from "../../../src/lib/engineer-console/autonomous-engineer/state-store";

async function main(): Promise<void> {
  process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED ??= "true";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL ??= "http://127.0.0.1:8081/v1";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ??= "Nemotron-Nano-30B-A3B-NVFP4";
  delete process.env.VITEST;
  if (process.env.NODE_ENV === "test") Reflect.deleteProperty(process.env, "NODE_ENV");

  initializeEngineerConsoleDatabase();
  const runId = process.argv[2] || process.env.AE_V1_CLARIFICATION_RUN_ID;
  if (!runId) throw new Error("Pass runId argv or AE_V1_CLARIFICATION_RUN_ID");
  const before = getAutonomousState(runId);
  if (!before || before.currentState !== "waiting_for_director") {
    throw new Error(`Run ${runId} is not waiting_for_director (got ${before?.currentState})`);
  }
  const result = await answerClarificationAndResume({
    runId,
    answer: "bar",
    actorLabel: "director-qualification",
  });
  const after = getAutonomousState(runId);
  const proof = {
    runId,
    sameRun: true,
    beforeState: before.currentState,
    afterState: after?.currentState,
    answer: after?.document.clarification?.answer,
    result,
    worker: after?.document.workerModel?.modelName,
    delivery: result.deliveryCandidateStatus,
  };
  const out = path.join(process.cwd(), "test-results", "ae-v1-live-clarification-resume.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
}

void main();
