import type { RetrievalQuery, SkillRecord } from "./skill-types";
import { skillMatchesModelScope } from "./skill-model-scope";
import { normalizeFailureSignature } from "./skill-evidence";

export interface RankedSkill {
  skill: SkillRecord;
  score: number;
  reasons: string[];
}

/**
 * Signature-gated, task-relevant, bounded, model-aware ranking.
 * FORBIDDEN pattern: for (const skill of allSkills) prompt += skill.lesson
 */
export function rankSkillsForRetrieval(
  skills: SkillRecord[],
  query: RetrievalQuery,
): RankedSkill[] {
  const limit = Math.max(1, Math.min(query.limit ?? 5, 8));
  const sigs = new Set(
    (query.signatures.length ? query.signatures : [query.taskText ?? ""])
      .map((s) => normalizeFailureSignature(s))
      .filter(Boolean),
  );
  const task = (query.taskText ?? "").toLowerCase();
  const ranked: RankedSkill[] = [];

  for (const skill of skills) {
    if (skill.status !== "validated") continue;
    if (!skillMatchesModelScope(skill, query)) continue;
    if (query.lessonTypes && !query.lessonTypes.includes(skill.lessonType)) continue;

    let score = 0;
    const reasons: string[] = [];
    const skillSig = normalizeFailureSignature(skill.signature);

    for (const s of sigs) {
      if (!s) continue;
      if (s === skillSig || skillSig.includes(s) || s.includes(skillSig)) {
        score += 5;
        reasons.push(`signature_match:${s}`);
      } else {
        // Token overlap
        const a = new Set(s.split(" ").filter((w) => w.length > 3));
        const b = new Set(skillSig.split(" ").filter((w) => w.length > 3));
        let overlap = 0;
        for (const t of a) if (b.has(t)) overlap += 1;
        if (overlap > 0) {
          score += overlap;
          reasons.push(`token_overlap:${overlap}`);
        }
      }
    }

    if (task) {
      for (const tag of skill.tags) {
        if (task.includes(tag.toLowerCase())) {
          score += 1.5;
          reasons.push(`tag:${tag}`);
        }
      }
      const lessonHit = skill.lesson
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 5 && task.includes(w)).length;
      score += Math.min(3, lessonHit * 0.5);
    }

    score += skill.confidence * 2;
    score += Math.min(2, skill.validationCount * 0.25);

    // Prefer engineering/testing lessons over model-specific runtime when task is about asserts
    if (/assert|sync|async|test/.test(task) && skill.lessonType === "testing") {
      score += 2;
      reasons.push("task_prefers_testing");
    }
    if (/assert|sync|async|test/.test(task) && skill.lessonType === "runtime") {
      score -= 1;
      reasons.push("demote_runtime_for_test_task");
    }

    if (score > 0.5 && reasons.length > 0) {
      ranked.push({ skill, score, reasons });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

/** Format would-inject text for shadow records only — never append to live prompts in V1. */
export function formatWouldInjectBlock(ranked: RankedSkill[]): string {
  if (ranked.length === 0) return "";
  const lines = [
    "<!-- SkillOpt SHADOW wouldInject (NOT APPLIED) -->",
    ...ranked.map(
      (r, i) =>
        `${i + 1}. [${r.skill.modelScope}/${r.skill.lessonType}] ${r.skill.title}: ${r.skill.lesson}`,
    ),
  ];
  return lines.join("\n");
}
