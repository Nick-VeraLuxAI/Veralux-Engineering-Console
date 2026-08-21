import { v4 as uuidv4 } from "uuid";
import type { SkillRecord, SkillVersionRecord } from "./skill-types";

export function createInitialVersion(skill: SkillRecord, reason = "initial"): SkillVersionRecord {
  return {
    id: uuidv4(),
    skillId: skill.id,
    version: skill.currentVersion,
    lesson: skill.lesson,
    antiPatterns: [...skill.antiPatterns],
    changeReason: reason,
    createdAt: skill.createdAt,
  };
}

/**
 * Immutable versioning when lesson meaning changes.
 * Returns updated skill + new version row. Callers persist both.
 */
export function bumpSkillVersion(
  skill: SkillRecord,
  next: { lesson: string; antiPatterns?: string[]; changeReason: string },
): { skill: SkillRecord; version: SkillVersionRecord } {
  const meaningChanged =
    next.lesson.trim() !== skill.lesson.trim() ||
    JSON.stringify(next.antiPatterns ?? skill.antiPatterns) !== JSON.stringify(skill.antiPatterns);
  if (!meaningChanged) {
    return {
      skill,
      version: {
        id: uuidv4(),
        skillId: skill.id,
        version: skill.currentVersion,
        lesson: skill.lesson,
        antiPatterns: [...skill.antiPatterns],
        changeReason: "noop_same_meaning",
        createdAt: new Date().toISOString(),
      },
    };
  }
  const now = new Date().toISOString();
  const versionNum = skill.currentVersion + 1;
  const updated: SkillRecord = {
    ...skill,
    lesson: next.lesson,
    antiPatterns: next.antiPatterns ?? skill.antiPatterns,
    currentVersion: versionNum,
    updatedAt: now,
  };
  return {
    skill: updated,
    version: {
      id: uuidv4(),
      skillId: skill.id,
      version: versionNum,
      lesson: updated.lesson,
      antiPatterns: [...updated.antiPatterns],
      changeReason: next.changeReason,
      createdAt: now,
    },
  };
}
