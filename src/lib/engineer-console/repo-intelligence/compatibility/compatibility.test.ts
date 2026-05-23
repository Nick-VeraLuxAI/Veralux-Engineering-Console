import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { AUDIT_EVENT_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { listAuditEventsForChainScope } from "../../governance/audit-ledger/audit-ledger-manager";
import { evaluateRunPolicy } from "../../governance/policy-results/evaluate-run-policy";
import { buildApprovalReport } from "../../approval/approval-report";
import { saveApprovalReport, createRun, updateRun } from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import { assessChangedFiles } from "../../governance/governance-engine";
import { collectRepoContext } from "../../model-router/repo-context-collector";
import { registerRepo } from "../registered-repos/register-repo";
import { detectRestRoutesInContent } from "./detect-api-surfaces";
import { detectHttpClientCallsInContent } from "./detect-http-client-calls";
import { detectPackageDependencies } from "./detect-package-dependencies";
import { buildRestClientToRouteLinks } from "./build-cross-repo-links";
import {
  listApiSurfaces,
  listCrossRepoLinks,
  runCompatibilityAnalysis,
  toPublicApiSurface,
  toPublicCrossRepoLink,
} from "./compatibility-manager";
import type { CompatibilityRepoContext, ScanContentSlice } from "./compatibility-types";

let tmpDb: string;
let tmpRoot: string;
let allowRoot: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-compat-${Date.now()}.db`);
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-compat-"));
  allowRoot = path.join(tmpRoot, "allowed");
  fs.mkdirSync(allowRoot, { recursive: true });

  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "compat-test";
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

function initGitRepo(dir: string, files: Record<string, string>) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
}

function slice(content: string, repoId = "repo-a"): ScanContentSlice {
  return {
    repoId,
    relativePath: "src/server.ts",
    language: "typescript",
    content,
    startLine: 1,
    endLine: content.split("\n").length,
  };
}

describe("compatibility detection", () => {
  it("detects dependency matching another registered repo package name", () => {
    const repos: CompatibilityRepoContext[] = [
      {
        repoId: "a",
        repoName: "consumer",
        packageName: "consumer-app",
        repoPath: "/tmp/consumer",
        verificationStatus: "ok",
      },
      {
        repoId: "b",
        repoName: "provider-lib",
        packageName: "provider-lib",
        repoPath: "/tmp/provider",
        verificationStatus: "ok",
      },
    ];

    fs.mkdirSync("/tmp/consumer", { recursive: true });
    fs.writeFileSync(
      "/tmp/consumer/package.json",
      JSON.stringify({ dependencies: { "provider-lib": "^1.0.0", lodash: "4.0.0" } }),
    );

    const result = detectPackageDependencies(repos);
    expect(result.links.some((l) => l.linkType === "package_dependency" && l.status === "compatible")).toBe(
      true,
    );
    expect(result.links.some((l) => (l.evidence.package as string) === "lodash")).toBe(false);
  });

  it("detects simple Express routes", () => {
    const surfaces = detectRestRoutesInContent(
      slice(`app.get('/api/users', handler);\nrouter.post("/api/items", create);`),
    );
    expect(surfaces.some((s) => s.method === "GET" && s.routePath === "/api/users")).toBe(true);
    expect(surfaces.some((s) => s.method === "POST" && s.routePath === "/api/items")).toBe(true);
  });

  it("detects Next.js route handler export", () => {
    const surfaces = detectRestRoutesInContent(
      slice(`export async function GET() { return Response.json({ ok: true }); }`, "repo-a"),
    );
    expect(surfaces.some((s) => s.method === "GET")).toBe(true);
  });

  it("detects fetch and axios client calls", () => {
    const fetchSurfaces = detectHttpClientCallsInContent(
      slice(`await fetch('/api/engineer-console/tasks');`),
    );
    const axiosSurfaces = detectHttpClientCallsInContent(
      slice(`axios.get('/api/users');\naxios.post("/api/items", body);`),
    );
    expect(fetchSurfaces.some((s) => s.routePath === "/api/engineer-console/tasks")).toBe(true);
    expect(axiosSurfaces.some((s) => s.method === "GET" && s.routePath === "/api/users")).toBe(true);
  });

  it("creates rest client to route links", () => {
    const routes = detectRestRoutesInContent(slice(`app.get('/api/ping', handler);`, "repo-b"));
    const clients = detectHttpClientCallsInContent(slice(`fetch('/api/ping');`, "repo-a"));
    const links = buildRestClientToRouteLinks(routes, clients, [
      { repoId: "repo-a", repoName: "client", packageName: "client", repoPath: "/a", verificationStatus: "ok" },
      { repoId: "repo-b", repoName: "server", packageName: "server", repoPath: "/b", verificationStatus: "ok" },
    ]);
    expect(links.some((l) => l.linkType === "rest_client_to_route" && l.status === "compatible")).toBe(true);
    expect(JSON.stringify(links)).not.toMatch(/\/tmp|\/Users/);
  });

  it("stores bounded evidence without absolute paths via manager", async () => {
    const consumerDir = path.join(allowRoot, "consumer");
    const providerDir = path.join(allowRoot, "provider");
    initGitRepo(consumerDir, {
      "package.json": JSON.stringify({
        name: "consumer-app",
        dependencies: { "provider-lib": "1.0.0" },
      }),
    });
    initGitRepo(providerDir, {
      "package.json": JSON.stringify({ name: "provider-lib", version: "1.0.0" }),
      "src/routes.ts": `app.get('/api/data', handler);`,
    });

    const consumer = await registerRepo({ path: consumerDir, name: "consumer" });
    const provider = await registerRepo({ path: providerDir, name: "provider" });
    expect(consumer.verificationStatus).toBe("ok");
    expect(provider.verificationStatus).toBe("ok");

    const run = runCompatibilityAnalysis({ audit: true });
    expect(run.status).toBe("completed");
    expect(run.linkCount).toBeGreaterThan(0);

    const links = listCrossRepoLinks().map(toPublicCrossRepoLink);
    const serialized = JSON.stringify(links);
    expect(serialized).not.toMatch(new RegExp(allowRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(links[0]!.evidence).toBeTruthy();
  });

  it("analyze lists surfaces metadata only", async () => {
    const consumerDir = path.join(allowRoot, "surface-consumer");
    const providerDir = path.join(allowRoot, "surface-provider");
    initGitRepo(providerDir, {
      "package.json": JSON.stringify({ name: "surface-provider-lib", version: "1.0.0" }),
    });
    initGitRepo(consumerDir, {
      "package.json": JSON.stringify({
        name: "surface-consumer-app",
        dependencies: { "surface-provider-lib": "1.0.0" },
      }),
    });
    await registerRepo({ path: providerDir, name: "surface-provider" });
    const consumer = await registerRepo({ path: consumerDir, name: "surface-consumer" });

    runCompatibilityAnalysis({ audit: false });
    const surfaces = listApiSurfaces({ repoId: consumer.id }).map(toPublicApiSurface);
    expect(surfaces.length).toBeGreaterThan(0);
    expect(surfaces.some((s) => s.surfaceType === "package_dependency")).toBe(true);
    expect(JSON.stringify(surfaces)).not.toMatch(/stdout|stderr|contentPreview|"path":/i);
  });

  it("emits compatibility audit events", async () => {
    const repoDir = path.join(allowRoot, "solo");
    initGitRepo(repoDir, { "package.json": JSON.stringify({ name: "solo" }) });
    const repo = await registerRepo({ path: repoDir });
    expect(repo.verificationStatus).toBe("ok");
    runCompatibilityAnalysis({ audit: true });
    const types = listAuditEventsForChainScope().map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.COMPATIBILITY_ANALYSIS_STARTED);
    expect(types).toContain(AUDIT_EVENT_TYPES.COMPATIBILITY_ANALYSIS_COMPLETED);
  });

  it("policy integration uses compatibility signals", async () => {
    const consumerDir = path.join(allowRoot, "policy-consumer");
    const providerDir = path.join(allowRoot, "policy-provider");
    initGitRepo(providerDir, {
      "package.json": JSON.stringify({ name: "shared-lib", version: "1.0.0" }),
      "src/index.ts": `export function sharedFn(): number { return 1; }\nexport function sharedFn(): string { return "x"; }`,
    });
    initGitRepo(consumerDir, {
      "package.json": JSON.stringify({ name: "policy-app", dependencies: { "shared-lib": "1.0.0" } }),
    });

    const provider = await registerRepo({ path: providerDir, name: "shared-lib" });
    const consumer = await registerRepo({ path: consumerDir, name: "policy-app" });
    expect(provider.verificationStatus).toBe("ok");
    expect(consumer.verificationStatus).toBe("ok");
    runCompatibilityAnalysis({ audit: false });

    const task = createTask({
      title: "Compat policy",
      targetRepoPath: consumerDir,
      registeredRepoId: consumer.id,
    });
    const run = createRun(task.id);
    updateRun(run.id, { status: "waiting_for_approval", branchName: "test" });
    const report = buildApprovalReport({
      task,
      run: { ...run, status: "waiting_for_approval", branchName: "test", riskLevel: "low", governanceNotes: null },
      changedFiles: ["src/a.ts"],
      diffSummary: "1 file",
      governance: assessChangedFiles(["src/a.ts"]),
      qualityGateResults: [],
    });
    saveApprovalReport(run.id, JSON.stringify(report));

    const result = evaluateRunPolicy(run.id);
    expect(result.signals.compatibilityWarningCount + result.signals.compatibilityBreakingCount).toBeGreaterThanOrEqual(
      0,
    );
    expect(result.rules.some((r) => r.ruleId === "COMPATIBILITY_WARNINGS" || r.ruleId === "COMPATIBILITY_BREAKING")).toBe(
      true,
    );
  });

  it("prompt context includes bounded compatibility summary", async () => {
    const repoDir = path.join(allowRoot, "ctx-repo");
    initGitRepo(repoDir, {
      "package.json": JSON.stringify({ name: "ctx-repo" }),
      "src/server.ts": `app.get('/api/ctx', () => {});`,
    });
    const repo = await registerRepo({ path: repoDir });
    expect(repo.verificationStatus).toBe("ok");
    runCompatibilityAnalysis({ audit: false });

    const ctx = await collectRepoContext({
      repoPath: repoDir,
      registeredRepoId: repo.id,
      taskSearchTerms: ["ctx"],
    });
    expect(ctx.contextSummary).toMatch(/Compatibility:/);
    expect(ctx.contextSummary).not.toMatch(new RegExp(allowRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
