import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import type { TestProfileRecord } from "../registered-repos/registered-repo-types";
import { readPackageJsonScripts } from "../package-scripts/detect-package-scripts";

export type TestRunnerKind =
  | "vitest"
  | "jest"
  | "playwright"
  | "cypress"
  | "pytest"
  | "go"
  | "cargo"
  | "npm-test"
  | "unknown";

export interface DetectedTestProfile {
  runner: TestRunnerKind;
  detectCommand: string | null;
  confidence: "high" | "medium" | "low";
  signals: Record<string, unknown>;
}

/** Detection only — does not execute commands. */
export function detectTestProfile(repoPath: string): DetectedTestProfile {
  const resolved = path.resolve(repoPath);
  const signals: Record<string, unknown> = {};

  const pkgPath = path.join(resolved, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
        devDependencies?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      signals.devDependencies = Object.keys(deps).filter((k) =>
        ["vitest", "jest", "playwright", "@playwright/test", "cypress"].includes(k),
      );
      signals.hasTestScript = Boolean(scripts.test);

      if (deps.vitest || scripts.test?.includes("vitest")) {
        return {
          runner: "vitest",
          detectCommand: "npx vitest run",
          confidence: "high",
          signals,
        };
      }
      if (deps.jest || scripts.test?.includes("jest")) {
        return {
          runner: "jest",
          detectCommand: "npx jest",
          confidence: "high",
          signals,
        };
      }
      if (deps["@playwright/test"] || deps.playwright || scripts.test?.includes("playwright")) {
        return {
          runner: "playwright",
          detectCommand: "npx playwright test",
          confidence: "medium",
          signals,
        };
      }
      if (deps.cypress || scripts.test?.includes("cypress")) {
        return {
          runner: "cypress",
          detectCommand: "npx cypress run",
          confidence: "medium",
          signals,
        };
      }
      if (scripts.test) {
        return {
          runner: "npm-test",
          detectCommand: "npm test",
          confidence: "medium",
          signals,
        };
      }
    } catch {
      signals.packageJsonParseError = true;
    }
  }

  if (
    fs.existsSync(path.join(resolved, "pytest.ini")) ||
    fs.existsSync(path.join(resolved, "pyproject.toml")) ||
    fs.existsSync(path.join(resolved, "setup.py")) ||
    fs.existsSync(path.join(resolved, "requirements.txt"))
  ) {
    signals.pythonMarkers = true;
    return {
      runner: "pytest",
      detectCommand: "python -m pytest",
      confidence: fs.existsSync(path.join(resolved, "pytest.ini")) ? "high" : "medium",
      signals,
    };
  }

  if (fs.existsSync(path.join(resolved, "Cargo.toml"))) {
    return {
      runner: "cargo",
      detectCommand: "cargo test",
      confidence: "high",
      signals: { cargoToml: true },
    };
  }

  if (fs.existsSync(path.join(resolved, "go.mod"))) {
    return {
      runner: "go",
      detectCommand: "go test ./...",
      confidence: "high",
      signals: { goMod: true },
    };
  }

  const scripts = readPackageJsonScripts(resolved);
  if (scripts.test) {
    return {
      runner: "npm-test",
      detectCommand: "npm test",
      confidence: "low",
      signals,
    };
  }

  return {
    runner: "unknown",
    detectCommand: null,
    confidence: "low",
    signals,
  };
}

export function detectAndStoreTestProfile(
  repoId: string,
  repoPath: string,
): TestProfileRecord {
  const detected = detectTestProfile(repoPath);
  const db = getEngineerConsoleDb();
  const detectedAt = new Date().toISOString();
  const id = uuidv4();

  db.prepare(`DELETE FROM engineer_test_profiles WHERE repo_id = ?`).run(repoId);
  db.prepare(
    `INSERT INTO engineer_test_profiles
      (id, repo_id, runner, detect_command, confidence, signals_json, detected_at)
     VALUES (@id, @repo_id, @runner, @detect_command, @confidence, @signals_json, @detected_at)`,
  ).run({
    id,
    repo_id: repoId,
    runner: detected.runner,
    detect_command: detected.detectCommand,
    confidence: detected.confidence,
    signals_json: JSON.stringify(detected.signals),
    detected_at: detectedAt,
  });

  return {
    id,
    repoId,
    runner: detected.runner,
    detectCommand: detected.detectCommand,
    confidence: detected.confidence,
    signalsJson: JSON.stringify(detected.signals),
    detectedAt,
  };
}

export function getTestProfileForRepo(repoId: string): TestProfileRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_test_profiles WHERE repo_id = ?`)
    .get(repoId) as
    | {
        id: string;
        repo_id: string;
        runner: string;
        detect_command: string | null;
        confidence: string;
        signals_json: string;
        detected_at: string;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    repoId: row.repo_id,
    runner: row.runner,
    detectCommand: row.detect_command,
    confidence: row.confidence as TestProfileRecord["confidence"],
    signalsJson: row.signals_json,
    detectedAt: row.detected_at,
  };
}
