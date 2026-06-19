import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../db/client";
import { appendAuditEvent } from "../governance/audit-ledger/append-audit-event";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../governance/audit-ledger/audit-event-types";
import type {
  AcceptanceCriterion,
  AcceptanceCriterionStatus,
  EngineerProject,
  OrchestrationDecision,
  OrchestrationDecisionType,
  ProjectOrchestrationStatus,
  ProjectRequirement,
  ProjectSpecification,
  ProjectState,
  ProjectStatus,
  RequirementDependency,
  RequirementEvidenceLink,
  RequirementPriority,
  RequirementStatus,
  RequirementTaskLink,
  VerificationType,
} from "./project-orchestration-types";

function nowIso(): string {
  return new Date().toISOString();
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  status: string;
  orchestration_status: string;
  current_requirement_id: string | null;
  active_specification_id: string | null;
  target_repo_path: string | null;
  registered_repo_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SpecificationRow {
  id: string;
  project_id: string;
  version: number;
  title: string;
  content: string;
  content_hash: string;
  status: string;
  created_at: string;
  supersedes_specification_id: string | null;
}

interface RequirementRow {
  id: string;
  project_id: string;
  specification_id: string;
  stable_key: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  blocked_reason: string | null;
}

interface CriterionRow {
  id: string;
  requirement_id: string;
  stable_key: string;
  description: string;
  verification_type: string;
  status: string;
  evidence_required: number;
}

interface DependencyRow {
  requirement_id: string;
  depends_on_requirement_id: string;
  dependency_type: string;
  created_at: string;
}

interface TaskLinkRow {
  id: string;
  requirement_id: string;
  task_id: string;
  link_type: string;
  created_at: string;
}

interface EvidenceLinkRow {
  id: string;
  requirement_id: string;
  acceptance_criterion_id: string | null;
  evidence_bundle_id: string | null;
  run_id: string | null;
  quality_gate_result_id: string | null;
  evidence_type: string;
  verification_status: string;
  decision: string | null;
  reason: string | null;
  created_at: string;
  created_by: string;
}

interface DecisionRow {
  id: string;
  project_id: string;
  requirement_id: string | null;
  task_id: string | null;
  decision_type: string;
  reason: string;
  input_state_json: string;
  output_state_json: string;
  actor: string;
  model: string | null;
  audit_event_id: string | null;
  created_at: string;
}

function mapProject(row: ProjectRow): EngineerProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as ProjectStatus,
    orchestrationStatus: row.orchestration_status as ProjectOrchestrationStatus,
    currentRequirementId: row.current_requirement_id,
    activeSpecificationId: row.active_specification_id,
    targetRepoPath: row.target_repo_path,
    registeredRepoId: row.registered_repo_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSpecification(row: SpecificationRow): ProjectSpecification {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash,
    status: row.status as ProjectSpecification["status"],
    createdAt: row.created_at,
    supersedesSpecificationId: row.supersedes_specification_id,
  };
}

function mapRequirement(row: RequirementRow): ProjectRequirement {
  return {
    id: row.id,
    projectId: row.project_id,
    specificationId: row.specification_id,
    stableKey: row.stable_key,
    title: row.title,
    description: row.description,
    status: row.status as RequirementStatus,
    priority: row.priority as RequirementPriority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    blockedReason: row.blocked_reason,
  };
}

function mapCriterion(row: CriterionRow): AcceptanceCriterion {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    stableKey: row.stable_key,
    description: row.description,
    verificationType: row.verification_type as VerificationType,
    status: row.status as AcceptanceCriterionStatus,
    evidenceRequired: row.evidence_required === 1,
  };
}

function mapDependency(row: DependencyRow): RequirementDependency {
  return {
    requirementId: row.requirement_id,
    dependsOnRequirementId: row.depends_on_requirement_id,
    dependencyType: "blocking",
    createdAt: row.created_at,
  };
}

function mapTaskLink(row: TaskLinkRow): RequirementTaskLink {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    taskId: row.task_id,
    linkType: row.link_type as RequirementTaskLink["linkType"],
    createdAt: row.created_at,
  };
}

