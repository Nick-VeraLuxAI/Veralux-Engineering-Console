import type { TaskPriority } from "../types";

export const BRIDGE_REQUEST_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type BridgeRequestPriority = (typeof BRIDGE_REQUEST_PRIORITIES)[number];

export const BRIDGE_REQUEST_TYPES = ["code"] as const;
export type BridgeRequestType = (typeof BRIDGE_REQUEST_TYPES)[number];

export const BRIDGE_REQUEST_SOURCES = ["veralux-os"] as const;
export type BridgeRequestSource = (typeof BRIDGE_REQUEST_SOURCES)[number];

export type VeraluxOsBridgeBusinessContext = {
  dealId?: string;
  buildId?: string;
  clientId?: string;
  supportTicketId?: string;
  module?: string;
};

export type VeraluxOsBridgeCreateRequestBody = {
  title: string;
  priority: BridgeRequestPriority;
  requestType: BridgeRequestType;
  instructions: string;
  source: BridgeRequestSource;
  businessContext?: VeraluxOsBridgeBusinessContext;
  requestedBy: string;
  veraWorkOrderId?: string;
  nonExecutionNote?: string;
};

export type BridgeCreateEngineeringRequestResult = {
  engineeringTaskId: string;
  engineeringRunId: string | null;
  status: string;
  consoleUrl: string;
  createdAt: string;
};

/** Keys VeraLux OS must never send on the bridge create-request contract. */
export const FORBIDDEN_BRIDGE_REQUEST_KEYS = [
  "shell",
  "command",
  "commands",
  "targetRepoPath",
  "registeredRepoId",
  "repoPath",
  "worktree",
  "branch",
  "executeRun",
  "autoRun",
  "approval",
  "approve",
  "reject",
  "merge",
  "deploy",
  "testCommand",
  "buildCommand",
  "runnerMode",
  "allowedPaths",
  "allowedCommands",
] as const;

export function isBridgeRequestPriority(value: string): value is BridgeRequestPriority {
  return (BRIDGE_REQUEST_PRIORITIES as readonly string[]).includes(value);
}

export function mapBridgePriorityToTaskPriority(priority: BridgeRequestPriority): TaskPriority {
  return priority;
}
