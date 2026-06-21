#!/usr/bin/env tsx
import { runModelRoleBenchmark } from "./model-role-benchmark-harness";
import type { ModelRoleId } from "./model-role-routing";

const VALID_ROLES = new Set<ModelRoleId>([
  "vera_command",
  "console_default_worker",
  "console_senior_worker",
]);

function valueAfter(flag: string, args: string[]): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const role = valueAfter("--role", args) as ModelRoleId | null;
  if (!role || !VALID_ROLES.has(role)) {
    throw new Error(`--role is required and must be one of: ${[...VALID_ROLES].join(", ")}`);
  }
  const result = await runModelRoleBenchmark({
    role,
    dryRun: args.includes("--dry-run"),
    shadow: args.includes("--shadow"),
    readOnly: args.includes("--read-only"),
    noWrites: args.includes("--no-writes"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status.startsWith("blocked_")) {
    process.exitCode = 2;
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