function mapEvidenceLink(row: EvidenceLinkRow): RequirementEvidenceLink {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    acceptanceCriterionId: row.acceptance_criterion_id,
    evidenceBundleId: row.evidence_bundle_id,
    runId: row.run_id,
    qualityGateResultId: row.quality_gate_result_id,
    evidenceType: row.evidence_type,
    verificationStatus: row.verification_status as RequirementEvidenceLink["verificationStatus"],
    decision: row.decision,
    reason: row.reason,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function mapDecision(row: DecisionRow): OrchestrationDecision {
  return {
    id: row.id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    taskId: row.task_id,
    decisionType: row.decision_type as OrchestrationDecisionType,
    reason: row.reason,
    inputStateJson: row.input_state_json,
    outputStateJson: row.output_state_json,
    actor: row.actor,
    model: row.model,
    auditEventId: row.audit_event_id,
    createdAt: row.created_at,
  };
}

export class ProjectOrchestrationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ProjectOrchestrationError";
    this.code = code;
    this.status = status;
  }
}

export function createProject(input: {
  name: string;
  description?: string;
  targetRepoPath?: string | null;
  registeredRepoId?: string | null;
  createdBy?: string;
}): EngineerProject {
  const name = input.name.trim();
  if (!name) throw new ProjectOrchestrationError("PROJECT_NAME_REQUIRED", "Project name is required.");

  const id = uuidv4();
  const now = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_projects
        (id, name, description, status, orchestration_status, target_repo_path,
         registered_repo_id, created_by, created_at, updated_at)
       VALUES
        (@id, @name, @description, 'draft', 'idle', @target_repo_path,
         @registered_repo_id, @created_by, @created_at, @updated_at)`,
    )
    .run({
      id,
      name,
      description: input.description?.trim() ?? "",
      target_repo_path: input.targetRepoPath?.trim() || null,
      registered_repo_id: input.registeredRepoId?.trim() || null,
      created_by: input.createdBy?.trim() || "operator",
      created_at: now,
      updated_at: now,
    });

  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.PROJECT_CREATED,
    entityType: AUDIT_ENTITY_TYPES.PROJECT,
    entityId: id,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: input.createdBy ?? "operator",
    payload: { name },
  });

  return getProjectById(id)!;
}

export function getProjectById(id: string): EngineerProject | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_projects WHERE id = ?`)
    .get(id) as ProjectRow | undefined;
  return row ? mapProject(row) : null;
}

