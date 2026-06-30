import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
  validateVeraPlaceholderModuleCardHandoff,
  type VeraPlaceholderModuleCardHandoff,
  type VeraPlaceholderModuleCardRequest,
} from "./placeholder-module-card-contract";

export const VERA_PREVIEW_SANDBOX_SCHEMA_VERSION = "vera_builder_loop_preview_sandbox_v1" as const;
const PREVIEW_PREFIX = "vera-builder-loop-preview-";
const PREVIEW_TTL_MS = 1000 * 60 * 60;
const PREVIEW_CACHE_DIR = path.join(os.tmpdir(), "vera-builder-loop-preview-cache");
const PREVIEW_ID_PATTERN = /^[a-f0-9]{24}$/;

export type VeraPreviewSandboxResult = {
  ok: boolean;
  status: "preview_sandbox_ready" | "rejected" | "failed";
  schema_version: typeof VERA_PREVIEW_SANDBOX_SCHEMA_VERSION;
  placeholder_schema_version: typeof VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION;
  errors: string[];
  warnings: string[];
  placeholder_artifact?: VeraPlaceholderModuleCardRequest;
  preview?: {
    preview_id: string;
    preview_label: "Sandbox preview — not integrated";
    preview_url: string;
    preview_route: string;
    preview_status: "ready";
    preview_retention: "temporary_memory_snapshot";
    production_data_used: false;
    authoritative_source_of_truth: false;
  };
  evidence?: {
    evidence_id: string;
    summary: string;
    workspace_type: "system_created_temp_workspace";
    workspace_id: string;
    workspace_retention: "cleaned_up" | "contained_for_test";
    workspace_exists_after_cleanup: boolean;
    generated_files: string[];
    checks_run: Array<{ name: string; status: "passed" | "failed"; summary: string }>;
    boundary_flags: BoundaryFlags;
  };
  boundary_flags: BoundaryFlags;
  execution_mode: "preview_sandbox";
  integration_mode: typeof VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE;
  final_integration_authorized: false;
  repo_mutation_authorized: false;
  branch_creation_authorized: false;
  commit_creation_authorized: false;
  pr_creation_authorized: false;
  deploy_authorized: false;
  merge_authorized: false;
  arbitrary_execution_authorized: false;
  arbitrary_filesystem_path_authorized: false;
  console_metadata_authoritative: false;
};

type BoundaryFlags = {
  sandbox_preview: true;
  system_source_of_truth: true;
  console_metadata_authoritative: false;
  repo_mutation_authorized: false;
  branch_creation_authorized: false;
  commit_creation_authorized: false;
  pr_creation_authorized: false;
  deploy_authorized: false;
  merge_authorized: false;
  final_integration_authorized: false;
  arbitrary_execution_authorized: false;
  arbitrary_filesystem_path_authorized: false;
  production_data_used: false;
};

type PreviewSnapshot = {
  id: string;
  html: string;
  createdAt: number;
};

const previewSnapshots = new Map<string, PreviewSnapshot>();

function previewSnapshotPath(id: string): string | null {
  if (!PREVIEW_ID_PATTERN.test(id)) return null;
  return path.join(PREVIEW_CACHE_DIR, `${id}.html`);
}

