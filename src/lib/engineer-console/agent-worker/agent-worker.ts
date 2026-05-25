export const AGENT_PLACEHOLDER_MESSAGE =
  "Agent execution placeholder — model integration pending.";

export interface AgentWorkerInput {
  taskTitle: string;
  taskDescription: string;
  repoPath: string;
  branchName: string;
}

export interface AgentWorkerResult {
  message: string;
  simulatedPatchApplied: boolean;
}

/**
 * Stub agent worker — records placeholder output without calling external models.
 */
export async function runAgentWorker(input: AgentWorkerInput): Promise<AgentWorkerResult> {
  void input;
  return {
    message: AGENT_PLACEHOLDER_MESSAGE,
    simulatedPatchApplied: false,
  };
}
