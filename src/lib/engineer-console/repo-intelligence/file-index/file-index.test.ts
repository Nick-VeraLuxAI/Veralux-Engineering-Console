import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { AUDIT_EVENT_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { listAuditEventsForChainScope } from "../../governance/audit-ledger/audit-ledger-manager";
import { registerRepo } from "../registered-repos/register-repo";
import { reverifyRegisteredRepo } from "../registered-repos/register-repo";
import {
  bufferLooksBinary,
  getMaxIndexFileBytes,
  shouldSkipDirectoryName,
  shouldSkipFilePath,
} from "./file-index-policy";
import { detectLanguageFromPath } from "./detect-language";
import { scanRepoFiles } from "./scan-repo-files";
import {
  buildIndexedFileInventorySummary,
  listIndexedFiles,
  runFileIndexForRepo,
  toPublicIndexedFile,
} from "./file-index-manager";
import { collectRepoContext } from "../../model-router/repo-context-collector";
import { validateWorkerPlan } from "../../worker-plan/worker-plan-validation";
import type { WorkerPlan } from "../../worker-plan/worker-plan-types";

let tmpDb: string;
let tmpRepo: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-file-index-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "file-index-test";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();

  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ec-repo-"));
  fs.mkdirSync(path.join(tmpRepo, "src"), { recursive: true });
  fs.writeFileSync(path.join(tmpRepo, "src", "app.ts"), "export const x = 1;\n");
  fs.writeFileSync(path.join(tmpRepo, "README.md"), "# test\n");
  fs.writeFileSync(path.join(tmpRepo, ".env"), "SECRET=1\n");
  fs.mkdirSync(path.join(tmpRepo, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(path.join(tmpRepo, "node_modules", "pkg", "index.js"), "module.exports = {};\n");
  fs.mkdirSync(path.join(tmpRepo, "dist"), { recursive: true });
  fs.writeFileSync(path.join(tmpRepo, "dist", "bundle.js"), "console.log('x');\n");

  execSync("git init", { cwd: tmpRepo, stdio: "ignore" });
  execSync('git config user.email "test@example.com"', { cwd: tmpRepo, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: tmpRepo, stdio: "ignore" });
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  if (fs.existsSync(tmpRepo)) fs.rmSync(tmpRepo, { recursive: true, force: true });
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE;
});

describe("file index policy", () => {
  it("skips protected directories and files", () => {
    expect(shouldSkipDirectoryName(".git")).toBe(true);
    expect(shouldSkipDirectoryName("node_modules")).toBe(true);
    expect(shouldSkipDirectoryName("dist")).toBe(true);
    expect(shouldSkipDirectoryName("build")).toBe(true);
    expect(shouldSkipDirectoryName("coverage")).toBe(true);
    expect(shouldSkipFilePath(".env").skip).toBe(true);
    expect(shouldSkipFilePath("secrets/id_rsa").skip).toBe(true);
    expect(shouldSkipFilePath("src/app.ts").skip).toBe(false);
  });

  it("skips oversized files", () => {
    const bigPath = path.join(tmpRepo, "big.bin");
    const size = getMaxIndexFileBytes() + 1;
    fs.writeFileSync(bigPath, Buffer.alloc(size, 0));
    const scan = scanRepoFiles(tmpRepo);
    expect(scan.skipped.some((s) => s.reason === "oversized")).toBe(true);
  });

  it("detects binary buffers", () => {
    expect(bufferLooksBinary(Buffer.from([0, 1, 2]))).toBe(true);
    expect(bufferLooksBinary(Buffer.from("hello", "utf8"))).toBe(false);
  });
});

describe("scan and index", () => {
  it("stores only relative paths inside repo root", () => {
    const scan = scanRepoFiles(tmpRepo);
    for (const c of scan.candidates) {
      expect(c.relativePath).not.toMatch(/^\//);
      expect(c.relativePath).not.toContain("..");
      expect(c.absolutePath.startsWith(path.resolve(tmpRepo))).toBe(true);
    }
  });

  it("indexes safe files with stable hash and language", async () => {
    const summary = await registerRepo({ path: tmpRepo, name: "index-test" });
    await reverifyRegisteredRepo(summary.id);
    const run = runFileIndexForRepo(summary.id);
    expect(run.status).toBe("completed");
    expect(run.indexedCount).toBeGreaterThan(0);

    const files = listIndexedFiles({ repoId: summary.id });
    const app = files.find((f) => f.relativePath === "src/app.ts");
    expect(app).toBeDefined();
    expect(app!.language).toBe(detectLanguageFromPath("src/app.ts"));
    expect(app!.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const second = runFileIndexForRepo(summary.id);
    const app2 = listIndexedFiles({ repoId: summary.id }).find(
      (f) => f.relativePath === "src/app.ts",
    );
    expect(app2!.contentHash).toBe(app!.contentHash);
    expect(second.indexedCount).toBe(run.indexedCount);
  });

  it("rejects unverified repo for indexing", async () => {
    const summary = await registerRepo({ path: tmpRepo, name: "pending-repo" });
    const db = (await import("../../db/client")).getEngineerConsoleDb();
    db.prepare(
      `UPDATE engineer_registered_repos SET verification_status = 'pending' WHERE id = ?`,
    ).run(summary.id);
    expect(() => runFileIndexForRepo(summary.id)).toThrow(/verified/);
  });

  it("public file shape has no absolute paths or contents", async () => {
    const summary = await registerRepo({ path: tmpRepo, name: "public-shape" });
    await reverifyRegisteredRepo(summary.id);
    runFileIndexForRepo(summary.id);
    const pub = listIndexedFiles({ repoId: summary.id }).map(toPublicIndexedFile);
    const json = JSON.stringify(pub);
    expect(json).not.toContain(tmpRepo);
    expect(json).not.toContain("export const");
    expect(pub[0].contentHashPrefix.length).toBe(12);
  });
});

describe("audit events", () => {
  it("emits FILE_INDEX_STARTED and FILE_INDEX_COMPLETED", async () => {
    const summary = await registerRepo({ path: tmpRepo, name: "audit-repo" });
    await reverifyRegisteredRepo(summary.id);
    runFileIndexForRepo(summary.id);
    const types = listAuditEventsForChainScope("file-index-test").map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.FILE_INDEX_STARTED);
    expect(types).toContain(AUDIT_EVENT_TYPES.FILE_INDEX_COMPLETED);
  });
});

describe("prompt context integration", () => {
  it("includes indexed inventory without file contents", async () => {
    const summary = await registerRepo({ path: tmpRepo, name: "ctx-repo" });
    await reverifyRegisteredRepo(summary.id);
    runFileIndexForRepo(summary.id);

    const inventory = buildIndexedFileInventorySummary(summary.id);
    expect(inventory).toContain("Indexed file inventory");
    expect(inventory).toContain("src/app.ts");

    const ctx = await collectRepoContext({
      repoPath: tmpRepo,
      registeredRepoId: summary.id,
    });
    expect(ctx.contextSummary).toContain("File index:");
    expect(ctx.contextSummary).not.toContain(tmpRepo);
    expect(ctx.contextSummary).not.toContain("export const x");
  });
});

describe("governance index warnings", () => {
  it("warns when update targets file not in index", () => {
    const plan: WorkerPlan = {
      runId: "run-1",
      summary: "test",
      allowedFiles: ["src/missing.ts"],
      operations: [
        {
          type: "update_file",
          path: "src/missing.ts",
          content: "x",
          reason: "fix",
        },
      ],
    };
    const indexed = new Set(["src/app.ts"]);
    const result = validateWorkerPlan(plan, tmpRepo, "run-1", { indexedFilePaths: indexed });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === "FILE_NOT_IN_INDEX")).toBe(true);
  });

  it("does not warn for create_file on new paths", () => {
    const plan: WorkerPlan = {
      runId: "run-1",
      summary: "test",
      allowedFiles: ["src/new.ts"],
      operations: [
        {
          type: "create_file",
          path: "src/new.ts",
          content: "x",
          reason: "add",
        },
      ],
    };
    const result = validateWorkerPlan(plan, tmpRepo, "run-1", {
      indexedFilePaths: new Set(["src/app.ts"]),
    });
    expect(result.warnings.some((w) => w.code === "FILE_NOT_IN_INDEX")).toBe(false);
  });
});
