export const PROJECT_STATUSES = [
  "draft",
  "ready",
  "running",
  "paused",
  "blocked",
  "verification",
  "completed",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_ORCHESTRATION_STATUSES = [
  "idle",
  "selecting_requirement",
  "task_ready",
  "waiting_for_task",
  "waiting_for_verification",
  "blocked",
  "paused",
  "completed",
] as const;

export type ProjectOrchestrationStatus =
  (typeof PROJECT_ORCHESTRATION_STATUSES)[number];

export const REQUIREMENT_STATUSES = [
  "pending",
  "ready",
  "in_progress",
  "verification",
  "completed",
  "failed",
  "blocked",
  "reopened",
  "cancelled",
] as const;

export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export type RequirementPriority = "low" | "normal" | "high" | "urgent";

export const ACCEPTANCE_CRITERION_STATUSES = [
  "pending",
  "satisfied",
  "failed",
  "waived",
] as const;

export type AcceptanceCriterionStatus =
  (typeof ACCEPTANCE_CRITERION_STATUSES)[number];

export const VERIFICATION_TYPES = [
  "test",
  "build",
  "lint",
  "typecheck",
  "manual_review",
  "model_review",
  "artifact",
  "runtime_check",
] as const;

export type VerificationType = (typeof VERIFICATION_TYPES)[number];

export const ORCHESTRATION_DECISION_TYPES = [
  "select_requirement",
  "create_task",
  "dispatch_task",
  "request_verification",
  "accept_requirement",
  "reject_requirement",
  "retry_task",
  "replan_requirement",
  "block_requirement",
  "escalate",
  "pause_project",
  "resume_project",
  "complete_project",
] as const;

export type OrchestrationDecisionType =
  (typeof ORCHESTRATION_DECISION_TYPES)[number];

export interface EngineerProject {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  orchestrationStatus: ProjectOrchestrationStatus;
  currentRequirementId: string | null;
  activeSpecificationId: string | null;
  targetRepoPath: string | null;
  registeredRepoId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSpecification {
  id: string;
  projectId: string;
  version: number;
  title: string;
  content: string;
  contentHash: string;
  status: "active" | "superseded";
  createdAt: string;
  supersedesSpecificationId: string | null;
}

export interface ProjectRequirement {
  id: string;
  projectId: string;
  specificationId: string;
  stableKey: string;
  title: string;
  description: string;
  status: RequirementStatus;
  priority: RequirementPriority;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  blockedReason: string | null;
}

export interface AcceptanceCriterion {
  id: string;
  requirementId: string;
  stableKey: string;
  description: string;
  verificationType: VerificationType;
  status: AcceptanceCriterionStatus;
  evidenceRequired: boolean;
}

export interface RequirementDependency {
  requirementId: string;
  dependsOnRequirementId: string;
  dependencyType: "blocking";
  createdAt: string;
}

export interface RequirementTaskLink {
  id: string;
  requirementId: string;
  taskId: string;
  linkType: "implementation" | "verification" | "supporting";
  createdAt: string;
}

export interface RequirementEvidenceLink {
  id: string;
  requirementId: string;
  acceptanceCriterionId: string | null;
  evidenceBundleId: string | null;
  runId: string | null;
  qualityGateResultId: string | null;
  evidenceType: string;
  verificationStatus: "pending" | "accepted" | "rejected";
  decision: string | null;
  reason: string | null;
  createdAt: string;
  createdBy: string;
}

export interface OrchestrationDecision {
  id: string;
  projectId: string;
  requirementId: string | null;
  taskId: string | null;
  decisionType: OrchestrationDecisionType;
  reason: string;
  inputStateJson: string;
  outputStateJson: string;
  actor: string;
  model: string | null;
  auditEventId: string | null;
  createdAt: string;
}

export interface ProjectState {
  project: EngineerProject;
  activeSpecification: ProjectSpecification | null;
  requirements: ProjectRequirement[];
  acceptanceCriteria: AcceptanceCriterion[];
  dependencies: RequirementDependency[];
  taskLinks: RequirementTaskLink[];
  evidenceLinks: RequirementEvidenceLink[];
  latestDecision: OrchestrationDecision | null;
}

export interface RequirementReadiness {
  requirement: ProjectRequirement;
  eligible: boolean;
  blockers: string[];
}
