import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import {
  auditCompatibilityAnalysisCompleted,
  auditCompatibilityAnalysisFailed,
  auditCompatibilityAnalysisStarted,
} from "../../governance/audit-ledger/compatibility-audit-lifecycle";
import { listRegisteredRepos } from "../registered-repos/list-repos";
import type {
  ApiSurfaceRecord,
  CompatibilityAnalysisRunRecord,
  CrossRepoLinkRecord,
  DetectedApiSurface,
  DetectedCrossRepoLink,
} from "./compatibility-types";
import { CompatibilityAnalysisError } from "./compatibility-types";
import { readPackageMetadata } from "./compatibility-utils";
import {
  countLinkStatuses,
  runCompatibilityDetection,
} from "./run-compatibility-analysis";

interface SurfaceRow {
  id: string;
  repo_id: string;
  relative_path: string;
  surface_type: string;
  method: string | null;
  route_path: string | null;
  name: string | null;
  language: string | null;
  line_start: number | null;
  line_end: number | null;
  source_hash: string;
  confidence: string;
  detected_at: string;
}

interface LinkRow {
  id: string;
  source_repo_id: string;
  target_repo_id: string;
  source_relative_path: string | null;
  target_relative_path: string | null;
  link_type: string;
  status: string;
  confidence: string;
  summary: string | null;
  evidence_json: string;
  detected_at: string;
}

