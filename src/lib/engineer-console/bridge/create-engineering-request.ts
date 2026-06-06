import { getRepoRootAllowlist } from "../repo-intelligence/registered-repos/repo-path-policy";
import { listRegisteredRepos } from "../repo-intelligence/registered-repos/list-repos";
import { createTask } from "../task-manager/task-manager";
import {
  FORBIDDEN_BRIDGE_REQUEST_KEYS,
  isBridgeRequestPriority,
  mapBridgePriorityToTaskPriority,
  type BridgeCreateEngineeringRequestResult,
  type VeraluxOsBridgeCreateRequestBody,
} from "./create-engineering-request-types";
import {
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_WORK_ORDER_MODULE_PREFIX,
} from "./vera-handoff-task-types";

const VERA_WORK_ORDER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BridgeRequestValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "BridgeRequestValidationError";
  }
}

export class BridgeRepoResolutionError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "BridgeRepoResolutionError";
  }
}

function assertNoForbiddenKeys(raw: Record<string, unknown>): void {
  for (const key of FORBIDDEN_BRIDGE_REQUEST_KEYS) {
    if (key in raw && raw[key] !== undefined) {
      throw new BridgeRequestValidationError(
        `Field "${key}" is not allowed on VeraLux OS bridge requests.`,
      );
    }
  }
}

export function parseVeraluxOsBridgeCreateRequestBody(
  raw: unknown,
): VeraluxOsBridgeCreateRequestBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BridgeRequestValidationError("Request body must be a JSON object.");
  }

  const body = raw as Record<string, unknown>;
  assertNoForbiddenKeys(body);

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    throw new BridgeRequestValidationError("title is required.");
  }

  const priorityRaw = typeof body.priority === "string" ? body.priority.trim() : "";
  if (!isBridgeRequestPriority(priorityRaw)) {
    throw new BridgeRequestValidationError(
      "priority must be one of: low, normal, high, urgent.",
    );
  }

  const requestType = typeof body.requestType === "string" ? body.requestType.trim() : "";
  if (requestType !== "code") {
    throw new BridgeRequestValidationError('requestType must be "code".');
  }

  const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
  if (!instructions) {
    throw new BridgeRequestValidationError("instructions is required.");
  }

  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (source !== "veralux-os") {
    throw new BridgeRequestValidationError('source must be "veralux-os".');
  }

  const requestedBy = typeof body.requestedBy === "string" ? body.requestedBy.trim() : "";
  if (!requestedBy) {
    throw new BridgeRequestValidationError("requestedBy is required.");
  }

  let businessContext: VeraluxOsBridgeCreateRequestBody["businessContext"];
  if (body.businessContext !== undefined && body.businessContext !== null) {
    if (typeof body.businessContext !== "object" || Array.isArray(body.businessContext)) {
      throw new BridgeRequestValidationError("businessContext must be an object.");
    }
    const ctx = body.businessContext as Record<string, unknown>;
    businessContext = {};
    for (const field of ["dealId", "buildId", "clientId", "supportTicketId", "module"] as const) {
      const value = ctx[field];
      if (value === undefined || value === null) continue;
      if (typeof value !== "string" || !value.trim()) {
        throw new BridgeRequestValidationError(`businessContext.${field} must be a non-empty string.`);
      }
      businessContext[field] = value.trim();
    }
    if (Object.keys(businessContext).length === 0) {
      businessContext = undefined;
    }
  }

  let veraWorkOrderId: string | undefined;
  if (body.veraWorkOrderId !== undefined && body.veraWorkOrderId !== null) {
    if (typeof body.veraWorkOrderId !== "string") {
      throw new BridgeRequestValidationError("veraWorkOrderId must be a string.");
    }
    const trimmedWorkOrderId = body.veraWorkOrderId.trim();
    if (!VERA_WORK_ORDER_ID_PATTERN.test(trimmedWorkOrderId)) {
      throw new BridgeRequestValidationError("veraWorkOrderId must be a valid UUID.");
    }
    veraWorkOrderId = trimmedWorkOrderId;
  }

  let nonExecutionNote: string | undefined;
  if (body.nonExecutionNote !== undefined && body.nonExecutionNote !== null) {
    if (typeof body.nonExecutionNote !== "string") {
      throw new BridgeRequestValidationError("nonExecutionNote must be a string.");
    }
    const trimmedNote = body.nonExecutionNote.trim();
    if (!trimmedNote) {
      throw new BridgeRequestValidationError("nonExecutionNote must be a non-empty string.");
    }
    if (!trimmedNote.includes(VERA_HANDOFF_NON_EXECUTION_NOTE)) {
      throw new BridgeRequestValidationError(
        `nonExecutionNote must include the canonical safety note: ${VERA_HANDOFF_NON_EXECUTION_NOTE}`,
      );
    }
    nonExecutionNote = trimmedNote;
  }

  return {
    title,
    priority: priorityRaw,
    requestType: "code",
    instructions,
    source: "veralux-os",
    businessContext,
    requestedBy,
    veraWorkOrderId,
    nonExecutionNote,
  };
}

