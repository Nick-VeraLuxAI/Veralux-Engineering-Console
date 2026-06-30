import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getVeraPreviewSandboxSnapshot,
  runVeraPlaceholderModuleCardPreviewSandbox,
  VERA_PREVIEW_SANDBOX_SCHEMA_VERSION,
} from "./placeholder-module-card-preview-sandbox";
import { GET as getPreviewRoute } from "@/app/api/engineer-console/bridge/placeholder-module-card/preview-sandbox/previews/[id]/route";
import {
  VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
  VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
  type VeraPlaceholderModuleCardHandoff,
} from "./placeholder-module-card-contract";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vera-preview-sandbox-test-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(path.join(os.tmpdir(), "vera-builder-loop-preview-cache"), { recursive: true, force: true });
});

function handoff(overrides: Partial<VeraPlaceholderModuleCardHandoff> = {}): VeraPlaceholderModuleCardHandoff {
  return {
    schema_version: VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
    source: "veralux-system",
    requested_by: "operator",
    artifact_type: VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
    execution_mode: VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
    integration_mode: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
    final_integration_authorized: false,
    repo_mutation_authorized: false,
    branch_creation_authorized: false,
    commit_creation_authorized: false,
    pr_creation_authorized: false,
    deploy_authorized: false,
    merge_authorized: false,
    arbitrary_execution_authorized: false,
    arbitrary_filesystem_path_authorized: false,
    system_source_of_truth: true,
    console_metadata_authoritative: false,
    request: {
      module_card_name: "VeraLux Module Registry",
      purpose: "Raw operator prompt: Build a module registry with sample data for VeraLux Module Registry, Builder Loop Run History, and Evidence Dashboard. Include every requested field and make it look like a dashboard.",
      scope: [
        "Show module name, purpose, owner, status, evidence state, decision state, integration state, last updated date, and next action.",
      ],
      constraints: ["Use only the safe isolated Console workspace path."],
      risks: ["Preview could be mistaken for integrated source of truth."],
      acceptance_criteria: [
        "Shows owner.",
        "Shows evidence state.",
        "Shows final integration blocked/manual/future.",
      ],
      requested_artifact_type: VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE,
      integration_status: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
    },
    ...overrides,
  };
}

