import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  UI_AUDIT_OUTPUT_FILES,
  UI_AUDIT_ROUTE_AREAS,
  runUiConsistencyAudit,
} from "../../../../scripts/audit-ui-consistency.mjs";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dirPath) => {
      await fs.rm(dirPath, { recursive: true, force: true });
    }),
  );
});

describe("audit-ui-consistency script", () => {
  it("generates markdown and JSON reports without throwing", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "ui-audit-"));
    tempDirs.push(outputDir);

    const repoRoot = path.resolve(process.cwd());
    const result = await runUiConsistencyAudit({ repoRoot, outputDir });
    const markdown = await fs.readFile(result.markdownPath, "utf8");
    const jsonText = await fs.readFile(result.jsonPath, "utf8");
    const json = JSON.parse(jsonText);

    expect(path.basename(result.markdownPath)).toBe(UI_AUDIT_OUTPUT_FILES.markdown);
    expect(path.basename(result.jsonPath)).toBe(UI_AUDIT_OUTPUT_FILES.json);
    expect(markdown).toContain("# VeraLux UI Consistency Audit");
    expect(markdown).toContain("## Route-Level Findings");
    expect(markdown).toContain("## Component-Level Findings");
    expect(json.overallScore).toBeGreaterThanOrEqual(0);
    expect(json.overallScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(json.findings)).toBe(true);
    expect(Array.isArray(json.routeFindings)).toBe(true);
    expect(json.routeFindings.some((entry) => entry.route === "/engineer")).toBe(true);
    expect(json.findings.some((finding) => finding.category === "component-reuse")).toBe(true);
  });

  it("defines the expected engineer route areas for the audit summary", () => {
    expect(UI_AUDIT_ROUTE_AREAS.map((area) => area.route)).toEqual(
      expect.arrayContaining(["/engineer", "/engineer/repos", "/engineer/compatibility", "/engineer/runs/:id"]),
    );
  });

  it("registers the npm audit script in package.json", async () => {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

    expect(packageJson.scripts["audit:ui"]).toBe("node scripts/audit-ui-consistency.mjs");
  });
});