function storePreviewSnapshot(snapshot: PreviewSnapshot): void {
  previewSnapshots.set(snapshot.id, snapshot);
  const snapshotPath = previewSnapshotPath(snapshot.id);
  if (!snapshotPath) return;
  fs.mkdirSync(PREVIEW_CACHE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(snapshotPath, snapshot.html, { encoding: "utf8", mode: 0o600 });
}

function boundaryFlags(): BoundaryFlags {
  return {
    sandbox_preview: true,
    system_source_of_truth: true,
    console_metadata_authoritative: false,
    repo_mutation_authorized: false,
    branch_creation_authorized: false,
    commit_creation_authorized: false,
    pr_creation_authorized: false,
    deploy_authorized: false,
    merge_authorized: false,
    final_integration_authorized: false,
    arbitrary_execution_authorized: false,
    arbitrary_filesystem_path_authorized: false,
    production_data_used: false,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function requestedFields(request: VeraPlaceholderModuleCardRequest): Array<[string, string]> {
  const combined = [
    request.module_card_name,
    request.purpose,
    ...request.scope,
    ...request.acceptance_criteria,
  ].join("\n").toLowerCase();
  const defaults: Array<[string, string]> = [
    ["module name", request.module_card_name],
    ["purpose", request.purpose],
    ["integration state", "blocked/manual/future"],
  ];
  const optional: Array<[string, string]> = [
    ["owner", "Proposed owner pending operator assignment"],
    ["status", "proposed"],
    ["evidence state", "sandbox evidence available"],
    ["decision state", "pending operator decision"],
    ["last updated", new Date(0).toISOString().slice(0, 10)],
    ["next action", "Operator reviews preview and records a decision"],
  ];
  return [
    ...defaults,
    ...optional.filter(([field]) => combined.includes(field)),
  ];
}

type ModuleRegistryRecord = {
  moduleName: string;
  purpose: string;
  owner: string;
  status: string;
  evidenceState: string;
  decisionState: string;
  integrationState: string;
  lastUpdated: string;
  nextAction: string;
};

const MODULE_REGISTRY_PURPOSE =
  "Let the operator see proposed VeraLux modules in one place before anything is integrated.";

const MODULE_REGISTRY_RECORDS: ModuleRegistryRecord[] = [
  {
    moduleName: "VeraLux Module Registry",
    purpose: "Shows proposed VeraLux modules before integration.",
    owner: "VeraLux Operator",
    status: "approved proposal",
    evidenceState: "evidence available",
    decisionState: "approved",
    integrationState: "blocked/manual/future",
    lastUpdated: "2026-06-30",
    nextAction: "prepare manual integration candidate",
  },
  {
    moduleName: "Builder Loop Run History",
    purpose: "Tracks prior Builder Loop requests and decision outcomes.",
    owner: "VeraLux Operator",
    status: "proposed",
    evidenceState: "pending",
    decisionState: "undecided",
    integrationState: "blocked/manual/future",
    lastUpdated: "2026-06-30",
    nextAction: "generate proposal",
  },
  {
    moduleName: "Evidence Dashboard",
    purpose: "Summarizes checks, warnings, blockers, and evidence state for operator review.",
    owner: "VeraLux Operator",
    status: "proposed",
    evidenceState: "pending",
    decisionState: "undecided",
    integrationState: "blocked/manual/future",
    lastUpdated: "2026-06-30",
    nextAction: "generate proposal",
  },
];

function isModuleRegistryRequest(request: VeraPlaceholderModuleCardRequest): boolean {
  const combined = [
    request.module_card_name,
    request.purpose,
    ...request.scope,
    ...request.acceptance_criteria,
  ].join("\n").toLowerCase();
  return combined.includes("module registry") || combined.includes("veralux module registry");
}

function renderModuleRegistryPreviewHtml(): string {
  const title = "VeraLux Module Registry";
  const cards = MODULE_REGISTRY_RECORDS.map((record) => `
      <article class="module-card">
        <div class="module-card-header">
          <div>
            <h2>${escapeHtml(record.moduleName)}</h2>
            <p class="module-purpose">${escapeHtml(record.purpose)}</p>
          </div>
          <span class="pill">${escapeHtml(record.status)}</span>
        </div>
        <dl class="module-fields">
          <div><dt>Owner</dt><dd>${escapeHtml(record.owner)}</dd></div>
          <div><dt>Status</dt><dd>${escapeHtml(record.status)}</dd></div>
          <div><dt>Evidence state</dt><dd>${escapeHtml(record.evidenceState)}</dd></div>
          <div><dt>Decision state</dt><dd>${escapeHtml(record.decisionState)}</dd></div>
          <div><dt>Integration state</dt><dd>${escapeHtml(record.integrationState)}</dd></div>
          <div><dt>Last updated date</dt><dd>${escapeHtml(record.lastUpdated)}</dd></div>
          <div class="next-action"><dt>Next action</dt><dd>${escapeHtml(record.nextAction)}</dd></div>
        </dl>
      </article>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} - Sandbox preview</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #07111d; color: #eef6ff; }
    body { margin: 0; padding: 32px; }
    main { max-width: 1040px; margin: 0 auto; border: 1px solid #28445d; border-radius: 24px; padding: 28px; background: #0d1a27; box-shadow: 0 24px 80px rgba(0, 0, 0, .35); }
    .badge { display: inline-block; border: 1px solid #d8b75e; color: #f4d57d; border-radius: 999px; padding: 6px 10px; font-size: 13px; }
    h1 { margin: 18px 0 8px; font-size: 34px; }
    p { color: #a9bacb; line-height: 1.6; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 24px 0; }
    .stat { border: 1px solid #22384d; border-radius: 18px; padding: 14px; background: #102236; }
    .stat strong { display: block; font-size: 24px; }
    .stat span { color: #8fa4b8; font-size: 13px; }
    .module-grid { display: grid; gap: 16px; }
    .module-card { border: 1px solid #22384d; border-radius: 20px; padding: 18px; background: #102236; }
    .module-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    h2 { margin: 0; font-size: 21px; color: #ffffff; }
    .module-purpose { margin: 6px 0 0; color: #9fb2c5; font-size: 14px; line-height: 1.5; }
    .pill { display: inline-flex; border: 1px solid #4a80b5; border-radius: 999px; padding: 4px 8px; color: #b9dcff; background: #112f4d; font-size: 12px; white-space: nowrap; }
    .module-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin: 18px 0 0; }
    .module-fields div { min-width: 0; }
    .module-fields dt { color: #8fa4b8; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
    .module-fields dd { margin: 5px 0 0; color: #eef6ff; line-height: 1.45; overflow-wrap: anywhere; }
    .module-fields .next-action { grid-column: 1 / -1; border-top: 1px solid #22384d; padding-top: 14px; }
    @media (max-width: 640px) {
      body { padding: 16px; }
      main { padding: 20px; }
      .module-card-header { display: grid; }
    }
    .footer { margin-top: 20px; border-top: 1px solid #22384d; padding-top: 16px; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <span class="badge">Sandbox preview — not integrated</span>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(MODULE_REGISTRY_PURPOSE)}</p>
    <section class="summary" aria-label="Registry summary">
      <div class="stat"><strong>${MODULE_REGISTRY_RECORDS.length}</strong><span>sample module records</span></div>
      <div class="stat"><strong>0</strong><span>integrated modules</span></div>
      <div class="stat"><strong>manual</strong><span>future integration state</span></div>
    </section>
    <section class="module-grid" aria-label="Module records">${cards}</section>
    <p class="footer"><strong>Final integration:</strong> blocked/manual/future. This preview is temporary, non-authoritative, and uses no production data.</p>
  </main>
</body>
</html>`;
}

function renderPreviewHtml(request: VeraPlaceholderModuleCardRequest): string {
  if (isModuleRegistryRequest(request)) {
    return renderModuleRegistryPreviewHtml();
  }

  const rows = requestedFields(request)
    .map(([label, value]) => `
      <div class="row">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>`)
    .join("");
  const criteria = request.acceptance_criteria.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(request.module_card_name)} - Sandbox preview</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #07111d; color: #eef6ff; }
    body { margin: 0; padding: 32px; }
    main { max-width: 900px; margin: 0 auto; border: 1px solid #28445d; border-radius: 24px; padding: 28px; background: #0d1a27; }
    .badge { display: inline-block; border: 1px solid #d8b75e; color: #f4d57d; border-radius: 999px; padding: 6px 10px; font-size: 13px; }
    h1 { margin: 18px 0 8px; font-size: 34px; }
    p { color: #a9bacb; line-height: 1.6; }
    dl { display: grid; gap: 12px; margin-top: 24px; }
    .row { display: grid; grid-template-columns: 180px 1fr; gap: 16px; border-top: 1px solid #22384d; padding-top: 12px; }
    dt { color: #7f95aa; text-transform: uppercase; font-size: 12px; letter-spacing: .08em; }
    dd { margin: 0; }
    li { margin: 8px 0; color: #d9e7f5; }
  </style>
</head>
<body>
  <main>
    <span class="badge">Sandbox preview — not integrated</span>
    <h1>${escapeHtml(request.module_card_name)}</h1>
    <p>${escapeHtml(request.purpose)}</p>
    <dl>${rows}</dl>
    <h2>Acceptance criteria</h2>
    <ul>${criteria}</ul>
    <p><strong>Final integration:</strong> blocked/manual/future. This preview is temporary, non-authoritative, and uses no production data.</p>
  </main>
</body>
</html>`;
}

function baseResult(input: Partial<VeraPreviewSandboxResult> & Pick<VeraPreviewSandboxResult, "ok" | "status">): VeraPreviewSandboxResult {
  const flags = boundaryFlags();
  return {
    ok: input.ok,
    status: input.status,
    schema_version: VERA_PREVIEW_SANDBOX_SCHEMA_VERSION,
    placeholder_schema_version: VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
    errors: input.errors ?? [],
    warnings: input.warnings ?? [],
    ...(input.placeholder_artifact ? { placeholder_artifact: input.placeholder_artifact } : {}),
    ...(input.preview ? { preview: input.preview } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
    boundary_flags: flags,
    execution_mode: "preview_sandbox",
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
    console_metadata_authoritative: false,
  };
}

function cleanupExpiredSnapshots(now = Date.now()): void {
  for (const [id, snapshot] of previewSnapshots.entries()) {
    if (now - snapshot.createdAt > PREVIEW_TTL_MS) previewSnapshots.delete(id);
  }
  if (!fs.existsSync(PREVIEW_CACHE_DIR)) return;
  for (const entry of fs.readdirSync(PREVIEW_CACHE_DIR)) {
    if (!/^[a-f0-9]{24}\.html$/.test(entry)) continue;
    const snapshotPath = path.join(PREVIEW_CACHE_DIR, entry);
    const stat = fs.statSync(snapshotPath);
    if (now - stat.mtimeMs > PREVIEW_TTL_MS) {
      fs.rmSync(snapshotPath, { force: true });
    }
  }
}

export function getVeraPreviewSandboxSnapshot(id: string): PreviewSnapshot | null {
  cleanupExpiredSnapshots();
  const snapshot = previewSnapshots.get(id);
  if (snapshot) return snapshot;
  const snapshotPath = previewSnapshotPath(id);
  if (!snapshotPath || !fs.existsSync(snapshotPath)) return null;
  const stat = fs.statSync(snapshotPath);
  const restored = {
    id,
    html: fs.readFileSync(snapshotPath, "utf8"),
    createdAt: stat.mtimeMs,
  };
  previewSnapshots.set(id, restored);
  return restored;
}

export function runVeraPlaceholderModuleCardPreviewSandbox(
  raw: unknown,
  deps: { tempRoot?: string; workspaceId?: () => string; cleanup?: boolean } = {},
): VeraPreviewSandboxResult {
  const validation = validateVeraPlaceholderModuleCardHandoff(raw);
  if (!validation.ok || !validation.placeholder_artifact) {
    return baseResult({
      ok: false,
      status: "rejected",
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  const handoff = raw as VeraPlaceholderModuleCardHandoff;
  const workspaceId = (deps.workspaceId?.() ?? sha256(`${Date.now()}-${Math.random()}`).slice(0, 12)).replace(/[^a-zA-Z0-9_-]/g, "");
  const workspacePath = fs.mkdtempSync(path.join(deps.tempRoot ?? os.tmpdir(), `${PREVIEW_PREFIX}${workspaceId}-`));
  const previewHtml = renderPreviewHtml(handoff.request);
  const previewPath = path.join(workspacePath, "preview.html");
  const cleanup = deps.cleanup !== false;

  try {
    fs.writeFileSync(previewPath, previewHtml, { encoding: "utf8", mode: 0o600 });
    const previewId = sha256(`${workspaceId}:${previewHtml}`).slice(0, 24);
    const previewRoute = `/api/engineer-console/bridge/placeholder-module-card/preview-sandbox/previews/${previewId}`;
    storePreviewSnapshot({ id: previewId, html: previewHtml, createdAt: Date.now() });

    const checks = [
      {
        name: "preview_workspace_containment",
        status: path.resolve(previewPath).startsWith(`${path.resolve(workspacePath)}${path.sep}`) ? "passed" as const : "failed" as const,
        summary: "Preview HTML was generated inside the system-created temp workspace.",
      },
      {
        name: "preview_sandbox_static_html",
        status: previewHtml.includes("Sandbox preview — not integrated") ? "passed" as const : "failed" as const,
        summary: "Preview is a static sandbox snapshot with no production data hooks.",
      },
    ];
    const passed = checks.every((check) => check.status === "passed");
    if (cleanup) fs.rmSync(workspacePath, { recursive: true, force: true });

    return baseResult({
      ok: passed,
      status: passed ? "preview_sandbox_ready" : "failed",
      errors: passed ? [] : checks.filter((check) => check.status === "failed").map((check) => check.summary),
      warnings: [
        "Sandbox preview is temporary and not integrated.",
        "Console preview evidence is non-authoritative where System owns source-of-truth state.",
      ],
      placeholder_artifact: validation.placeholder_artifact,
      preview: {
        preview_id: previewId,
        preview_label: "Sandbox preview — not integrated",
        preview_url: previewRoute,
        preview_route: previewRoute,
        preview_status: "ready",
        preview_retention: "temporary_memory_snapshot",
        production_data_used: false,
        authoritative_source_of_truth: false,
      },
      evidence: {
        evidence_id: `preview-sandbox-${previewId}`,
        summary: `Console generated a temporary sandbox preview for "${handoff.request.module_card_name}".`,
        workspace_type: "system_created_temp_workspace",
        workspace_id: workspaceId,
        workspace_retention: cleanup ? "cleaned_up" : "contained_for_test",
        workspace_exists_after_cleanup: fs.existsSync(workspacePath),
        generated_files: ["preview.html"],
        checks_run: checks,
        boundary_flags: boundaryFlags(),
      },
    });
  } catch (error) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
    return baseResult({
      ok: false,
      status: "failed",
      errors: [error instanceof Error ? error.message : String(error)],
      placeholder_artifact: validation.placeholder_artifact,
    });
  }
}
