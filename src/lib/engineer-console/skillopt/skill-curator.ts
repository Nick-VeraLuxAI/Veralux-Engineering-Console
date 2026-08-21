import { v4 as uuidv4 } from "uuid";
import { deriveConfidence } from "./skill-evidence";
import { listEvidenceForSkill, getSkill, insertValidation, updateSkillRecord } from "./skill-store";
import { bumpSkillVersion, insertSkillVersionViaStore } from "./skill-versioning-store";
import type { SkillRecord } from "./skill-types";

/** Bad heuristic lessons that must be rejected if proposed. */
const REJECT_PATTERNS = [
  /always tell nano to import store\.js/i,
  /always append every lesson to every prompt/i,
  /always-on unbound/i,
  /unconditionally inject/i,
];

export function shouldAutoRejectProposal(lesson: string, title: string): string | null {
  const text = `${title}\n${lesson}`;
  for (const re of REJECT_PATTERNS) {
    if (re.test(text)) {
      return `Rejected heuristic prompt pollution: matched ${re}`;
    }
  }
  return null;
}

export function validateSkill(
  skillId: string,
  reason: string,
  actor = "curator",
): SkillRecord {
  const skill = getSkill(skillId);
  if (!skill) throw new Error(`skill_not_found:${skillId}`);
  if (skill.status === "rejected" || skill.status === "deprecated") {
    throw new Error(`skill_not_eligible_for_validation:${skill.status}`);
  }
  const evidence = listEvidenceForSkill(skillId);
  const positive = evidence.filter((e) => e.polarity === "positive").length;
  if (positive < 1) {
    throw new Error("validation_requires_positive_evidence");
  }
  const now = new Date().toISOString();
  const updated: SkillRecord = {
    ...skill,
    status: "validated",
    validationCount: skill.validationCount + 1,
    updatedAt: now,
  };
  updated.confidence = deriveConfidence({
    status: updated.status,
    validationCount: updated.validationCount,
    rejectionCount: updated.rejectionCount,
    positiveEvidenceCount: positive,
  });
  updateSkillRecord(updated);
  insertValidation({
    id: uuidv4(),
    skillId,
    action: "validate",
    reason,
    actor,
    createdAt: now,
  });
  return updated;
}

export function rejectSkill(skillId: string, reason: string, actor = "curator"): SkillRecord {
  const skill = getSkill(skillId);
  if (!skill) throw new Error(`skill_not_found:${skillId}`);
  const now = new Date().toISOString();
  const evidence = listEvidenceForSkill(skillId);
  const positive = evidence.filter((e) => e.polarity === "positive").length;
  const updated: SkillRecord = {
    ...skill,
    status: "rejected",
    rejectionCount: skill.rejectionCount + 1,
    updatedAt: now,
  };
  updated.confidence = deriveConfidence({
    status: updated.status,
    validationCount: updated.validationCount,
    rejectionCount: updated.rejectionCount,
    positiveEvidenceCount: positive,
  });
  updateSkillRecord(updated);
  insertValidation({
    id: uuidv4(),
    skillId,
    action: "reject",
    reason,
    actor,
    createdAt: now,
  });
  return updated;
}

export function deprecateSkill(skillId: string, reason: string, actor = "curator"): SkillRecord {
  const skill = getSkill(skillId);
  if (!skill) throw new Error(`skill_not_found:${skillId}`);
  const now = new Date().toISOString();
  const updated: SkillRecord = { ...skill, status: "deprecated", updatedAt: now };
  updateSkillRecord(updated);
  insertValidation({
    id: uuidv4(),
    skillId,
    action: "deprecate",
    reason,
    actor,
    createdAt: now,
  });
  return updated;
}

export function reviseSkillLesson(
  skillId: string,
  lesson: string,
  changeReason: string,
  antiPatterns?: string[],
): SkillRecord {
  const skill = getSkill(skillId);
  if (!skill) throw new Error(`skill_not_found:${skillId}`);
  const { skill: bumped, version } = bumpSkillVersion(skill, {
    lesson,
    antiPatterns,
    changeReason,
  });
  if (version.changeReason !== "noop_same_meaning") {
    insertSkillVersionViaStore(version);
    updateSkillRecord(bumped);
  }
  return getSkill(skillId)!;
}
