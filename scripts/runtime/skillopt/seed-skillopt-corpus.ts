/**
 * Seed SkillOpt historical corpus into the Console DB (candidates → curated validate/reject).
 * Usage: npx tsx scripts/runtime/skillopt/seed-skillopt-corpus.ts
 */
import { initializeEngineerConsoleDatabase } from "../../../src/lib/engineer-console/db/init";
import { seedSkillOptCorpus, collectSkillOptMetrics } from "../../../src/lib/engineer-console/skillopt";

initializeEngineerConsoleDatabase();
const result = seedSkillOptCorpus();
const metrics = collectSkillOptMetrics();
console.log(
  JSON.stringify(
    {
      validatedTitles: result.validatedTitles,
      rejectedTitles: result.rejectedTitles,
      insertedCount: result.inserted.length,
      metrics,
    },
    null,
    2,
  ),
);