export function listProjects(): EngineerProject[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_projects ORDER BY updated_at DESC`)
    .all() as ProjectRow[];
  return rows.map(mapProject);
}

export function updateProject(
  id: string,
  input: Partial<{
    status: ProjectStatus;
    orchestrationStatus: ProjectOrchestrationStatus;
    currentRequirementId: string | null;
    activeSpecificationId: string | null;
    description: string;
  }>,
): EngineerProject | null {
  const existing = getProjectById(id);
  if (!existing) return null;
  const updated = {
    status: input.status ?? existing.status,
    orchestrationStatus: input.orchestrationStatus ?? existing.orchestrationStatus,
    currentRequirementId:
      input.currentRequirementId !== undefined
        ? input.currentRequirementId
        : existing.currentRequirementId,
    activeSpecificationId:
      input.activeSpecificationId !== undefined
        ? input.activeSpecificationId
        : existing.activeSpecificationId,
    description: input.description ?? existing.description,
    updatedAt: nowIso(),
  };
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_projects SET
        status = @status,
        orchestration_status = @orchestration_status,
        current_requirement_id = @current_requirement_id,
        active_specification_id = @active_specification_id,
        description = @description,
        updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      status: updated.status,
      orchestration_status: updated.orchestrationStatus,
      current_requirement_id: updated.currentRequirementId,
      active_specification_id: updated.activeSpecificationId,
      description: updated.description,
      updated_at: updated.updatedAt,
    });
  return getProjectById(id);
}

export function createSpecification(input: {
  projectId: string;
  title: string;
  content: string;
}): ProjectSpecification {
  const project = getProjectById(input.projectId);
  if (!project) throw new ProjectOrchestrationError("PROJECT_NOT_FOUND", "Project not found.", 404);
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) throw new ProjectOrchestrationError("SPEC_TITLE_REQUIRED", "Specification title is required.");
  if (!content) throw new ProjectOrchestrationError("SPEC_CONTENT_REQUIRED", "Specification content is required.");

  const db = getEngineerConsoleDb();
  const create = db.transaction(() => {
    const previous = getActiveSpecificationForProject(input.projectId);
    const latest = db
      .prepare(`SELECT MAX(version) AS version FROM engineer_project_specifications WHERE project_id = ?`)
      .get(input.projectId) as { version: number | null };
    const version = (latest.version ?? 0) + 1;
    const id = uuidv4();
    db.prepare(
      `INSERT INTO engineer_project_specifications
        (id, project_id, version, title, content, content_hash, status, created_at, supersedes_specification_id)
       VALUES
        (@id, @project_id, @version, @title, @content, @content_hash, 'active', @created_at, @supersedes)`,
    ).run({
      id,
      project_id: input.projectId,
      version,
      title,
      content,
      content_hash: hashContent(content),
      created_at: nowIso(),
      supersedes: previous?.id ?? null,
    });
    if (previous) {
      db.prepare(`UPDATE engineer_project_specifications SET status = 'superseded' WHERE id = ?`).run(previous.id);
    }
    db.prepare(
      `UPDATE engineer_projects SET active_specification_id = @active_specification_id, updated_at = @updated_at WHERE id = @id`,
    ).run({
      id: input.projectId,
      active_specification_id: id,
      updated_at: nowIso(),
    });
    return id;
  });
  const specificationId = create();
  const specification = getSpecificationById(specificationId)!;
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.PROJECT_SPECIFICATION_CREATED,
    entityType: AUDIT_ENTITY_TYPES.PROJECT,
    entityId: input.projectId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    payload: {
      specificationId,
      version: specification.version,
      contentHash: specification.contentHash.slice(0, 12),
    },
  });
  return specification;
}

export function getSpecificationById(id: string): ProjectSpecification | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_project_specifications WHERE id = ?`)
    .get(id) as SpecificationRow | undefined;
  return row ? mapSpecification(row) : null;
}

export function getActiveSpecificationForProject(projectId: string): ProjectSpecification | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_project_specifications
       WHERE project_id = ? AND status = 'active'
       ORDER BY version DESC LIMIT 1`,
    )
    .get(projectId) as SpecificationRow | undefined;
  return row ? mapSpecification(row) : null;
}

export function listSpecificationsForProject(projectId: string): ProjectSpecification[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_project_specifications WHERE project_id = ? ORDER BY version DESC`)
    .all(projectId) as SpecificationRow[];
  return rows.map(mapSpecification);
}

export function createRequirement(input: {
  projectId: string;
  specificationId?: string;
  stableKey: string;
  title: string;
  description?: string;
  priority?: RequirementPriority;
  acceptanceCriteria?: Array<{
    stableKey: string;
    description: string;
    verificationType: VerificationType;
    evidenceRequired?: boolean;
  }>;
}): ProjectRequirement {
  const project = getProjectById(input.projectId);
  if (!project) throw new ProjectOrchestrationError("PROJECT_NOT_FOUND", "Project not found.", 404);
  const specificationId = input.specificationId ?? project.activeSpecificationId;
  if (!specificationId) {
    throw new ProjectOrchestrationError("SPECIFICATION_REQUIRED", "An active specification is required.");
  }
  const stableKey = input.stableKey.trim();
  if (!stableKey) throw new ProjectOrchestrationError("STABLE_KEY_REQUIRED", "Requirement stable key is required.");
  const title = input.title.trim();
  if (!title) throw new ProjectOrchestrationError("REQUIREMENT_TITLE_REQUIRED", "Requirement title is required.");

  const id = uuidv4();
  const now = nowIso();
  const db = getEngineerConsoleDb();
  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO engineer_requirements
        (id, project_id, specification_id, stable_key, title, description, status,
         priority, created_at, updated_at)
       VALUES
        (@id, @project_id, @specification_id, @stable_key, @title, @description, 'pending',
         @priority, @created_at, @updated_at)`,
    ).run({
      id,
      project_id: input.projectId,
      specification_id: specificationId,
      stable_key: stableKey,
      title,
      description: input.description?.trim() ?? "",
      priority: input.priority ?? "normal",
      created_at: now,
      updated_at: now,
    });
    for (const criterion of input.acceptanceCriteria ?? []) {
      addAcceptanceCriterion({
        requirementId: id,
        stableKey: criterion.stableKey,
        description: criterion.description,
        verificationType: criterion.verificationType,
        evidenceRequired: criterion.evidenceRequired ?? true,
      });
    }
  });
  create();
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REQUIREMENT_CREATED,
    entityType: AUDIT_ENTITY_TYPES.REQUIREMENT,
    entityId: id,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    payload: { projectId: input.projectId, stableKey },
  });
  return getRequirementById(id)!;
}

export function getRequirementById(id: string): ProjectRequirement | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_requirements WHERE id = ?`)
    .get(id) as RequirementRow | undefined;
  return row ? mapRequirement(row) : null;
}

