import type Database from "better-sqlite3";

/** Lightweight patches for existing SQLite files (no full migration framework). */
export function applyEngineerConsoleSchemaPatches(db: Database.Database): void {
  const taskColumns = db.prepare(`PRAGMA table_info(engineering_tasks)`).all() as Array<{
    name: string;
  }>;
  if (!taskColumns.some((c) => c.name === "registered_repo_id")) {
    db.exec(`ALTER TABLE engineering_tasks ADD COLUMN registered_repo_id TEXT`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_engineering_tasks_registered_repo_id ON engineering_tasks (registered_repo_id)`,
    );
  }

  const patchAppColumns = db
    .prepare(`PRAGMA table_info(engineer_hermes_patch_applications)`)
    .all() as Array<{ name: string }>;
  if (patchAppColumns.length > 0) {
    if (!patchAppColumns.some((c) => c.name === "rolled_back_by")) {
      db.exec(`ALTER TABLE engineer_hermes_patch_applications ADD COLUMN rolled_back_by TEXT`);
    }
    if (!patchAppColumns.some((c) => c.name === "rolled_back_reason")) {
      db.exec(`ALTER TABLE engineer_hermes_patch_applications ADD COLUMN rolled_back_reason TEXT`);
    }
  }

  const commitCandidateColumns = db
    .prepare(`PRAGMA table_info(engineer_commit_candidates)`)
    .all() as Array<{ name: string }>;
  if (commitCandidateColumns.length > 0) {
    if (!commitCandidateColumns.some((c) => c.name === "local_commit_hash")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN local_commit_hash TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "local_commit_created_at")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN local_commit_created_at TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "local_commit_created_by")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN local_commit_created_by TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "local_commit_reason")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN local_commit_reason TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "local_commit_evidence_path")) {
      db.exec(
        `ALTER TABLE engineer_commit_candidates ADD COLUMN local_commit_evidence_path TEXT`,
      );
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_push_status")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_push_status TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_name")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_name TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_branch_name")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_branch_name TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_ref")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_ref TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_pushed_at")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_pushed_at TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_pushed_by")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_pushed_by TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_push_reason")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_push_reason TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_push_evidence_path")) {
      db.exec(
        `ALTER TABLE engineer_commit_candidates ADD COLUMN remote_push_evidence_path TEXT`,
      );
    }
    const prColumns = [
      ["pr_status", "TEXT"],
      ["pr_provider", "TEXT"],
      ["pr_base_branch", "TEXT"],
      ["pr_head_branch", "TEXT"],
      ["pr_url", "TEXT"],
      ["pr_number", "TEXT"],
      ["pr_created_at", "TEXT"],
      ["pr_created_by", "TEXT"],
      ["pr_create_reason", "TEXT"],
      ["pr_evidence_path", "TEXT"],
    ] as const;
    for (const [name, type] of prColumns) {
      if (!commitCandidateColumns.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN ${name} ${type}`);
      }
    }
    const mergeReadinessColumns = [
      ["merge_readiness_status", "TEXT"],
      ["merge_readiness_decision", "TEXT"],
      ["merge_readiness_reviewed_at", "TEXT"],
      ["merge_readiness_reviewed_by", "TEXT"],
      ["merge_readiness_reason", "TEXT"],
      ["merge_readiness_evidence_path", "TEXT"],
    ] as const;
    for (const [name, type] of mergeReadinessColumns) {
      if (!commitCandidateColumns.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN ${name} ${type}`);
      }
    }
    const mergeColumns = [
      ["merge_status", "TEXT"],
      ["merge_method", "TEXT"],
      ["merge_commit_sha", "TEXT"],
      ["merged_at", "TEXT"],
      ["merged_by", "TEXT"],
      ["merge_reason", "TEXT"],
      ["merge_evidence_path", "TEXT"],
    ] as const;
    for (const [name, type] of mergeColumns) {
      if (!commitCandidateColumns.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN ${name} ${type}`);
      }
    }
    const deployReadinessColumns = [
      ["deploy_readiness_status", "TEXT"],
      ["deploy_readiness_decision", "TEXT"],
      ["deploy_readiness_reviewed_at", "TEXT"],
      ["deploy_readiness_reviewed_by", "TEXT"],
      ["deploy_readiness_reason", "TEXT"],
      ["deploy_readiness_evidence_path", "TEXT"],
    ] as const;
    for (const [name, type] of deployReadinessColumns) {
      if (!commitCandidateColumns.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN ${name} ${type}`);
      }
    }
    const deploymentPacketColumns = [
      ["deployment_packet_status", "TEXT"],
      ["deployment_target_environment", "TEXT"],
      ["deployment_packet_path", "TEXT"],
      ["deployment_plan_path", "TEXT"],
      ["deployment_packet_created_at", "TEXT"],
      ["deployment_packet_created_by", "TEXT"],
      ["deployment_packet_reason", "TEXT"],
    ] as const;
    for (const [name, type] of deploymentPacketColumns) {
      if (!commitCandidateColumns.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN ${name} ${type}`);
      }
    }
    const stagingDeploymentColumns = [
      ["staging_deployment_status", "TEXT"],
      ["staging_deployment_adapter", "TEXT"],
      ["staging_deployment_started_at", "TEXT"],
      ["staging_deployment_finished_at", "TEXT"],
      ["staging_deployment_exit_code", "INTEGER"],
      ["staging_deployment_evidence_path", "TEXT"],
      ["staging_deployed_by", "TEXT"],
      ["staging_deploy_reason", "TEXT"],
    ] as const;
    for (const [name, type] of stagingDeploymentColumns) {
      if (!commitCandidateColumns.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN ${name} ${type}`);
      }
    }
    const productionReadinessColumns = [
      ["production_readiness_status", "TEXT"],
      ["production_readiness_decision", "TEXT"],
      ["production_readiness_reviewed_at", "TEXT"],
      ["production_readiness_reviewed_by", "TEXT"],
      ["production_readiness_reason", "TEXT"],
      ["production_readiness_evidence_path", "TEXT"],
    ] as const;
    for (const [name, type] of productionReadinessColumns) {
      if (!commitCandidateColumns.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN ${name} ${type}`);
      }
    }
    const productionDeploymentPacketColumns = [
      ["production_deployment_packet_status", "TEXT"],
      ["production_deployment_target_environment", "TEXT"],
      ["production_deployment_packet_path", "TEXT"],
      ["production_deployment_plan_path", "TEXT"],
      ["production_deployment_packet_created_at", "TEXT"],
      ["production_deployment_packet_created_by", "TEXT"],
      ["production_deployment_packet_reason", "TEXT"],
      ["production_deployment_rollback_notes", "TEXT"],
    ] as const;
    for (const [name, type] of productionDeploymentPacketColumns) {
      if (!commitCandidateColumns.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN ${name} ${type}`);
      }
    }
    const productionDeploymentColumns = [
      ["production_deployment_status", "TEXT"],
      ["production_deployment_adapter", "TEXT"],
      ["production_deployment_started_at", "TEXT"],
      ["production_deployment_finished_at", "TEXT"],
      ["production_deployment_exit_code", "INTEGER"],
      ["production_deployment_evidence_path", "TEXT"],
      ["production_deployed_by", "TEXT"],
      ["production_deploy_reason", "TEXT"],
    ] as const;
    for (const [name, type] of productionDeploymentColumns) {
      if (!commitCandidateColumns.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN ${name} ${type}`);
      }
    }
    const completionReadinessColumns = [
      ["completion_readiness_status", "TEXT"],
      ["completion_readiness_decision", "TEXT"],
      ["completion_readiness_reviewed_at", "TEXT"],
      ["completion_readiness_reviewed_by", "TEXT"],
      ["completion_readiness_reason", "TEXT"],
      ["completion_readiness_evidence_path", "TEXT"],
    ] as const;
    for (const [name, type] of completionReadinessColumns) {
      if (!commitCandidateColumns.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN ${name} ${type}`);
      }
    }
    const finalCloseoutColumns = [
      ["final_closeout_status", "TEXT"],
      ["final_closeout_evidence_path", "TEXT"],
      ["final_closeout_completed_at", "TEXT"],
      ["final_closeout_completed_by", "TEXT"],
      ["final_closeout_reason", "TEXT"],
      ["final_closeout_notes", "TEXT"],
    ] as const;
    for (const [name, type] of finalCloseoutColumns) {
      if (!commitCandidateColumns.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN ${name} ${type}`);
      }
    }
  }

  const workerPlanColumns = db
    .prepare(`PRAGMA table_info(engineer_worker_plans)`)
    .all() as Array<{ name: string }>;
  if (workerPlanColumns.length > 0 && !workerPlanColumns.some((c) => c.name === "iteration_number")) {
    db.exec(`ALTER TABLE engineer_worker_plans ADD COLUMN iteration_number INTEGER`);
  }

  ensureSkillOptTables(db);
}

