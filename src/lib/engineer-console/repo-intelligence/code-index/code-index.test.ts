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
import { registerRepo, reverifyRegisteredRepo } from "../registered-repos/register-repo";
import { runFileIndexForRepo } from "../file-index/file-index-manager";
import { shouldSkipFilePath } from "../file-index/file-index-policy";
import { chunkCodeFileContent, hashChunkContent } from "./chunk-code-file";
import { extractSymbolsFromContent } from "./symbol-extractor";
import { indexCodeFile } from "./index-code-file";
import {
  buildCodeIndexContextSummary,
  runCodeIndexForRepo,
  searchCodeChunks,
  searchSymbols,
  toPublicCodeChunk,
  toPublicSymbol,
} from "./code-index-manager";
import { collectRepoContext } from "../../model-router/repo-context-collector";
import { setTestRepoRootsAllowlist } from "../../test-support/engineer-console-test-env";
import { RepoPathPolicyError } from "../registered-repos/registered-repo-types";

let tmpDb: string;
let tmpRepo: string;
let repoId: string;

beforeEach(async () => {
  tmpDb = path.join(os.tmpdir(), `engineer-code-index-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "code-index-test";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();

  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ec-code-repo-"));
  fs.mkdirSync(path.join(tmpRepo, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRepo, "src", "service.ts"),
    `export function greet(name: string) {\n  return name;\n}\nexport class Service {\n  run() {}\n}\nexport interface Config { id: string }\nexport type Mode = "a" | "b";\n`,
  );
  fs.writeFileSync(
    path.join(tmpRepo, "app.py"),
    `class Worker:\n    pass\n\ndef handle():\n    return 1\n`,
  );
  fs.writeFileSync(path.join(tmpRepo, "README.md"), "# Title\n\n## Section\n");
  fs.writeFileSync(path.join(tmpRepo, ".env"), "SECRET=1\n");

  execSync("git init", { cwd: tmpRepo, stdio: "ignore" });
  execSync('git config user.email "t@e.com"', { cwd: tmpRepo, stdio: "ignore" });
  execSync('git config user.name "T"', { cwd: tmpRepo, stdio: "ignore" });
  setTestRepoRootsAllowlist(path.resolve(tmpRepo));

  const summary = await registerRepo({ path: tmpRepo, name: "code-index-repo" });
  repoId = summary.id;
  await reverifyRegisteredRepo(repoId);
  runFileIndexForRepo(repoId);
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  if (fs.existsSync(tmpRepo)) fs.rmSync(tmpRepo, { recursive: true, force: true });
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE;
});

describe("symbol extraction", () => {
  it("extracts TS function/class/interface/type and export flag", () => {
    const ts = `export function foo() {}\nclass Bar {}\ninterface Baz {}\ntype Q = string;\n`;
    const symbols = extractSymbolsFromContent(ts, "typescript");
    expect(symbols.some((s) => s.name === "foo" && s.exported)).toBe(true);
    expect(symbols.some((s) => s.name === "Bar" && s.kind === "class")).toBe(true);
    expect(symbols.some((s) => s.name === "Baz" && s.kind === "interface")).toBe(true);
    expect(symbols.some((s) => s.name === "Q" && s.kind === "type")).toBe(true);
  });

  it("extracts Python def/class", () => {
    const py = `class Worker:\n    pass\n\ndef handle():\n    pass\n`;
    const symbols = extractSymbolsFromContent(py, "python");
    expect(symbols.some((s) => s.name === "Worker")).toBe(true);
    expect(symbols.some((s) => s.name === "handle")).toBe(true);
  });

  it("extracts Markdown headings", () => {
    const md = "# Title\n\n## Section\n";
    const symbols = extractSymbolsFromContent(md, "markdown");
    expect(symbols.some((s) => s.kind === "heading_1")).toBe(true);
    expect(symbols.some((s) => s.kind === "heading_2")).toBe(true);
  });
});

describe("chunking", () => {
  it("produces stable content hash and bounded preview", () => {
    const content = Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n");
    const chunks = chunkCodeFileContent(content, { maxPreviewChars: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].contentPreview.length).toBeLessThanOrEqual(120);
    expect(hashChunkContent(chunks[0].content)).toBe(chunks[0].contentHash);
    const again = chunkCodeFileContent(content, { maxPreviewChars: 100 });
    expect(again[0].contentHash).toBe(chunks[0].contentHash);
  });

  it("skips protected paths in index-code-file", () => {
    const file = {
      id: "f1",
      repoId,
      relativePath: ".env",
      fileName: ".env",
      extension: null,
      language: "plaintext",
      sizeBytes: 10,
      contentHash: "abc",
      isBinary: false,
      isGenerated: false,
      indexedAt: new Date().toISOString(),
    };
    const result = indexCodeFile(tmpRepo, file);
    expect(result.skipped).toBe(true);
    expect(shouldSkipFilePath(".env").skip).toBe(true);
  });
});

describe("repo path policy", () => {
  it("rejects registration outside ENGINEER_CONSOLE_REPO_ROOTS when configured", async () => {
    const outsideRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ec-code-outside-"));
    try {
      setTestRepoRootsAllowlist(path.resolve(tmpRepo));
      await expect(registerRepo({ path: outsideRepo, name: "outside" })).rejects.toThrow(
        RepoPathPolicyError,
      );
    } finally {
      fs.rmSync(outsideRepo, { recursive: true, force: true });
      setTestRepoRootsAllowlist(path.resolve(tmpRepo));
    }
  });
});

describe("code index pipeline", () => {
  it("stores symbols and chunks without absolute paths", () => {
    const run = runCodeIndexForRepo(repoId);
    expect(run.status).toBe("completed");
    expect(run.symbolCount).toBeGreaterThan(0);
    expect(run.chunkCount).toBeGreaterThan(0);

    const symbols = searchSymbols({ repoId, q: "greet" });
    expect(symbols.some((s) => s.relativePath === "src/service.ts")).toBe(true);
    const pub = symbols.map(toPublicSymbol);
    expect(JSON.stringify(pub)).not.toContain(tmpRepo);

    const chunks = searchCodeChunks({ repoId, q: "service" });
    expect(chunks.length).toBeGreaterThan(0);
    const chunkPub = chunks.map(toPublicCodeChunk);
    expect(chunkPub[0].contentPreview.length).toBeLessThanOrEqual(1500);
    expect(JSON.stringify(chunkPub)).not.toContain(tmpRepo);
  });

  it("replaces previous code index on re-run", () => {
    const first = runCodeIndexForRepo(repoId);
    const second = runCodeIndexForRepo(repoId);
    expect(second.symbolCount).toBe(first.symbolCount);
  });

  it("rejects code index without file index", async () => {
    const emptyRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ec-empty-"));
    setTestRepoRootsAllowlist(path.resolve(tmpRepo), path.resolve(emptyRepo));
    fs.mkdirSync(path.join(emptyRepo, "src"));
    fs.writeFileSync(path.join(emptyRepo, "src", "a.ts"), "export const a = 1;\n");
    execSync("git init", { cwd: emptyRepo, stdio: "ignore" });
    const s = await registerRepo({ path: emptyRepo, name: "no-file-index" });
    await reverifyRegisteredRepo(s.id);
    expect(() => runCodeIndexForRepo(s.id)).toThrow(/file index/i);
    fs.rmSync(emptyRepo, { recursive: true, force: true });
    setTestRepoRootsAllowlist(path.resolve(tmpRepo));
  });
});

describe("audit events", () => {
  it("emits CODE_INDEX_STARTED and CODE_INDEX_COMPLETED", () => {
    runCodeIndexForRepo(repoId);
    const types = listAuditEventsForChainScope("code-index-test").map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.CODE_INDEX_STARTED);
    expect(types).toContain(AUDIT_EVENT_TYPES.CODE_INDEX_COMPLETED);
  });
});

describe("prompt context", () => {
  it("includes relevant symbols and bounded chunks", () => {
    runCodeIndexForRepo(repoId);
    const summary = buildCodeIndexContextSummary(repoId, ["greet", "Service"]);
    expect(summary).toContain("greet");
    expect(summary).toContain("src/service.ts");

    return collectRepoContext({
      repoPath: tmpRepo,
      registeredRepoId: repoId,
      taskSearchTerms: ["greet"],
    }).then((ctx) => {
      expect(ctx.contextSummary).toContain("Code index:");
      expect(ctx.contextSummary).toContain("Relevant symbols:");
      expect(ctx.contextSummary).not.toContain(tmpRepo);
      expect(ctx.contextSummary.length).toBeLessThan(8000);
    });
  });
});