export function listRequirementsForProject(projectId: string): ProjectRequirement[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_requirements WHERE project_id = ? ORDER BY stable_key ASC`)
    .all(projectId) as RequirementRow[];
  return rows.map(mapRequirement);
}

export function updateRequirement(
  id: string,
  input: Partial<{
    status: RequirementStatus;
    priority: RequirementPriority;
    blockedReason: string | null;
    completedAt: string | null;
    title: string;
    description: string;
  }>,
): ProjectRequirement | null {
  const existing = getRequirementById(id);
  if (!existing) return null;
  const status = input.status ?? existing.status;
  const completedAt =
    input.completedAt !== undefined
      ? input.completedAt
      : status === "completed" && !existing.completedAt
        ? nowIso()
        : status !== "completed"
          ? null
          : existing.completedAt;
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_requirements SET
        title = @title,
        description = @description,
        status = @status,
        priority = @priority,
        blocked_reason = @blocked_reason,
        completed_at = @completed_at,
        updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      status,
      priority: input.priority ?? existing.priority,
      blocked_reason:
        input.blockedReason !== undefined ? input.blockedReason : existing.blockedReason,
      completed_at: completedAt,
      updated_at: nowIso(),
    });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REQUIREMENT_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.REQUIREMENT,
    entityId: id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: { status },
  });
  return getRequirementById(id);
}

export function addAcceptanceCriterion(input: {
  requirementId: string;
  stableKey: string;
  description: string;
  verificationType: VerificationType;
  evidenceRequired?: boolean;
}): AcceptanceCriterion {
  const id = uuidv4();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_acceptance_criteria
        (id, requirement_id, stable_key, description, verification_type, status, evidence_required)
       VALUES
        (@id, @requirement_id, @stable_key, @description, @verification_type, 'pending', @evidence_required)`,
    )
    .run({
      id,
      requirement_id: input.requirementId,
      stable_key: input.stableKey.trim(),
      description: input.description.trim(),
      verification_type: input.verificationType,
      evidence_required: input.evidenceRequired === false ? 0 : 1,
    });
  return listAcceptanceCriteriaForRequirement(input.requirementId).find((c) => c.id === id)!;
}

export function updateAcceptanceCriterionStatus(
  id: string,
  status: AcceptanceCriterionStatus,
): AcceptanceCriterion | null {
  getEngineerConsoleDb()
    .prepare(`UPDATE engineer_acceptance_criteria SET status = @status WHERE id = @id`)
    .run({ id, status });
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_acceptance_criteria WHERE id = ?`)
    .get(id) as CriterionRow | undefined;
  return row ? mapCriterion(row) : null;
}

export function listAcceptanceCriteriaForRequirement(requirementId: string): AcceptanceCriterion[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_acceptance_criteria WHERE requirement_id = ? ORDER BY stable_key ASC`)
    .all(requirementId) as CriterionRow[];
  return rows.map(mapCriterion);
}

