import { v4 as uuidv4 } from "uuid";
import type Database from "better-sqlite3";
import { getEngineerConsoleDb } from "../db/client";
import { buildEvidenceReference, deriveConfidence } from "./skill-evidence";
import { createInitialVersion } from "./skill-versioning";
import type {
  EvidenceReference,
  ShadowRetrievalRecord,
  SkillCandidateProposal,
  SkillRecord,
  SkillStatus,
  SkillValidationRecord,
  SkillVersionRecord,
} from "./skill-types";

function nowIso(): string {
  return new Date().toISOString();
}

interface SkillRow {
  id: string;
  status: string;
  lesson_type: string;
  model_scope: string;
  model_family: string | null;
  model_id: string | null;
  signature: string;
  title: string;
  lesson: string;
  anti_patterns_json: string;
  tags_json: string;
  confidence: number;
  validation_count: number;
  rejection_count: number;
  current_version: number;
  created_at: string;
  updated_at: string;
}

function mapSkill(row: SkillRow): SkillRecord {
  return {
    id: row.id,
    status: row.status as SkillRecord["status"],
    lessonType: row.lesson_type as SkillRecord["lessonType"],
    modelScope: row.model_scope as SkillRecord["modelScope"],
    modelFamily: row.model_family,
    modelId: row.model_id,
    signature: row.signature,
    title: row.title,
    lesson: row.lesson,
    antiPatterns: JSON.parse(row.anti_patterns_json) as string[],
    tags: JSON.parse(row.tags_json) as string[],
    confidence: row.confidence,
    validationCount: row.validation_count,
    rejectionCount: row.rejection_count,
    currentVersion: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function db(): Database.Database {
  return getEngineerConsoleDb();
}

export function insertSkillCandidate(proposal: SkillCandidateProposal): SkillRecord {
  const id = uuidv4();
  const now = nowIso();
  const positive = proposal.evidence.filter((e) => e.polarity === "positive").length;
  const skill: SkillRecord = {
    id,
    status: "candidate",
    lessonType: proposal.lessonType,
    modelScope: proposal.modelScope,
    modelFamily: proposal.modelFamily ?? null,
    modelId: proposal.modelId ?? null,
    signature: proposal.signature,
    title: proposal.title,
    lesson: proposal.lesson,
    antiPatterns: proposal.antiPatterns,
    tags: proposal.tags,
    confidence: deriveConfidence({
      status: "candidate",
      validationCount: 0,
      rejectionCount: 0,
      positiveEvidenceCount: positive,
    }),
    validationCount: 0,
    rejectionCount: 0,
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  };

  db()
    .prepare(
      `INSERT INTO engineer_skills (
        id, status, lesson_type, model_scope, model_family, model_id, signature, title, lesson,
        anti_patterns_json, tags_json, confidence, validation_count, rejection_count, current_version,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      skill.id,
      skill.status,
      skill.lessonType,
      skill.modelScope,
      skill.modelFamily,
      skill.modelId,
      skill.signature,
      skill.title,
      skill.lesson,
      JSON.stringify(skill.antiPatterns),
      JSON.stringify(skill.tags),
      skill.confidence,
      skill.validationCount,
      skill.rejectionCount,
      skill.currentVersion,
      skill.createdAt,
      skill.updatedAt,
    );

  const version = createInitialVersion(skill, proposal.extractorNotes ?? "candidate_extraction");
  insertSkillVersion(version);

  for (const ev of proposal.evidence) {
    insertEvidence(
      buildEvidenceReference({
        skillId: id,
        polarity: ev.polarity,
        refPath: ev.refPath,
        refKind: ev.refKind,
        runId: ev.runId,
        taskId: ev.taskId,
        summary: ev.summary,
      }),
    );
  }

  return skill;
}

export function insertSkillVersion(version: SkillVersionRecord): void {
  db()
    .prepare(
      `INSERT INTO engineer_skill_versions (
        id, skill_id, version, lesson, anti_patterns_json, change_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      version.id,
      version.skillId,
      version.version,
      version.lesson,
      JSON.stringify(version.antiPatterns),
      version.changeReason,
      version.createdAt,
    );
}

export function insertEvidence(ref: EvidenceReference): void {
  db()
    .prepare(
      `INSERT INTO engineer_skill_evidence (
        id, skill_id, polarity, ref_path, ref_kind, run_id, task_id, summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ref.id,
      ref.skillId,
      ref.polarity,
      ref.refPath,
      ref.refKind,
      ref.runId ?? null,
      ref.taskId ?? null,
      ref.summary ?? null,
      ref.createdAt,
    );
}

export function getSkill(id: string): SkillRecord | null {
  const row = db().prepare(`SELECT * FROM engineer_skills WHERE id = ?`).get(id) as SkillRow | undefined;
  return row ? mapSkill(row) : null;
}

export function listSkills(filter: { status?: SkillStatus | SkillStatus[] } = {}): SkillRecord[] {
  const statuses = filter.status
    ? Array.isArray(filter.status)
      ? filter.status
      : [filter.status]
    : null;
  if (!statuses) {
    return (db().prepare(`SELECT * FROM engineer_skills ORDER BY updated_at DESC`).all() as SkillRow[]).map(
      mapSkill,
    );
  }
  const placeholders = statuses.map(() => "?").join(",");
  return (
    db()
      .prepare(`SELECT * FROM engineer_skills WHERE status IN (${placeholders}) ORDER BY updated_at DESC`)
      .all(...statuses) as SkillRow[]
  ).map(mapSkill);
}

export function listEvidenceForSkill(skillId: string): EvidenceReference[] {
  const rows = db()
    .prepare(`SELECT * FROM engineer_skill_evidence WHERE skill_id = ? ORDER BY created_at ASC`)
    .all(skillId) as Array<{
    id: string;
    skill_id: string;
    polarity: string;
    ref_path: string;
    ref_kind: string;
    run_id: string | null;
    task_id: string | null;
    summary: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    skillId: r.skill_id,
    polarity: r.polarity as EvidenceReference["polarity"],
    refPath: r.ref_path,
    refKind: r.ref_kind as EvidenceReference["refKind"],
    runId: r.run_id,
    taskId: r.task_id,
    summary: r.summary,
    createdAt: r.created_at,
  }));
}

export function updateSkillRecord(skill: SkillRecord): void {
  db()
    .prepare(
      `UPDATE engineer_skills SET
        status = ?, lesson = ?, anti_patterns_json = ?, tags_json = ?, confidence = ?,
        validation_count = ?, rejection_count = ?, current_version = ?, updated_at = ?,
        model_scope = ?, model_family = ?, model_id = ?, signature = ?, title = ?, lesson_type = ?
      WHERE id = ?`,
    )
    .run(
      skill.status,
      skill.lesson,
      JSON.stringify(skill.antiPatterns),
      JSON.stringify(skill.tags),
      skill.confidence,
      skill.validationCount,
      skill.rejectionCount,
      skill.currentVersion,
      skill.updatedAt,
      skill.modelScope,
      skill.modelFamily,
      skill.modelId,
      skill.signature,
      skill.title,
      skill.lessonType,
      skill.id,
    );
}

export function insertValidation(rec: SkillValidationRecord): void {
  db()
    .prepare(
      `INSERT INTO engineer_skill_validations (
        id, skill_id, action, reason, actor, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(rec.id, rec.skillId, rec.action, rec.reason, rec.actor, rec.createdAt);
}

export function insertShadowRetrieval(rec: ShadowRetrievalRecord): void {
  db()
    .prepare(
      `INSERT INTO engineer_skill_shadow_retrievals (
        id, run_id, task_id, model_id, model_family, query_signature, task_context_digest,
        matched_skill_ids_json, would_inject, actually_injected, prompt_hash_before, prompt_hash_after,
        ranking_scores_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.runId,
      rec.taskId ?? null,
      rec.modelId ?? null,
      rec.modelFamily ?? null,
      rec.querySignature,
      rec.taskContextDigest,
      JSON.stringify(rec.matchedSkillIds),
      rec.wouldInject,
      rec.promptHashBefore,
      rec.promptHashAfter,
      JSON.stringify(rec.rankingScores),
      rec.createdAt,
    );
}

export function listShadowRetrievals(runId?: string): ShadowRetrievalRecord[] {
  const rows = (
    runId
      ? db()
          .prepare(`SELECT * FROM engineer_skill_shadow_retrievals WHERE run_id = ? ORDER BY created_at DESC`)
          .all(runId)
      : db().prepare(`SELECT * FROM engineer_skill_shadow_retrievals ORDER BY created_at DESC`).all()
  ) as Array<{
    id: string;
    run_id: string;
    task_id: string | null;
    model_id: string | null;
    model_family: string | null;
    query_signature: string;
    task_context_digest: string;
    matched_skill_ids_json: string;
    would_inject: string;
    actually_injected: number;
    prompt_hash_before: string;
    prompt_hash_after: string;
    ranking_scores_json: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    taskId: r.task_id,
    modelId: r.model_id,
    modelFamily: r.model_family,
    querySignature: r.query_signature,
    taskContextDigest: r.task_context_digest,
    matchedSkillIds: JSON.parse(r.matched_skill_ids_json) as string[],
    wouldInject: r.would_inject,
    actuallyInjected: false,
    promptHashBefore: r.prompt_hash_before,
    promptHashAfter: r.prompt_hash_after,
    rankingScores: JSON.parse(r.ranking_scores_json) as Record<string, number>,
    createdAt: r.created_at,
  }));
}

export function countSkillsByStatus(): Record<string, number> {
  const rows = db()
    .prepare(`SELECT status, COUNT(*) AS n FROM engineer_skills GROUP BY status`)
    .all() as Array<{ status: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}