function formatTaskDescription(body: VeraluxOsBridgeCreateRequestBody): string {
  const lines = [
    "## Engineering request from VeraLux OS",
    "",
    `- **Source:** ${body.source}`,
    `- **Requested by:** ${body.requestedBy}`,
    `- **Request type:** ${body.requestType}`,
    `- **Priority:** ${body.priority}`,
    "",
    "### Instructions",
    "",
  ];

  if (body.nonExecutionNote) {
    lines.push(VERA_HANDOFF_NON_EXECUTION_NOTE, "");
  }

  lines.push(body.instructions);

  if (body.veraWorkOrderId) {
    lines.push("", `Source work order ID: ${body.veraWorkOrderId}`);
  }

  const businessContext = { ...(body.businessContext ?? {}) };
  if (body.veraWorkOrderId) {
    businessContext.module = `${VERA_WORK_ORDER_MODULE_PREFIX}${body.veraWorkOrderId}`;
  }

  if (Object.keys(businessContext).length > 0) {
    lines.push(
      "",
      "### Business context",
      "",
      "```json",
      JSON.stringify(businessContext, null, 2),
      "```",
    );
  }

  return lines.join("\n");
}

function resolveBridgeDefaultRepoBinding(): {
  registeredRepoId?: string;
  targetRepoPath?: string;
} {
  const envRepoId = process.env.ENGINEER_CONSOLE_BRIDGE_DEFAULT_REGISTERED_REPO_ID?.trim();
  if (envRepoId) {
    return { registeredRepoId: envRepoId };
  }

  const registered = listRegisteredRepos();
  if (registered.length > 0) {
    return { registeredRepoId: registered[0]!.id };
  }

  const roots = getRepoRootAllowlist();
  if (roots && roots.length === 1) {
    return { targetRepoPath: roots[0] };
  }

  throw new BridgeRepoResolutionError(
    "No default repository is configured for VeraLux OS bridge requests. Register a repo in Engineering Console or set ENGINEER_CONSOLE_BRIDGE_DEFAULT_REGISTERED_REPO_ID.",
  );
}

/**
 * Creates a draft engineering task from a VeraLux OS high-level request.
 * Does not start runs or execute code — operators continue in Engineering Console.
 */
export function createEngineeringRequestFromVeraluxOsBridge(
  body: VeraluxOsBridgeCreateRequestBody,
  options: { consoleOrigin?: string } = {},
): BridgeCreateEngineeringRequestResult {
  const repoBinding = resolveBridgeDefaultRepoBinding();
  const task = createTask({
    title: body.title,
    description: formatTaskDescription(body),
    priority: mapBridgePriorityToTaskPriority(body.priority),
    status: "draft",
    ...repoBinding,
  });

  const origin = (options.consoleOrigin ?? "").replace(/\/$/, "");
  const consolePath = `/engineer/tasks/${task.id}`;
  const consoleUrl = origin ? `${origin}${consolePath}` : consolePath;

  return {
    engineeringTaskId: task.id,
    engineeringRunId: null,
    status: task.status,
    consoleUrl,
    createdAt: task.createdAt,
  };
}