interface RunRow {
  id: string;
  status: string;
  repo_count: number;
  surface_count: number;
  link_count: number;
  warning_count: number;
  breaking_count: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

function mapSurface(row: SurfaceRow): ApiSurfaceRecord {
  return {
    id: row.id,
    repoId: row.repo_id,
    relativePath: row.relative_path,
    surfaceType: row.surface_type as ApiSurfaceRecord["surfaceType"],
    method: row.method,
    routePath: row.route_path,
    name: row.name,
    language: row.language,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    sourceHash: row.source_hash,
    confidence: row.confidence as ApiSurfaceRecord["confidence"],
    detectedAt: row.detected_at,
  };
}

function mapLink(row: LinkRow): CrossRepoLinkRecord {
  return {
    id: row.id,
    sourceRepoId: row.source_repo_id,
    targetRepoId: row.target_repo_id,
    sourceRelativePath: row.source_relative_path,
    targetRelativePath: row.target_relative_path,
    linkType: row.link_type as CrossRepoLinkRecord["linkType"],
    status: row.status as CrossRepoLinkRecord["status"],
    confidence: row.confidence as CrossRepoLinkRecord["confidence"],
    summary: row.summary ?? "",
    evidence: JSON.parse(row.evidence_json) as Record<string, unknown>,
    detectedAt: row.detected_at,
  };
}

function mapRun(row: RunRow): CompatibilityAnalysisRunRecord {
  return {
    id: row.id,
    status: row.status as CompatibilityAnalysisRunRecord["status"],
    repoCount: row.repo_count,
    surfaceCount: row.surface_count,
    linkCount: row.link_count,
    warningCount: row.warning_count,
    breakingCount: row.breaking_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}

function clearCompatibilityDataForRepos(repoIds: string[]): void {
  const db = getEngineerConsoleDb();
  if (repoIds.length === 0) {
    db.exec(`DELETE FROM engineer_api_surfaces`);
    db.exec(`DELETE FROM engineer_cross_repo_links`);
    return;
  }
  const placeholders = repoIds.map(() => "?").join(", ");
  db.prepare(`DELETE FROM engineer_api_surfaces WHERE repo_id IN (${placeholders})`).run(...repoIds);
  db.prepare(
    `DELETE FROM engineer_cross_repo_links
     WHERE source_repo_id IN (${placeholders}) OR target_repo_id IN (${placeholders})`,
  ).run(...repoIds, ...repoIds);
}

function persistSurfaces(surfaces: DetectedApiSurface[], detectedAt: string): number {
  const insert = getEngineerConsoleDb().prepare(
    `INSERT INTO engineer_api_surfaces
      (id, repo_id, relative_path, surface_type, method, route_path, name, language,
       line_start, line_end, source_hash, confidence, detected_at)
     VALUES
      (@id, @repo_id, @relative_path, @surface_type, @method, @route_path, @name, @language,
       @line_start, @line_end, @source_hash, @confidence, @detected_at)`,
  );

  let count = 0;
  for (const surface of surfaces) {
    insert.run({
      id: uuidv4(),
      repo_id: surface.repoId,
      relative_path: surface.relativePath,
      surface_type: surface.surfaceType,
      method: surface.method,
      route_path: surface.routePath,
      name: surface.name,
      language: surface.language,
      line_start: surface.lineStart,
      line_end: surface.lineEnd,
      source_hash: surface.sourceHash,
      confidence: surface.confidence,
      detected_at: detectedAt,
    });
    count++;
  }
  return count;
}

function persistLinks(links: DetectedCrossRepoLink[], detectedAt: string): number {
  const insert = getEngineerConsoleDb().prepare(
    `INSERT INTO engineer_cross_repo_links
      (id, source_repo_id, target_repo_id, source_relative_path, target_relative_path,
       link_type, status, confidence, summary, evidence_json, detected_at)
     VALUES
      (@id, @source_repo_id, @target_repo_id, @source_relative_path, @target_relative_path,
       @link_type, @status, @confidence, @summary, @evidence_json, @detected_at)`,
  );

  let count = 0;
  for (const link of links) {
    insert.run({
      id: uuidv4(),
      source_repo_id: link.sourceRepoId,
      target_repo_id: link.targetRepoId,
      source_relative_path: link.sourceRelativePath,
      target_relative_path: link.targetRelativePath,
      link_type: link.linkType,
      status: link.status,
      confidence: link.confidence,
      summary: link.summary,
      evidence_json: JSON.stringify(link.evidence),
      detected_at: detectedAt,
    });
    count++;
  }
  return count;
}

export interface ListApiSurfacesOptions {
  repoId?: string;
  surfaceType?: string;
  q?: string;
  limit?: number;
}

export function listApiSurfaces(options: ListApiSurfacesOptions = {}): ApiSurfaceRecord[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const params: Record<string, unknown> = { limit };
  let sql = `SELECT * FROM engineer_api_surfaces WHERE 1=1`;

  if (options.repoId) {
    sql += ` AND repo_id = @repo_id`;
    params.repo_id = options.repoId;
  }
  if (options.surfaceType) {
    sql += ` AND surface_type = @surface_type`;
    params.surface_type = options.surfaceType;
  }
  if (options.q?.trim()) {
    sql += ` AND (name LIKE @q OR route_path LIKE @q OR relative_path LIKE @q)`;
    params.q = `%${options.q.trim().replace(/%/g, "")}%`;
  }

  sql += ` ORDER BY detected_at DESC, relative_path ASC LIMIT @limit`;
  const rows = getEngineerConsoleDb().prepare(sql).all(params) as SurfaceRow[];
  return rows.map(mapSurface);
}

export interface ListCrossRepoLinksOptions {
  sourceRepoId?: string;
  targetRepoId?: string;
  status?: string;
  linkType?: string;
  limit?: number;
}

export function listCrossRepoLinks(options: ListCrossRepoLinksOptions = {}): CrossRepoLinkRecord[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const params: Record<string, unknown> = { limit };
  let sql = `SELECT * FROM engineer_cross_repo_links WHERE 1=1`;

  if (options.sourceRepoId) {
    sql += ` AND source_repo_id = @source_repo_id`;
    params.source_repo_id = options.sourceRepoId;
  }
  if (options.targetRepoId) {
    sql += ` AND target_repo_id = @target_repo_id`;
    params.target_repo_id = options.targetRepoId;
  }
  if (options.status) {
    sql += ` AND status = @status`;
    params.status = options.status;
  }
  if (options.linkType) {
    sql += ` AND link_type = @link_type`;
    params.link_type = options.linkType;
  }

  sql += ` ORDER BY detected_at DESC LIMIT @limit`;
  const rows = getEngineerConsoleDb().prepare(sql).all(params) as LinkRow[];
  return rows.map(mapLink);
}

export function listCompatibilityAnalysisRuns(limit = 20): CompatibilityAnalysisRunRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_compatibility_analysis_runs
       ORDER BY started_at DESC LIMIT ?`,
    )
    .all(limit) as RunRow[];
  return rows.map(mapRun);
}

export function getLatestCompatibilityAnalysisRun(): CompatibilityAnalysisRunRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_compatibility_analysis_runs
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get() as RunRow | undefined;
  return row ? mapRun(row) : null;
}

export function runCompatibilityAnalysis(options: {
  repoIds?: string[];
  audit?: boolean;
} = {}): CompatibilityAnalysisRunRecord {
  const audit = options.audit ?? true;
  const allRepos = listRegisteredRepos();
  const verified = allRepos.filter((r) => r.verificationStatus === "ok");

  let targetRepos = verified;
  if (options.repoIds?.length) {
    const idSet = new Set(options.repoIds);
    targetRepos = verified.filter((r) => idSet.has(r.id));
  }

  if (targetRepos.length === 0) {
    throw new CompatibilityAnalysisError(
      "At least one verified registered repository is required for compatibility analysis.",
    );
  }

  const runId = uuidv4();
  const startedAt = new Date().toISOString();
  const db = getEngineerConsoleDb();

  db.prepare(
    `INSERT INTO engineer_compatibility_analysis_runs
      (id, status, repo_count, surface_count, link_count, warning_count, breaking_count, started_at)
     VALUES (@id, 'running', @repo_count, 0, 0, 0, 0, @started_at)`,
  ).run({
    id: runId,
    repo_count: targetRepos.length,
    started_at: startedAt,
  });

  if (audit) {
    auditCompatibilityAnalysisStarted(runId, { repoCount: targetRepos.length });
  }

  try {
    const repoContexts = targetRepos.map((repo) => {
      const meta = readPackageMetadata(repo.path);
      return {
        repoId: repo.id,
        repoName: repo.name,
        packageName: meta.name ?? repo.name,
        repoPath: repo.path,
        verificationStatus: repo.verificationStatus,
      };
    });

    const repoIds = targetRepos.map((r) => r.id);
    clearCompatibilityDataForRepos(
      options.repoIds?.length ? repoIds : repoIds,
    );

    const { surfaces, links } = runCompatibilityDetection(repoContexts);
    const surfaceCount = persistSurfaces(surfaces, startedAt);
    const linkCount = persistLinks(links, startedAt);
    const { warningCount, breakingCount } = countLinkStatuses(links);
    const completedAt = new Date().toISOString();

    db.prepare(
      `UPDATE engineer_compatibility_analysis_runs SET
        status = 'completed',
        surface_count = @surface_count,
        link_count = @link_count,
        warning_count = @warning_count,
        breaking_count = @breaking_count,
        completed_at = @completed_at
       WHERE id = @id`,
    ).run({
      id: runId,
      surface_count: surfaceCount,
      link_count: linkCount,
      warning_count: warningCount,
      breaking_count: breakingCount,
      completed_at: completedAt,
    });

    if (audit) {
      auditCompatibilityAnalysisCompleted(runId, {
        repoCount: targetRepos.length,
        surfaceCount,
        linkCount,
        warningCount,
        breakingCount,
      });
    }

    const row = db
      .prepare(`SELECT * FROM engineer_compatibility_analysis_runs WHERE id = ?`)
      .get(runId) as RunRow;
    return mapRun(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(
      `UPDATE engineer_compatibility_analysis_runs SET
        status = 'failed', completed_at = @completed_at, error_message = @error_message
       WHERE id = @id`,
    ).run({
      id: runId,
      completed_at: new Date().toISOString(),
      error_message: message.slice(0, 500),
    });

    if (audit) {
      auditCompatibilityAnalysisFailed(runId, { message });
    }
    throw error;
  }
}

export {
  getCompatibilitySummaryForRepo,
  buildCompatibilityContextSummary,
  toPublicApiSurface,
  toPublicCrossRepoLink,
  toPublicAnalysisRun,
  runCompatibilityDetection,
  countLinkStatuses,
} from "./run-compatibility-analysis";

export { CompatibilityAnalysisError } from "./compatibility-types";
