import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const DETECTION = "src/lib/engineer-console/bridge/vera-handoff-task.ts";
const DETECTION_TYPES = "src/lib/engineer-console/bridge/vera-handoff-task-types.ts";
const PREPARE = "src/lib/engineer-console/bridge/prepare-vera-implementation-run.ts";
const ROUTE = "src/app/api/engineer-console/tasks/[id]/prepare-vera-implementation-run/route.ts";
const PANEL = "src/components/engineer-console/vera-handoff-task-panel.tsx";
const PAGE = "src/app/(main)/engineer/tasks/[id]/page.tsx";

describe("Vera implementation run preparation Phase 2I", () => {
  it("detection service uses deterministic Vera markers", () => {
    const source = readFileSync(path.join(root, DETECTION), "utf8");
    const types = readFileSync(path.join(root, DETECTION_TYPES), "utf8");
    expect(source).toContain("analyzeVeraHandoffTask");
    expect(types).toContain("isVeraLuxOsHandoffDescription");
    expect(types).toContain("extractVeraWorkOrderIdFromDescription");
    expect(types).toContain("vera-work-order:");
    expect(types).toContain("This request does not execute code.");
  });

  it("prepare route uses mutation auth and does not execute runs", () => {
    const source = readFileSync(path.join(root, ROUTE), "utf8");
    expect(source).toContain("ensureEngineerConsoleReady");
    expect(source).toContain("authorizeMutation");
    expect(source).toContain("prepareVeraImplementationRun");
    expect(source).not.toMatch(/executeRun\s*\(/);
  });

  it("task page mounts Vera handoff panel and disables standard start run", () => {
    const source = readFileSync(path.join(root, PAGE), "utf8");
    expect(source).toContain("VeraHandoffTaskPanel");
    expect(source).toContain("analyzeVeraHandoffTask");
    expect(source).toContain("Standard");
    expect(source).toContain("Start run");
  });

  it("UI panel includes confirmation gate and non-execution messaging", () => {
    const source = readFileSync(path.join(root, PANEL), "utf8");
    expect(source).toContain("VeraLux OS handoff");
    expect(source).toContain("vera-handoff-task-types");
    expect(source).toContain("Preparing this run does not execute code");
    expect(source).toContain("Run prepared — execution still gated");
    expect(source).toContain("resolveVeraHandoffPrepareUiOutcome");
    expect(source).not.toMatch(/executeRun\s*\(/);
  });

  it("prepare service documents non-execution boundary", () => {
    const source = readFileSync(path.join(root, PREPARE), "utf8");
    expect(source).toContain("VERA_IMPLEMENTATION_RUN_PREPARED_STEP");
    expect(source).toContain("createRun");
    expect(source).not.toContain("executeRun");
  });
});
