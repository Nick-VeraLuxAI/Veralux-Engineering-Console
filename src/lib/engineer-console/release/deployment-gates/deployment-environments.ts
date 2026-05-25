import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import type {
  DeploymentEnvironmentRecord,
  DeploymentEnvironmentType,
  DeploymentStrategy,
} from "./deployment-gate-types";

interface EnvironmentRow {
  id: string;
  name: string;
  environment_type: string;
  description: string | null;
  required_branch: string | null;
  deployment_strategy: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

const DEFAULT_ENVIRONMENTS: Array<{
  name: string;
  environmentType: DeploymentEnvironmentType;
  description: string;
  requiredBranch: string | null;
  deploymentStrategy: DeploymentStrategy;
}> = [
  {
    name: "local",
    environmentType: "local",
    description: "Local developer environment (readiness only)",
    requiredBranch: null,
    deploymentStrategy: "manual",
  },
  {
    name: "staging",
    environmentType: "staging",
    description: "Pre-production staging environment",
    requiredBranch: "main",
    deploymentStrategy: "manual",
  },
  {
    name: "production",
    environmentType: "production",
    description: "Production environment",
    requiredBranch: "main",
    deploymentStrategy: "manual",
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: EnvironmentRow): DeploymentEnvironmentRecord {
  return {
    id: row.id,
    name: row.name,
    environmentType: row.environment_type as DeploymentEnvironmentRecord["environmentType"],
    description: row.description,
    requiredBranch: row.required_branch,
    deploymentStrategy: row.deployment_strategy as DeploymentEnvironmentRecord["deploymentStrategy"],
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function ensureDefaultDeploymentEnvironments(): void {
  const count = getEngineerConsoleDb()
    .prepare(`SELECT COUNT(*) AS c FROM engineer_deployment_environments`)
    .get() as { c: number };
  if (count.c > 0) return;

  const now = nowIso();
  const insert = getEngineerConsoleDb().prepare(
    `INSERT INTO engineer_deployment_environments
      (id, name, environment_type, description, required_branch, deployment_strategy,
       is_active, created_at, updated_at)
     VALUES
      (@id, @name, @environment_type, @description, @required_branch, @deployment_strategy,
       1, @created_at, @updated_at)`,
  );

  for (const env of DEFAULT_ENVIRONMENTS) {
    insert.run({
      id: uuidv4(),
      name: env.name,
      environment_type: env.environmentType,
      description: env.description,
      required_branch: env.requiredBranch,
      deployment_strategy: env.deploymentStrategy,
      created_at: now,
      updated_at: now,
    });
  }
}

export function listDeploymentEnvironments(options?: { activeOnly?: boolean }): DeploymentEnvironmentRecord[] {
  ensureDefaultDeploymentEnvironments();
  const activeOnly = options?.activeOnly !== false;
  const rows = activeOnly
    ? (getEngineerConsoleDb()
        .prepare(
          `SELECT * FROM engineer_deployment_environments WHERE is_active = 1 ORDER BY name ASC`,
        )
        .all() as EnvironmentRow[])
    : (getEngineerConsoleDb()
        .prepare(`SELECT * FROM engineer_deployment_environments ORDER BY name ASC`)
        .all() as EnvironmentRow[]);
  return rows.map(mapRow);
}

export function getDeploymentEnvironmentById(id: string): DeploymentEnvironmentRecord | null {
  ensureDefaultDeploymentEnvironments();
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_deployment_environments WHERE id = ?`)
    .get(id) as EnvironmentRow | undefined;
  return row ? mapRow(row) : null;
}

export function getDeploymentEnvironmentByName(name: string): DeploymentEnvironmentRecord | null {
  ensureDefaultDeploymentEnvironments();
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_deployment_environments WHERE name = ?`)
    .get(name) as EnvironmentRow | undefined;
  return row ? mapRow(row) : null;
}

export function toPublicDeploymentEnvironment(record: DeploymentEnvironmentRecord) {
  return {
    id: record.id,
    name: record.name,
    environmentType: record.environmentType,
    description: record.description,
    requiredBranch: record.requiredBranch,
    deploymentStrategy: record.deploymentStrategy,
    isActive: record.isActive,
  };
}
