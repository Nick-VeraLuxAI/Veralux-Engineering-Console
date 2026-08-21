import { bumpSkillVersion } from "./skill-versioning";
import { insertSkillVersion } from "./skill-store";
import type { SkillRecord, SkillVersionRecord } from "./skill-types";

/** Thin re-export so curator can persist versions without circular imports. */
export function insertSkillVersionViaStore(version: SkillVersionRecord): void {
  insertSkillVersion(version);
}

export { bumpSkillVersion };
export type { SkillRecord, SkillVersionRecord };
