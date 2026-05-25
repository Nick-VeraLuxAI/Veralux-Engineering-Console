import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { listPackageScriptsForRepo } from "../repo-intelligence/package-scripts/detect-package-scripts";

const execAsync = promisify(exec);

export interface QualityGateCommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  status: "passed" | "failed" | "skipped";
}

export interface QualityGateRunnerOptions {
  repoPath: string;
  registeredRepoId?: string | null;
  extraCommands?: string[];
}

function readPackageScripts(repoPath: string): Record<string, string> {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return {};
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

const STANDARD_GATE_SCRIPT_NAMES = ["test", "build", "lint", "typecheck"] as const;

function commandsFromScriptMap(scripts: Record<string, string>): string[] {
  const commands: string[] = [];
  if (scripts.test) commands.push("npm test");
  if (scripts.build) commands.push("npm run build");
  if (scripts.lint) commands.push("npm run lint");
  if (scripts.typecheck) commands.push("npm run typecheck");
  return commands;
}

export function resolveQualityGateCommands(
  repoPath: string,
  registeredRepoId?: string | null,
): string[] {
  if (registeredRepoId) {
    const stored = listPackageScriptsForRepo(registeredRepoId);
    if (stored.length > 0) {
      const commands: string[] = [];
      for (const name of STANDARD_GATE_SCRIPT_NAMES) {
        const row = stored.find((s) => s.scriptName === name);
        if (!row) continue;
        commands.push(name === "test" ? "npm test" : `npm run ${name}`);
      }
      if (commands.length > 0) return commands;
    }
  }

  return commandsFromScriptMap(readPackageScripts(repoPath));
}

async function runShellCommand(
  repoPath: string,
  command: string,
  timeoutMs = 10 * 60 * 1000,
): Promise<QualityGateCommandResult> {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: repoPath,
      maxBuffer: 8 * 1024 * 1024,
      timeout: timeoutMs,
      env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
    });
    return {
      command,
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      exitCode: 0,
      durationMs: Date.now() - started,
      status: "passed",
    };
  } catch (error: unknown) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };
    return {
      command,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(error),
      exitCode: typeof err.code === "number" ? err.code : 1,
      durationMs: Date.now() - started,
      status: "failed",
    };
  }
}

export async function runQualityGates(
  options: QualityGateRunnerOptions,
): Promise<QualityGateCommandResult[]> {
  const repoPath = path.resolve(options.repoPath);
  const commands = [
    ...resolveQualityGateCommands(repoPath, options.registeredRepoId),
    ...(options.extraCommands ?? []),
  ];

  if (commands.length === 0) {
    return [
      {
        command: "(none)",
        stdout: "",
        stderr: "No quality gate scripts found in package.json",
        exitCode: 0,
        durationMs: 0,
        status: "skipped",
      },
    ];
  }

  const results: QualityGateCommandResult[] = [];
  for (const command of commands) {
    results.push(await runShellCommand(repoPath, command));
  }
  return results;
}