export function listAcceptanceCriteriaForProject(projectId: string): AcceptanceCriterion[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT c.* FROM engineer_acceptance_criteria c
       JOIN engineer_requirements r ON r.id = c.requirement_id
       WHERE r.project_id = ?
       ORDER BY r.stable_key ASC, c.stable_key ASC`,
    )
    .all(projectId) as CriterionRow[];
  return rows.map(mapCriterion);
}

export function addRequirementDependency(input: {
  requirementId: string;
  dependsOnRequirementId: string;
  dependencyType?: "blocking";
}): RequirementDependency {
  if (input.requirementId === input.dependsOnRequirementId) {
    throw new ProjectOrchestrationError("SELF_DEPENDENCY", "Requirement cannot depend on itself.");
  }
  const createdAt = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `INSERT OR IGNORE INTO engineer_requirement_dependencies
        (requirement_id, depends_on_requirement_id, dependency_type, created_at)
       VALUES (@requirement_id, @depends_on_requirement_id, @dependency_type, @created_at)`,
    )
    .run({
      requirement_id: input.requirementId,
      depends_on_requirement_id: input.dependsOnRequirementId,
      dependency_type: input.dependencyType ?? "blocking",
      created_at: createdAt,
    });
  return listDependenciesForProject(getRequirementById(input.requirementId)!.projectId).find(
    (dep) =>
      dep.requirementId === input.requirementId &&
      dep.dependsOnRequirementId === input.dependsOnRequirementId,
  )!;
}

export function listDependenciesForProject(projectId: string): RequirementDependency[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT d.* FROM engineer_requirement_dependencies d
       JOIN engineer_requirements r ON r.id = d.requirement_id
       WHERE r.project_id = ?
       ORDER BY d.created_at ASC`,
    )
    .all(projectId) as DependencyRow[];
  return rows.map(mapDependency);
}

export function linkRequirementTask(input: {
  requirementId: string;
  taskId: string;
  linkType?: RequirementTaskLink["linkType"];
}): RequirementTaskLink {
  const id = uuidv4();
  const createdAt = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `INSERT OR IGNORE INTO engineer_requirement_task_links
        (id, requirement_id, task_id, link_type, created_at)
       VALUES (@id, @requirement_id, @task_id, @link_type, @created_at)`,
    )
    .run({
      id,
      requirement_id: input.requirementId,
      task_id: input.taskId,
      link_type: input.linkType ?? "implementation",
      created_at: createdAt,
    });
  return listTaskLinksForRequirement(input.requirementId).find((link) => link.taskId === input.taskId)!;
}

export function listTaskLinksForRequirement(requirementId: string): RequirementTaskLink[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_requirement_task_links WHERE requirement_id = ? ORDER BY created_at ASC`)
    .all(requirementId) as TaskLinkRow[];
  return rows.map(mapTaskLink);
}

export function listTaskLinksForProject(projectId: string): RequirementTaskLink[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT l.* FROM engineer_requirement_task_links l
       JOIN engineer_requirements r ON r.id = l.requirement_id
       WHERE r.project_id = ?
       ORDER BY l.created_at ASC`,
    )
    .all(projectId) as TaskLinkRow[];
  return rows.map(mapTaskLink);
}

export function linkRequirementEvidence(input: {
  requirementId: string;
  acceptanceCriterionId?: string | null;
  evidenceBundleId?: string | null;
  runId?: string | null;
  qualityGateResultId?: string | null;
  evidenceType?: string;
  verificationStatus?: "pending" | "accepted" | "rejected";
  decision?: string | null;
  reason?: string | null;
  createdBy?: string;
}): RequirementEvidenceLink {
  const id = uuidv4();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_requirement_evidence_links
        (id, requirement_id, acceptance_criterion_id, evidence_bundle_id, run_id,
         quality_gate_result_id, evidence_type, verification_status, decision, reason,
         created_at, created_by)
       VALUES
        (@id, @requirement_id, @acceptance_criterion_id, @evidence_bundle_id, @run_id,
         @quality_gate_result_id, @evidence_type, @verification_status, @decision, @reason,
         @created_at, @created_by)`,
    )
    .run({
      id,
      requirement_id: input.requirementId,
      acceptance_criterion_id: input.acceptanceCriterionId ?? null,
      evidence_bundle_id: input.evidenceBundleId ?? null,
      run_id: input.runId ?? null,
      quality_gate_result_id: input.qualityGateResultId ?? null,
      evidence_type: input.evidenceType ?? "evidence_bundle",
      verification_status: input.verificationStatus ?? "pending",
      decision: input.decision ?? null,
      reason: input.reason ?? null,
      created_at: nowIso(),
      created_by: input.createdBy ?? "operator",
    });
  return listEvidenceLinksForRequirement(input.requirementId).find((link) => link.id === id)!;
}

export function listEvidenceLinksForRequirement(requirementId: string): RequirementEvidenceLink[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_requirement_evidence_links WHERE requirement_id = ? ORDER BY created_at ASC`)
    .all(requirementId) as EvidenceLinkRow[];
  return rows.map(mapEvidenceLink);
}