describe("Vera preview sandbox for placeholder module card", () => {
  it("creates a temporary preview only in an isolated workspace and exposes a safe route snapshot", () => {
    const result = runVeraPlaceholderModuleCardPreviewSandbox(handoff(), {
      tempRoot,
      workspaceId: () => "preview",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("preview_sandbox_ready");
    expect(result.schema_version).toBe(VERA_PREVIEW_SANDBOX_SCHEMA_VERSION);
    expect(result.preview?.preview_label).toBe("Sandbox preview — not integrated");
    expect(result.preview?.preview_route).toMatch(/^\/api\/engineer-console\/bridge\/placeholder-module-card\/preview-sandbox\/previews\/[a-f0-9]{24}$/);
    expect(result.preview?.production_data_used).toBe(false);
    expect(result.preview?.authoritative_source_of_truth).toBe(false);
    expect(result.evidence?.workspace_retention).toBe("cleaned_up");
    expect(result.evidence?.workspace_exists_after_cleanup).toBe(false);
    expect(result.evidence?.generated_files).toEqual(["preview.html"]);
    expect(result.evidence?.checks_run.every((check) => check.status === "passed")).toBe(true);

    const workspaces = fs.readdirSync(tempRoot).filter((entry) => entry.startsWith("vera-builder-loop-preview-"));
    expect(workspaces).toHaveLength(0);
    const previewId = result.preview?.preview_id ?? "";
    const snapshot = getVeraPreviewSandboxSnapshot(previewId);
    expect(snapshot?.html).toContain("Sandbox preview — not integrated");
    expect(snapshot?.html).toContain("VeraLux Module Registry");
    expect(snapshot?.html).toContain("blocked/manual/future");
  });

  it("renders Module Registry as structured records without dumping the raw prompt into the body", () => {
    const registryHandoff = handoff({
      request: {
        ...handoff().request,
        module_card_name: "Sandbox Preview",
      },
    });
    const result = runVeraPlaceholderModuleCardPreviewSandbox(registryHandoff, {
      tempRoot,
      workspaceId: () => "registry-preview",
    });

    expect(result.ok).toBe(true);
    expect(result.boundary_flags.repo_mutation_authorized).toBe(false);
    expect(result.boundary_flags.branch_creation_authorized).toBe(false);
    expect(result.boundary_flags.commit_creation_authorized).toBe(false);
    expect(result.boundary_flags.pr_creation_authorized).toBe(false);
    expect(result.boundary_flags.deploy_authorized).toBe(false);
    expect(result.boundary_flags.merge_authorized).toBe(false);
    expect(result.boundary_flags.final_integration_authorized).toBe(false);
    expect(result.boundary_flags.arbitrary_execution_authorized).toBe(false);
    expect(result.boundary_flags.arbitrary_filesystem_path_authorized).toBe(false);
    expect(result.boundary_flags.production_data_used).toBe(false);

    const snapshot = getVeraPreviewSandboxSnapshot(result.preview?.preview_id ?? "");
    const html = snapshot?.html ?? "";
    expect(html).toContain("<title>VeraLux Module Registry - Sandbox preview</title>");
    expect(html).toContain("<h1>VeraLux Module Registry</h1>");
    expect(html).toContain("Sandbox preview — not integrated");
    expect(html).toContain("Let the operator see proposed VeraLux modules in one place before anything is integrated.");
    expect(html).not.toContain("Raw operator prompt:");
    expect(html).not.toContain("Build a module registry with sample data");

    for (const moduleName of [
      "VeraLux Module Registry",
      "Builder Loop Run History",
      "Evidence Dashboard",
    ]) {
      expect(html).toContain(`<h2>${moduleName}</h2>`);
    }
    expect(html.match(/<article class="module-card">/g)).toHaveLength(3);
    expect(html).toContain(".module-fields .next-action { grid-column: 1 / -1;");
    expect(html).toContain("overflow-wrap: anywhere");
    for (const field of [
      "Status",
      "Evidence state",
      "Decision state",
      "Integration state",
      "Last updated date",
      "Next action",
    ]) {
      expect(html).toContain(field);
    }
    expect(html).toContain("VeraLux Operator");
    expect(html).toContain("approved proposal");
    expect(html).toContain("evidence available");
    expect(html).toContain("approved");
    expect(html).toContain("undecided");
    expect(html).toContain("2026-06-30");
    expect(html).toContain("blocked/manual/future");
    expect(html).toContain("prepare manual integration candidate");
    expect(html).toContain("generate proposal");
  });

  it("rejects arbitrary paths and authority escalation without branch, commit, PR, deploy, merge, or integration", () => {
    const result = runVeraPlaceholderModuleCardPreviewSandbox({
      ...handoff(),
      target_repo_path: "/tmp/not-allowed",
      final_integration_authorized: true,
      request: {
        ...handoff().request,
        command: "npm run deploy",
      },
    }, { tempRoot });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.errors.join("\n")).toContain("target_repo_path");
    expect(result.errors.join("\n")).toContain("final_integration_authorized must be false");
    expect(result.errors.join("\n")).toContain("request.command");
    expect(result.boundary_flags.repo_mutation_authorized).toBe(false);
    expect(result.boundary_flags.branch_creation_authorized).toBe(false);
    expect(result.boundary_flags.commit_creation_authorized).toBe(false);
    expect(result.boundary_flags.pr_creation_authorized).toBe(false);
    expect(result.boundary_flags.deploy_authorized).toBe(false);
    expect(result.boundary_flags.merge_authorized).toBe(false);
    expect(result.boundary_flags.final_integration_authorized).toBe(false);
    expect(result.boundary_flags.production_data_used).toBe(false);
    expect(fs.readdirSync(tempRoot)).toHaveLength(0);
  });

  it("does not expose arbitrary files through preview snapshot lookup", () => {
    expect(getVeraPreviewSandboxSnapshot("../package.json")).toBeNull();
    expect(getVeraPreviewSandboxSnapshot("/etc/passwd")).toBeNull();
    expect(getVeraPreviewSandboxSnapshot("missing-preview-id")).toBeNull();
  });

  it("serves generated preview IDs as renderable HTML instead of JSON or raw text", async () => {
    const result = runVeraPlaceholderModuleCardPreviewSandbox(handoff(), {
      tempRoot,
      workspaceId: () => "route-html",
    });
    const previewId = result.preview?.preview_id ?? "";

    const response = await getPreviewRoute(
      new Request(`http://console.local/api/engineer-console/bridge/placeholder-module-card/preview-sandbox/previews/${previewId}`),
      { params: Promise.resolve({ id: previewId }) },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("<h1>VeraLux Module Registry</h1>");
    expect(body).toContain("Sandbox preview — not integrated");
    expect(body).toContain("Let the operator see proposed VeraLux modules in one place before anything is integrated.");
    for (const moduleName of [
      "VeraLux Module Registry",
      "Builder Loop Run History",
      "Evidence Dashboard",
    ]) {
      expect(body).toContain(`<h2>${moduleName}</h2>`);
    }
    for (const field of [
      "Status",
      "Evidence state",
      "Decision state",
      "Integration state",
      "Last updated date",
      "Next action",
    ]) {
      expect(body).toContain(field);
    }
    expect(body.trim().startsWith("{")).toBe(false);
    expect(body).not.toContain('"result"');
    expect(response.headers.get("Content-Type")).not.toContain("application/json");
    expect(response.headers.get("Content-Type")).not.toContain("text/plain");
  });
});
