import fs from "fs/promises";
import path from "path";
import { runPrototypeLoopV1, type PrototypeLoopConsoleAssignment } from "../../src/lib/engineer-console/prototype-loop/prototype-loop-v1";

interface HandoffFile {
  console_assignment?: PrototypeLoopConsoleAssignment;
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const assignmentFile = argValue("--assignment-file");
  const outputFile = argValue("--output-file");
  if (!assignmentFile) {
    throw new Error("Usage: tsx scripts/prototype-loop/run-prototype-loop-v1-proof.ts --assignment-file <handoff.json> [--output-file <result.json>]");
  }

  const handoff = JSON.parse(await fs.readFile(assignmentFile, "utf8")) as HandoffFile;
  if (!handoff.console_assignment) {
    throw new Error("PROTOTYPE_LOOP_MISSING_CONSOLE_ASSIGNMENT");
  }

  const evidence = await runPrototypeLoopV1(handoff.console_assignment, {
    repoRoot: process.cwd(),
  });
  const result = {
    status: evidence.status,
    task_id: evidence.task_id,
    evidence_path: evidence.evidence_path,
    workspace_path: evidence.workspace_path,
    approval_required: evidence.approval_required,
    integration_performed: evidence.integration_performed,
  };

  const rendered = `${JSON.stringify(result, null, 2)}\n`;
  if (outputFile) {
    await fs.mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
    await fs.writeFile(outputFile, rendered, "utf8");
  }
  process.stdout.write(rendered);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
