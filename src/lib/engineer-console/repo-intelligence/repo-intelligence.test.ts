import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForChainScope } from "../governance/audit-ledger/audit-ledger-manager";
import { createTask } from "../task-manager/task-manager";
import { detectAndStorePackageScripts, readPackageJsonScripts } from "./package-scripts/detect-package-scripts";
import { validateRegistrationPath } from "./registered-repos/repo-path-policy";
import { registerRepo } from "./registered-repos/register-repo";
import { detectTestProfile } from "./test-detection/detect-test-profile";
import { resolveTaskTargetRepoPath } from "./task-repo-path";
import { resolveQualityGateCommands } from "../quality-gates/quality-gate-runner";

let tmpDb: string;
let tmpRoot: string;
let allowRoot: string;
let gitRepo: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-repo-test-${Date.now()}.db`);
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-repo-root-"));
  allowRoot = path.join(tmpRoot, "allowed");
  gitRepo = path.join(allowRoot, "sample-repo");
  fs.mkdirSync(allowRoot, { recursive: true });
  fs.mkdirSync(gitRepo, { recursive: true });
  fs.writeFileSync(
    path.join(gitRepo, "package.json"),
    JSON.stringify({
      name: "sample",
      scripts: { test: "vitest run", build: "tsc", lint: "eslint ." },
      devDependencies: { vitest: "1.0.0" },
    }),
  );
  execSync("git init", { cwd: gitRepo, stdio: "ignore" });
  execSync('git config user.email "test@example.com"', { cwd: gitRepo, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: gitRepo, stdio: "ignore" });
  execSync("git add .", { cwd: gitRepo, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: gitRepo, stdio: "ignore" });

  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "repo-test";
  process.env.ENGINEER_CONSOLE_REPO_ROOTS = allowRoot;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE;
  delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
});

describe("repo path policy", () => {
  it("accepts path inside allowed root", () => {
    expect(validateRegistrationPath(gitRepo)).toBe(path.resolve(gitRepo));
  });

  it("rejects path outside allowed root", () => {
    const outside = path.join(tmpRoot, "outside");
    fs.mkdirSync(outside, { recursive: true });
    expect(() => validateRegistrationPath(outside)).toThrow(/allowlist/i);
  });

  it("rejects missing path", () => {
    expect(() => validateRegistrationPath(path.join(allowRoot, "nope"))).toThrow(/does not exist/i);
  });

  it("rejects file path", () => {
    const filePath = path.join(allowRoot, "file.txt");
    fs.writeFileSync(filePath, "x");
    expect(() => validateRegistrationPath(filePath)).toThrow(/not a directory/i);
  });

  it("rejects protected directory basename", () => {
    const bad = path.join(allowRoot, "node_modules");
    fs.mkdirSync(bad, { recursive: true });
    expect(() => validateRegistrationPath(bad)).toThrow(/protected/i);
  });
});

describe("package script detection", () => {
  it("reads package.json without executing", () => {
    const scripts = readPackageJsonScripts(gitRepo);
    expect(scripts.test).toBe("vitest run");
    expect(scripts.build).toBe("tsc");
  });

  it("detects vitest test profile", () => {
    const profile = detectTestProfile(gitRepo);
    expect(profile.runner).toBe("vitest");
    expect(profile.confidence).toBe("high");
  });
});

describe("register repo and task integration", () => {
  it("registers repo, detects metadata, and emits audit events", async () => {
    const repo = await registerRepo({ path: gitRepo, name: "sample" });
    expect(repo.verificationStatus).toBe("ok");
    expect(repo.packageScripts.length).toBeGreaterThan(0);
    expect(repo.testProfile?.runner).toBe("vitest");

    const events = listAuditEventsForChainScope("repo-test").map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.REPO_REGISTERED);
    expect(events).toContain(AUDIT_EVENT_TYPES.PACKAGE_SCRIPTS_DETECTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.TEST_PROFILE_DETECTED);
  });

  it("resolves task path from registeredRepoId", async () => {
    const repo = await registerRepo({ path: gitRepo });
    const task = createTask({
      title: "Registered task",
      registeredRepoId: repo.id,
    });
    expect(resolveTaskTargetRepoPath(task)).toBe(path.resolve(gitRepo));
    expect(task.registeredRepoId).toBe(repo.id);
  });

  it("legacy targetRepoPath still works", () => {
    const task = createTask({
      title: "Legacy",
      targetRepoPath: gitRepo,
    });
    expect(resolveTaskTargetRepoPath(task)).toBe(gitRepo);
    expect(task.registeredRepoId).toBeNull();
  });

  it("prefers registered repo scripts for quality gates", async () => {
    const repo = await registerRepo({ path: gitRepo });
    detectAndStorePackageScripts(repo.id, gitRepo);
    const commands = resolveQualityGateCommands(gitRepo, repo.id);
    expect(commands).toContain("npm test");
    expect(commands).toContain("npm run build");
  });
});
