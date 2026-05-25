import type { WorkerPlan } from "../worker-plan/worker-plan-types";

export interface GenerateWorkerPlanDraftInput {
  runId: string;
  taskTitle: string;
  taskDescription: string;
  repoPath: string;
  allowedFiles: string[];
  repoContextSummary: string;
  packageScripts: Record<string, string>;
  existingChangedFiles: string[];
  constraints: string[];
  maxOperations: number;
  prompt: string;
}

export interface ModelUsageMetadata {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

export interface GenerateWorkerPlanDraftResult {
  providerName: string;
  modelName: string;
  rawResponse: string;
  parsedPlan: WorkerPlan | null;
  parseErrors: string[];
  usage: ModelUsageMetadata;
  createdAt: string;
}

export interface ModelProvider {
  readonly name: string;
  generateWorkerPlanDraft(
    input: GenerateWorkerPlanDraftInput,
  ): Promise<GenerateWorkerPlanDraftResult>;
}