/** SkillOpt V1 tables for existing SQLite files (CREATE IF NOT EXISTS). */
function ensureSkillOptTables(db: Database.Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS engineer_skills (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  lesson_type TEXT NOT NULL,
  model_scope TEXT NOT NULL,
  model_family TEXT,
  model_id TEXT,
  signature TEXT NOT NULL,
  title TEXT NOT NULL,
  lesson TEXT NOT NULL,
  anti_patterns_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0,
  validation_count INTEGER NOT NULL DEFAULT 0,
  rejection_count INTEGER NOT NULL DEFAULT 0,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engineer_skills_status ON engineer_skills (status);
CREATE INDEX IF NOT EXISTS idx_engineer_skills_signature ON engineer_skills (signature);
CREATE INDEX IF NOT EXISTS idx_engineer_skills_model_scope ON engineer_skills (model_scope, model_id);

CREATE TABLE IF NOT EXISTS engineer_skill_versions (
  id TEXT PRIMARY KEY NOT NULL,
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  lesson TEXT NOT NULL,
  anti_patterns_json TEXT NOT NULL DEFAULT '[]',
  change_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (skill_id) REFERENCES engineer_skills (id) ON DELETE CASCADE,
  UNIQUE (skill_id, version)
);
CREATE INDEX IF NOT EXISTS idx_engineer_skill_versions_skill_id
  ON engineer_skill_versions (skill_id, version DESC);

CREATE TABLE IF NOT EXISTS engineer_skill_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  skill_id TEXT NOT NULL,
  polarity TEXT NOT NULL,
  ref_path TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  run_id TEXT,
  task_id TEXT,
  summary TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (skill_id) REFERENCES engineer_skills (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_engineer_skill_evidence_skill_id
  ON engineer_skill_evidence (skill_id);

CREATE TABLE IF NOT EXISTS engineer_skill_validations (
  id TEXT PRIMARY KEY NOT NULL,
  skill_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (skill_id) REFERENCES engineer_skills (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_engineer_skill_validations_skill_id
  ON engineer_skill_validations (skill_id, created_at DESC);

CREATE TABLE IF NOT EXISTS engineer_skill_shadow_retrievals (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  task_id TEXT,
  model_id TEXT,
  model_family TEXT,
  query_signature TEXT NOT NULL,
  task_context_digest TEXT NOT NULL,
  matched_skill_ids_json TEXT NOT NULL DEFAULT '[]',
  would_inject TEXT NOT NULL DEFAULT '',
  actually_injected INTEGER NOT NULL DEFAULT 0,
  prompt_hash_before TEXT NOT NULL,
  prompt_hash_after TEXT NOT NULL,
  ranking_scores_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engineer_skill_shadow_retrievals_run_id
  ON engineer_skill_shadow_retrievals (run_id, created_at DESC);
`);
}
