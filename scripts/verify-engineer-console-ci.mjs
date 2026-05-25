#!/usr/bin/env node
import { spawnSync } from "child_process";

/**
 * Ordered CI validation steps. Exported for Vitest contract checks.
 * @type {{ id: string, command: string, note?: string }[]}
 */
export const VERIFY_CI_STEPS = [
  { id: "unit", command: "npm test", note: "Vitest unit/integration (~1–2 min)" },
  { id: "build", command: "npm run build", note: "Next.js production build (~30s)" },
  {
    id: "e2e-local",
    command: "npm run test:e2e",
    note: "Trusted local + release panels Playwright (~1–3 min)",
  },
  {
    id: "e2e-gates",
    command: "npm run test:e2e:gates",
    note: "Hard release gates Playwright (~30s)",
  },
  { id: "e2e-auth", command: "npm run test:e2e:auth", note: "Auth Playwright (~30s)" },
  {
    id: "backup-verify",
    command: "npm run backup:db:verify",
    note: "SQLite backup + restore drill (~5s)",
  },
];

/** Expected wall-clock when run sequentially on a typical dev machine. */
export const VERIFY_CI_EXPECTED_RUNTIME = "roughly 8–15 minutes";

function runCommand(command) {
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  return result.status ?? 1;
}

function main() {
  if (process.env.VERIFY_CI_LIST_ONLY === "1") {
    console.log(JSON.stringify({ steps: VERIFY_CI_STEPS }));
    process.exit(0);
  }

  const startedAt = Date.now();
  console.log("Engineer Console CI validation");
  console.log(`Expected runtime: ${VERIFY_CI_EXPECTED_RUNTIME}`);
  console.log(`Steps: ${VERIFY_CI_STEPS.length}`);

  for (const step of VERIFY_CI_STEPS) {
    console.log("");
    console.log("=".repeat(60));
    console.log(`STEP: ${step.id}`);
    console.log(`CMD:  ${step.command}`);
    if (step.note) console.log(`NOTE: ${step.note}`);
    console.log("=".repeat(60));

    const code = runCommand(step.command);
    if (code !== 0) {
      console.log("");
      console.log("=".repeat(60));
      console.log(`CI VALIDATION: FAIL (step ${step.id}, exit ${code})`);
      console.log("=".repeat(60));
      process.exit(code);
    }
  }

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.log("");
  console.log("=".repeat(60));
  console.log(`CI VALIDATION: PASS (${elapsedSec}s)`);
  console.log("=".repeat(60));
  process.exit(0);
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("verify-engineer-console-ci.mjs") ||
    process.argv[1].includes("verify-engineer-console-ci"));

if (isMain) {
  main();
}