export function listEvidenceLinksForProject(projectId: string): RequirementEvidenceLink[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT l.* FROM engineer_requirement_evidence_links l
       JOIN engineer_requirements r ON r.id = l.requirement_id
       WHERE r.project_id = ?
       ORDER BY l.created_at ASC`,
    )
    .all(projectId) as EvidenceLinkRow[];
  return rows.map(mapEvidenceLink);
}

export function recordOrchestrationDecision(input: {
  projectId: string;
  requirementId?: string | null;
  taskId?: string | null;
  decisionType: OrchestrationDecisionType;
  reason: string;
  inputState?: unknown;
  outputState?: unknown;
  actor?: string;
  model?: string | null;
}): OrchestrationDecision {
  const id = uuidv4();
  const audit = appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ORCHESTRATION_DECISION_RECORDED,
    entityType: AUDIT_ENTITY_TYPES.PROJECT,
    entityId: input.projectId,
    actorType: input.actor === "human" ? AUDIT_ACTOR_TYPES.HUMAN : AUDIT_ACTOR_TYPES.SYSTEM,
    actorLabel: input.actor ?? "vera",
    taskId: input.taskId ?? undefined,
    payload: {
      decisionId: id,
      decisionType: input.decisionType,
      requirementId: input.requirementId,
      reason: input.reason,
    },
  });
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_orchestration_decisions
        (id, project_id, requirement_id, task_id, decision_type, reason,
         input_state_json, output_state_json, actor, model, audit_event_id, created_at)
       VALUES
        (@id, @project_id, @requirement_id, @task_id, @decision_type, @reason,
         @input_state_json, @output_state_json, @actor, @model, @audit_event_id, @created_at)`,
    )
    .run({
      id,
      project_id: input.projectId,
      requirement_id: input.requirementId ?? null,
      task_id: input.taskId ?? null,
      decision_type: input.decisionType,
      reason: input.reason,
      input_state_json: JSON.stringify(input.inputState ?? {}),
      output_state_json: JSON.stringify(input.outputState ?? {}),
      actor: input.actor ?? "vera",
      model: input.model ?? null,
      audit_event_id: audit.id,
      created_at: nowIso(),
    });
  return getOrchestrationDecisionById(id)!;
}

export function getOrchestrationDecisionById(id: string): OrchestrationDecision | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_orchestration_decisions WHERE id = ?`)
    .get(id) as DecisionRow | undefined;
  return row ? mapDecision(row) : null;
}

export function listOrchestrationDecisions(projectId: string): OrchestrationDecision[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_orchestration_decisions
       WHERE project_id = ?
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(projectId) as DecisionRow[];
  return rows.map(mapDecision);
}

export function getLatestOrchestrationDecision(projectId: string): OrchestrationDecision | null {
  return listOrchestrationDecisions(projectId)[0] ?? null;
}

export function loadProjectState(projectId: string): ProjectState {
  const project = getProjectById(projectId);
  if (!project) throw new ProjectOrchestrationError("PROJECT_NOT_FOUND", "Project not found.", 404);
  return {
    project,
    activeSpecification: project.activeSpecificationId
      ? getSpecificationById(project.activeSpecificationId)
      : getActiveSpecificationForProject(projectId),
    requirements: listRequirementsForProject(projectId),
    acceptanceCriteria: listAcceptanceCriteriaForProject(projectId),
    dependencies: listDependenciesForProject(projectId),
    taskLinks: listTaskLinksForProject(projectId),
    evidenceLinks: listEvidenceLinksForProject(projectId),
    latestDecision: getLatestOrchestrationDecision(projectId),
  };
}
