import type { GenerateWorkerPlanDraftInput } from "./model-provider-types";

export function buildWorkerPlanPrompt(input: GenerateWorkerPlanDraftInput): string {
  const allowedList =
    input.allowedFiles.length > 0
      ? input.allowedFiles.map((f) => `  - ${f}`).join("\n")
      : "  (operator did not pre-specify — propose safe paths under src/)";

  const scripts =
    Object.keys(input.packageScripts).length > 0
      ? JSON.stringify(input.packageScripts, null, 2)
      : "{}";

  const changed =
    input.existingChangedFiles.length > 0
      ? input.existingChangedFiles.map((f) => `  - ${f}`).join("\n")
      : "  (none)";

  const constraintBlock =
    input.constraints.length > 0
      ? input.constraints.map((c) => `- ${c}`).join("\n")
      : "- No additional constraints";

  return [
    "You are a code planning assistant for the VeraLux Engineer Console.",
    "Output ONLY a single JSON object matching the worker plan schema below.",
    "Do not include markdown, code fences, commentary, or shell commands.",
    "Invalid JSON or schema violations will be rejected before any file is written.",
    "",
    "## Worker plan schema",
    "{",
    '  "runId": "string (must match run)",',
    '  "summary": "string",',
    '  "allowedFiles": ["relative/path.ts", "..."],',
    '  "operations": [',
    "    {",
    '      "type": "create_file" | "update_file" | "append_file",',
    '      "path": "relative/path (must appear in allowedFiles)",',
    '      "content": "full file content for create/update, or suffix for append",',
    '      "reason": "concise reason"',
    "    }",
    "  ]",
    "}",
    "",
    "## Hard rules (violations cause rejection)",
    "- Relative paths only. No absolute paths. No ../ traversal.",
    "- Operation types: create_file, update_file, append_file ONLY.",
    "- NO delete operations. NO shell/exec/run_command operations.",
    "- NEVER touch: .env, .env.*, .git, node_modules, package-lock.json, migrations/.",
    "- Every operation path MUST be listed in allowedFiles.",
    "- Non-empty content for every operation.",
    "- Maximum operations: " + String(input.maxOperations),
    "- Output must be valid JSON only.",
    "",
    "## Task",
    `Title: ${input.taskTitle}`,
    `Description: ${input.taskDescription}`,
    `Run ID (use exactly): ${input.runId}`,
    `Repo path (context only, do not embed): ${input.repoPath}`,
    "",
    "## Allowed files (operations must be subset)",
    allowedList,
    "",
    "## package.json scripts",
    scripts,
    "",
    "## Existing changed files (git)",
    changed,
    "",
    "## Repo context summary",
    input.repoContextSummary,
    "",
    "## Additional constraints",
    constraintBlock,
    "",
    "Generate the worker plan JSON now.",
  ].join("\n");
}

export const PROMPT_SAFETY_KEYWORDS = [
  "NO delete",
  ".env",
  "node_modules",
  "package-lock",
  "valid JSON only",
  "create_file",
  "update_file",
  "append_file",
  "allowedFiles",
  "No absolute paths",
] as const;
