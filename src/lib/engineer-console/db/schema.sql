-- Engineer Console MVP schema

-- Phase 5A: registered repos (before tasks for optional FK-less linking)
CREATE TABLE IF NOT EXISTS engineer_registered_repos (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verification_message TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engineer_registered_repos_verification
  ON engineer_registered_repos (verification_status);

CREATE TABLE IF NOT EXISTS engineer_package_scripts (
  id TEXT PRIMARY KEY NOT NULL,
  repo_id TEXT NOT NULL,
  script_name TEXT NOT NULL,
  command TEXT NOT NULL,
  source_file TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES engineer_registered_repos (id) ON DELETE CASCADE,
  UNIQUE (repo_id, script_name, source_file)
);

CREATE INDEX IF NOT EXISTS idx_engineer_package_scripts_repo_id
  ON engineer_package_scripts (repo_id);

CREATE TABLE IF NOT EXISTS engineer_test_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  repo_id TEXT NOT NULL UNIQUE,
  runner TEXT NOT NULL,
  detect_command TEXT,
  confidence TEXT NOT NULL,
  signals_json TEXT NOT NULL DEFAULT '{}',
  detected_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES engineer_registered_repos (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_test_profiles_repo_id
  ON engineer_test_profiles (repo_id);

CREATE TABLE IF NOT EXISTS engineering_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_repo_path TEXT NOT NULL,
  registered_repo_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  priority TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engineering_tasks_registered_repo_id
  ON engineering_tasks (registered_repo_id);

CREATE INDEX IF NOT EXISTS idx_engineering_tasks_status ON engineering_tasks (status);
CREATE INDEX IF NOT EXISTS idx_engineering_tasks_updated_at ON engineering_tasks (updated_at);

CREATE TABLE IF NOT EXISTS engineering_runs (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  branch_name TEXT,
  current_step TEXT,
  model_role TEXT NOT NULL DEFAULT 'engineer',
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  agent_message TEXT,
  risk_level TEXT,
  governance_notes TEXT,
  FOREIGN KEY (task_id) REFERENCES engineering_tasks (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineering_runs_task_id ON engineering_runs (task_id);
CREATE INDEX IF NOT EXISTS idx_engineering_runs_status ON engineering_runs (status);

CREATE TABLE IF NOT EXISTS quality_gate_results (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  command TEXT NOT NULL,
  stdout TEXT NOT NULL DEFAULT '',
  stderr TEXT NOT NULL DEFAULT '',
  exit_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quality_gate_results_run_id ON quality_gate_results (run_id);

CREATE TABLE IF NOT EXISTS approval_reports (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS engineer_worker_plans (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  validation_status TEXT NOT NULL DEFAULT 'pending',
  validation_errors_json TEXT NOT NULL DEFAULT '[]',
  validation_warnings_json TEXT NOT NULL DEFAULT '[]',
  execution_status TEXT NOT NULL DEFAULT 'pending',
  execution_errors_json TEXT NOT NULL DEFAULT '[]',
  executed_operations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_worker_plans_run_id ON engineer_worker_plans (run_id);

CREATE TABLE IF NOT EXISTS engineer_worker_operations (
  id TEXT PRIMARY KEY NOT NULL,
  worker_plan_id TEXT NOT NULL,
  operation_index INTEGER NOT NULL,
  operation_type TEXT NOT NULL,
  path TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (worker_plan_id) REFERENCES engineer_worker_plans (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_worker_operations_plan_id
  ON engineer_worker_operations (worker_plan_id);

CREATE TABLE IF NOT EXISTS engineer_worker_plan_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  raw_response TEXT NOT NULL,
  parsed_plan_json TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending',
  validation_errors_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_worker_plan_drafts_run_id
  ON engineer_worker_plan_drafts (run_id);

-- Phase 6: Hermes worker handoff (Engineering Console governed; export-only by default)
CREATE TABLE IF NOT EXISTS engineer_hermes_worker_dispatches (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  worker_plan_id TEXT,
  worker_backend TEXT NOT NULL DEFAULT 'hermes',
  status TEXT NOT NULL DEFAULT 'prepared',
  packet_hash TEXT NOT NULL,
  packet_json TEXT NOT NULL,
  export_path TEXT,
  evidence_placeholder_path TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  dispatched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES engineering_tasks (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_hermes_worker_dispatches_run_id
  ON engineer_hermes_worker_dispatches (run_id);

-- Phase 9: Hermes patch application (Engineering Console only; one apply per dispatch)
CREATE TABLE IF NOT EXISTS engineer_hermes_patch_applications (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  dispatch_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'applied',
  packet_hash TEXT NOT NULL,
  patch_hash TEXT NOT NULL,
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  rollback_artifact_path TEXT NOT NULL,
  apply_result_path TEXT NOT NULL,
  applied_by TEXT NOT NULL,
  apply_reason TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  rolled_back_at TEXT,
  rolled_back_by TEXT,
  rolled_back_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE,
  FOREIGN KEY (dispatch_id) REFERENCES engineer_hermes_worker_dispatches (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_hermes_patch_applications_run_id
  ON engineer_hermes_patch_applications (run_id);

-- Phase 10: post-apply Hermes quality gate evidence (Engineering Console only)
CREATE TABLE IF NOT EXISTS engineer_hermes_quality_gate_runs (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  patch_application_id TEXT NOT NULL,
  dispatch_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  gate_id TEXT NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL,
  exit_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  timed_out INTEGER NOT NULL DEFAULT 0,
  result_artifact_path TEXT NOT NULL,
  stdout_artifact_path TEXT NOT NULL,
  stderr_artifact_path TEXT NOT NULL,
  operator_by TEXT NOT NULL,
  operator_reason TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE,
  FOREIGN KEY (patch_application_id) REFERENCES engineer_hermes_patch_applications (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_hermes_quality_gate_runs_run_id
  ON engineer_hermes_quality_gate_runs (run_id);

CREATE INDEX IF NOT EXISTS idx_engineer_hermes_quality_gate_runs_batch_id
  ON engineer_hermes_quality_gate_runs (batch_id);

-- Phase 11: engineering review sign-off (append-only history; Console-owned)
CREATE TABLE IF NOT EXISTS engineer_run_review_signoffs (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_snapshot_hash TEXT NOT NULL,
  evidence_summary_json TEXT NOT NULL,
  quality_gate_summary_json TEXT NOT NULL,
  patch_application_summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_run_review_signoffs_run_id
  ON engineer_run_review_signoffs (run_id, created_at DESC);

-- Phase 12: governed commit/PR candidate artifacts (no git commit/push/merge/deploy)
CREATE TABLE IF NOT EXISTS engineer_commit_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared',
  branch_name TEXT NOT NULL,
  commit_message TEXT NOT NULL,
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  evidence_snapshot_hash TEXT NOT NULL,
  signoff_id TEXT NOT NULL,
  commit_packet_path TEXT NOT NULL,
  pr_draft_path TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  local_commit_hash TEXT,
  local_commit_created_at TEXT,
  local_commit_created_by TEXT,
  local_commit_reason TEXT,
  local_commit_evidence_path TEXT,
  remote_push_status TEXT,
  remote_name TEXT,
  remote_branch_name TEXT,
  remote_ref TEXT,
  remote_pushed_at TEXT,
  remote_pushed_by TEXT,
  remote_push_reason TEXT,
  remote_push_evidence_path TEXT,
  pr_status TEXT,
  pr_provider TEXT,
  pr_base_branch TEXT,
  pr_head_branch TEXT,
  pr_url TEXT,
  pr_number TEXT,
  pr_created_at TEXT,
  pr_created_by TEXT,
  pr_create_reason TEXT,
  pr_evidence_path TEXT,
  merge_readiness_status TEXT,
  merge_readiness_decision TEXT,
  merge_readiness_reviewed_at TEXT,
  merge_readiness_reviewed_by TEXT,
  merge_readiness_reason TEXT,
  merge_readiness_evidence_path TEXT,
  merge_status TEXT,
  merge_method TEXT,
  merge_commit_sha TEXT,
  merged_at TEXT,
  merged_by TEXT,
  merge_reason TEXT,
  merge_evidence_path TEXT,
  deploy_readiness_status TEXT,
  deploy_readiness_decision TEXT,
  deploy_readiness_reviewed_at TEXT,
  deploy_readiness_reviewed_by TEXT,
  deploy_readiness_reason TEXT,
  deploy_readiness_evidence_path TEXT,
  not_committed INTEGER NOT NULL DEFAULT 1,
  not_pushed INTEGER NOT NULL DEFAULT 1,
  not_merged INTEGER NOT NULL DEFAULT 1,
  not_deployed INTEGER NOT NULL DEFAULT 1,
  not_complete INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE,
  FOREIGN KEY (signoff_id) REFERENCES engineer_run_review_signoffs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_commit_candidates_run_id
  ON engineer_commit_candidates (run_id, created_at DESC);

-- Phase G1: append-only tamper-evident audit chain (no UPDATE/DELETE by convention)
CREATE TABLE IF NOT EXISTS engineer_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  chain_scope TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_label TEXT,
  task_id TEXT,
  run_id TEXT,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  previous_event_hash TEXT,
  chain_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engineer_audit_events_chain_scope_created_at
  ON engineer_audit_events (chain_scope, created_at);

CREATE INDEX IF NOT EXISTS idx_engineer_audit_events_run_id_created_at
  ON engineer_audit_events (run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_engineer_audit_events_task_id_created_at
  ON engineer_audit_events (task_id, created_at);

-- Phase G2: redacted run evidence bundles (one row per run, refreshable until final)
CREATE TABLE IF NOT EXISTS engineer_run_evidence_bundles (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  task_id TEXT,
  registered_repo_id TEXT,
  bundle_hash TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  redaction_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_run_evidence_bundles_task_id
  ON engineer_run_evidence_bundles (task_id);

-- Phase G3: structured human decision records per approval action
CREATE TABLE IF NOT EXISTS engineer_decision_records (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  task_id TEXT,
  decision TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_label TEXT,
  rationale TEXT,
  approval_report_id TEXT,
  evidence_bundle_id TEXT,
  evidence_bundle_hash TEXT,
  risk_level TEXT,
  can_approve INTEGER NOT NULL DEFAULT 0,
  quality_gate_state TEXT,
  audit_event_id TEXT,
  audit_chain_hash TEXT,
  decision_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_decision_records_run_id_created_at
  ON engineer_decision_records (run_id, created_at);

-- Phase 5B: read-only file metadata index for registered repos
CREATE TABLE IF NOT EXISTS engineer_file_index_runs (
  id TEXT PRIMARY KEY NOT NULL,
  repo_id TEXT NOT NULL,
  status TEXT NOT NULL,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  indexed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  skipped_summary_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT,
  FOREIGN KEY (repo_id) REFERENCES engineer_registered_repos (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_file_index_runs_repo_id_started_at
  ON engineer_file_index_runs (repo_id, started_at);

CREATE TABLE IF NOT EXISTS engineer_indexed_files (
  id TEXT PRIMARY KEY NOT NULL,
  repo_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  extension TEXT,
  language TEXT,
  size_bytes INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  is_binary INTEGER NOT NULL DEFAULT 0,
  is_generated INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES engineer_registered_repos (id) ON DELETE CASCADE,
  UNIQUE (repo_id, relative_path)
);

CREATE INDEX IF NOT EXISTS idx_engineer_indexed_files_repo_id_language
  ON engineer_indexed_files (repo_id, language);

CREATE INDEX IF NOT EXISTS idx_engineer_indexed_files_repo_id_extension
  ON engineer_indexed_files (repo_id, extension);

-- Phase 5C: symbol and bounded code chunk index (linked to indexed files)
CREATE TABLE IF NOT EXISTS engineer_code_index_runs (
  id TEXT PRIMARY KEY NOT NULL,
  repo_id TEXT NOT NULL,
  status TEXT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  symbol_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT,
  FOREIGN KEY (repo_id) REFERENCES engineer_registered_repos (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_code_index_runs_repo_id_started_at
  ON engineer_code_index_runs (repo_id, started_at);

CREATE TABLE IF NOT EXISTS engineer_symbols (
  id TEXT PRIMARY KEY NOT NULL,
  repo_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  language TEXT,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  exported INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES engineer_registered_repos (id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES engineer_indexed_files (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_symbols_repo_id_name
  ON engineer_symbols (repo_id, name);

CREATE INDEX IF NOT EXISTS idx_engineer_symbols_repo_id_kind
  ON engineer_symbols (repo_id, kind);

CREATE INDEX IF NOT EXISTS idx_engineer_symbols_file_id
  ON engineer_symbols (file_id);

CREATE TABLE IF NOT EXISTS engineer_code_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  repo_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  language TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  content_preview TEXT NOT NULL DEFAULT '',
  token_estimate INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES engineer_registered_repos (id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES engineer_indexed_files (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_code_chunks_repo_id_language
  ON engineer_code_chunks (repo_id, language);

CREATE INDEX IF NOT EXISTS idx_engineer_code_chunks_file_id
  ON engineer_code_chunks (file_id);

-- Phase G4: persisted replay verification results per run
CREATE TABLE IF NOT EXISTS engineer_replay_verifications (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_replay_verifications_run_id_created_at
  ON engineer_replay_verifications (run_id, created_at);

-- Phase G5: versioned governance policies and evaluation results
CREATE TABLE IF NOT EXISTS engineer_governance_policies (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engineer_governance_policies_active
  ON engineer_governance_policies (is_active, created_at);

CREATE TABLE IF NOT EXISTS engineer_governance_policy_results (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  policy_id TEXT,
  policy_version TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_governance_policy_results_run_id_created_at
  ON engineer_governance_policy_results (run_id, created_at);

-- Phase 5E: compatibility analysis (API surfaces, cross-repo links)
CREATE TABLE IF NOT EXISTS engineer_api_surfaces (
  id TEXT PRIMARY KEY NOT NULL,
  repo_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  surface_type TEXT NOT NULL,
  method TEXT,
  route_path TEXT,
  name TEXT,
  language TEXT,
  line_start INTEGER,
  line_end INTEGER,
  source_hash TEXT,
  confidence TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES engineer_registered_repos (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_api_surfaces_repo_id_type
  ON engineer_api_surfaces (repo_id, surface_type);

CREATE TABLE IF NOT EXISTS engineer_cross_repo_links (
  id TEXT PRIMARY KEY NOT NULL,
  source_repo_id TEXT NOT NULL,
  target_repo_id TEXT NOT NULL,
  source_relative_path TEXT,
  target_relative_path TEXT,
  link_type TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence TEXT NOT NULL,
  summary TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  detected_at TEXT NOT NULL,
  FOREIGN KEY (source_repo_id) REFERENCES engineer_registered_repos (id) ON DELETE CASCADE,
  FOREIGN KEY (target_repo_id) REFERENCES engineer_registered_repos (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_cross_repo_links_source_target
  ON engineer_cross_repo_links (source_repo_id, target_repo_id, status);

CREATE TABLE IF NOT EXISTS engineer_compatibility_analysis_runs (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  repo_count INTEGER NOT NULL DEFAULT 0,
  surface_count INTEGER NOT NULL DEFAULT 0,
  link_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  breaking_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_engineer_compatibility_analysis_runs_started_at
  ON engineer_compatibility_analysis_runs (started_at DESC);

-- Phase G6: human review stages per run
CREATE TABLE IF NOT EXISTS engineer_review_stages (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  task_id TEXT,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  reviewer_actor_type TEXT,
  reviewer_actor_label TEXT,
  reviewer_notes TEXT,
  evidence_bundle_id TEXT,
  evidence_bundle_hash TEXT,
  policy_result_id TEXT,
  audit_event_id TEXT,
  audit_chain_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_review_stages_run_id_stage
  ON engineer_review_stages (run_id, stage);

CREATE INDEX IF NOT EXISTS idx_engineer_review_stages_run_id_status
  ON engineer_review_stages (run_id, status);

-- Phase 6: approval-gated commit + PR creation
CREATE TABLE IF NOT EXISTS engineer_pr_requests (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  task_id TEXT,
  registered_repo_id TEXT,
  branch_name TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  commit_sha TEXT,
  commit_message TEXT,
  pr_url TEXT,
  pr_number TEXT,
  status TEXT NOT NULL,
  readiness_status TEXT NOT NULL,
  readiness_json TEXT NOT NULL,
  evidence_bundle_id TEXT,
  evidence_bundle_hash TEXT,
  policy_result_id TEXT,
  replay_verification_id TEXT,
  actor_type TEXT NOT NULL,
  actor_label TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_pr_requests_run_id_created_at
  ON engineer_pr_requests (run_id, created_at DESC);

-- Phase 7: approval-gated PR merge controls
CREATE TABLE IF NOT EXISTS engineer_merge_requests (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  pr_request_id TEXT NOT NULL,
  task_id TEXT,
  registered_repo_id TEXT,
  pr_url TEXT,
  pr_number TEXT,
  base_branch TEXT,
  head_branch TEXT,
  commit_sha TEXT,
  merge_sha TEXT,
  status TEXT NOT NULL,
  readiness_status TEXT NOT NULL,
  readiness_json TEXT NOT NULL,
  evidence_bundle_id TEXT,
  evidence_bundle_hash TEXT,
  policy_result_id TEXT,
  replay_verification_id TEXT,
  actor_type TEXT NOT NULL,
  actor_label TEXT,
  rationale TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_merge_requests_run_id_created_at
  ON engineer_merge_requests (run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engineer_merge_requests_pr_request_id
  ON engineer_merge_requests (pr_request_id);

-- Phase 8A: deployment readiness gates (no deploy execution)
CREATE TABLE IF NOT EXISTS engineer_deployment_environments (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  environment_type TEXT NOT NULL,
  description TEXT,
  required_branch TEXT,
  deployment_strategy TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engineer_deployment_environments_active
  ON engineer_deployment_environments (is_active, name);

CREATE TABLE IF NOT EXISTS engineer_deployment_readiness_checks (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  merge_request_id TEXT,
  environment_id TEXT NOT NULL,
  status TEXT NOT NULL,
  readiness_json TEXT NOT NULL,
  evidence_bundle_id TEXT,
  evidence_bundle_hash TEXT,
  policy_result_id TEXT,
  replay_verification_id TEXT,
  merge_sha TEXT,
  actor_type TEXT NOT NULL,
  actor_label TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE,
  FOREIGN KEY (environment_id) REFERENCES engineer_deployment_environments (id)
);

CREATE INDEX IF NOT EXISTS idx_engineer_deployment_readiness_checks_run_env
  ON engineer_deployment_readiness_checks (run_id, environment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS engineer_deployment_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  readiness_check_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_label TEXT,
  rationale TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE,
  FOREIGN KEY (readiness_check_id) REFERENCES engineer_deployment_readiness_checks (id),
  FOREIGN KEY (environment_id) REFERENCES engineer_deployment_environments (id)
);

CREATE INDEX IF NOT EXISTS idx_engineer_deployment_approvals_run_id
  ON engineer_deployment_approvals (run_id, created_at DESC);

-- Phase 8B: controlled deployment execution (profile-gated, admin-only)
CREATE TABLE IF NOT EXISTS engineer_deployment_executions (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  deployment_approval_id TEXT NOT NULL,
  readiness_check_id TEXT,
  environment_id TEXT,
  merge_request_id TEXT,
  deployment_profile TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  actor_type TEXT NOT NULL,
  actor_label TEXT,
  command_label TEXT,
  exit_code INTEGER,
  output_summary TEXT,
  output_hash TEXT,
  error_message TEXT,
  evidence_bundle_id TEXT,
  evidence_bundle_hash TEXT,
  audit_event_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE,
  FOREIGN KEY (deployment_approval_id) REFERENCES engineer_deployment_approvals (id)
);

CREATE INDEX IF NOT EXISTS idx_engineer_deployment_executions_run_id
  ON engineer_deployment_executions (run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engineer_deployment_executions_approval_id
  ON engineer_deployment_executions (deployment_approval_id);

-- Phase 8C: post-deployment HTTP health checks (read-only, profile-gated)
CREATE TABLE IF NOT EXISTS engineer_deployment_health_checks (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  deployment_execution_id TEXT NOT NULL,
  environment_id TEXT,
  health_profile TEXT NOT NULL,
  status TEXT NOT NULL,
  checked_url TEXT,
  response_status INTEGER,
  response_time_ms INTEGER,
  output_summary TEXT,
  output_hash TEXT,
  error_message TEXT,
  actor_type TEXT NOT NULL,
  actor_label TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE,
  FOREIGN KEY (deployment_execution_id) REFERENCES engineer_deployment_executions (id)
);

CREATE INDEX IF NOT EXISTS idx_engineer_deployment_health_checks_run_id
  ON engineer_deployment_health_checks (run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engineer_deployment_health_checks_execution_id
  ON engineer_deployment_health_checks (deployment_execution_id, created_at DESC);

-- Phase 8D: deployment health policy interpretation (governance metadata only)
CREATE TABLE IF NOT EXISTS engineer_deployment_health_policy_results (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  deployment_execution_id TEXT,
  health_check_id TEXT,
  environment_id TEXT,
  status TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_label TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_deployment_health_policy_results_run_id
  ON engineer_deployment_health_policy_results (run_id, created_at DESC);

-- Phase 8E: advisory release completion checklist (metadata only)
CREATE TABLE IF NOT EXISTS engineer_release_checklists (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  checklist_json TEXT NOT NULL,
  evidence_bundle_id TEXT,
  evidence_bundle_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_release_checklists_run_id
  ON engineer_release_checklists (run_id, created_at DESC);

-- Phase 8F: admin-only release completion sign-off (governance record only)
CREATE TABLE IF NOT EXISTS engineer_release_signoffs (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  release_checklist_id TEXT,
  release_checklist_status TEXT,
  decision TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_label TEXT,
  rationale TEXT,
  evidence_bundle_id TEXT,
  evidence_bundle_hash TEXT,
  audit_event_id TEXT,
  audit_chain_hash TEXT,
  signoff_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES engineering_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_release_signoffs_run_id
  ON engineer_release_signoffs (run_id, created_at DESC);

-- Phase S1: operator authentication
CREATE TABLE IF NOT EXISTS engineer_operator_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engineer_operator_accounts_email
  ON engineer_operator_accounts (email);

CREATE TABLE IF NOT EXISTS engineer_operator_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (operator_id) REFERENCES engineer_operator_accounts (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_engineer_operator_sessions_operator_id
  ON engineer_operator_sessions (operator_id);

CREATE INDEX IF NOT EXISTS idx_engineer_operator_sessions_expires_at
  ON engineer_operator_sessions (expires_at);
