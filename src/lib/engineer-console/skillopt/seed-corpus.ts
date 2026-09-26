import { normalizeFailureSignature } from "./skill-evidence";
import { insertSkillCandidate, listSkills } from "./skill-store";
import { validateSkill, rejectSkill, shouldAutoRejectProposal } from "./skill-curator";
import {
  NEMOTRON_NANO_FAMILY,
  NEMOTRON_NANO_MODEL_ID,
  type SkillCandidateProposal,
  type SkillRecord,
} from "./skill-types";

/**
 * Historical backfill seed proposals from AE evidence / SoTs.
 * Does NOT auto-validate all — curated explicitly below.
 */
export function buildSeedCorpusProposals(): SkillCandidateProposal[] {
  return [
    {
      lessonType: "testing",
      modelScope: "model_independent",
      signature: normalizeFailureSignature("TEST_ASSERTION_MODE_MISMATCH:sync_vs_async"),
      title: "Sync vs async Node assertion",
      lesson:
        "For negative-path tests: sync subjects → assert.throws(() => ...); async/Promise subjects → await assert.rejects(...). Read subject call modes before writing reject/throw tests.",
      antiPatterns: ["assert.rejects on sync throwers", "assert.throws on unresolved promises"],
      tags: ["node:test", "assert", "testing"],
      evidence: [
        {
          polarity: "positive",
          refPath: "evidence/ae-shared-path-regression/",
          refKind: "run_json",
          summary: "Shared-path restoration / state_counter assertion discipline",
        },
        {
          polarity: "negative",
          refPath: "docs/source-of-truth/ae-learning-skillopt-convergence-audit.md",
          refKind: "sot",
          summary: "Historical TEST_ASSERTION_MODE_MISMATCH thrash",
        },
      ],
    },
    {
      lessonType: "acceptance",
      modelScope: "model_independent",
      signature: normalizeFailureSignature("AC_CLEANUP_CLOSURE:explicit_delete"),
      title: "Explicit AC cleanup closure",
      lesson:
        "When AC requires removing unused dead helpers/shims and path is authorized/safe, include delete_file with non-empty reason. Do not leave residual scaffolding.",
      antiPatterns: ["QC-pass with leftover dead WORKAROUND shims"],
      tags: ["acceptance", "cleanup", "agent_bad_code"],
      evidence: [
        {
          polarity: "positive",
          refPath: "evidence/ae-robust-requalification-final/",
          refKind: "run_json",
          summary: "agent_bad_code cleanup bar",
        },
      ],
    },
    {
      lessonType: "diagnosis",
      modelScope: "model_independent",
      signature: normalizeFailureSignature("DIAGNOSIS:persistent_causal_production_first"),
      title: "Persistent causal production failure prioritization",
      lesson:
        "Prioritize persistent causal production failures over harness-only noise. Signature-gate unbound guidance; do not always-on bias every plan toward import wiring.",
      antiPatterns: ["Always-on ReferenceError prompt lines without unbound evidence"],
      tags: ["diagnosis", "prioritization"],
      evidence: [
        {
          polarity: "positive",
          refPath: "docs/source-of-truth/ae-shared-path-regression-restoration.md",
          refKind: "sot",
          summary: "SHARED_PROMPT_POLLUTION isolation and unboundHint gating",
        },
        {
          polarity: "negative",
          refPath: "evidence/ae-shared-path-regression/prompt-diffs-a-vs-b.json",
          refKind: "other",
          summary: "Always-on prompt pollution delta",
        },
      ],
    },
    {
      lessonType: "governance",
      modelScope: "model_independent",
      signature: normalizeFailureSignature("GOVERNANCE:avoid_always_on_prompt_pollution"),
      title: "Avoid always-on heuristic prompt pollution",
      lesson:
        "Do not append always-on repair heuristics to every planning prompt. Gate on normalized failure signatures and task-relevant evidence. FORBIDDEN: for (const skill of allSkills) prompt += skill.",
      antiPatterns: [
        "for (const skill of allSkills) prompt += skill",
        "Always tell Nano to import store.js",
      ],
      tags: ["governance", "prompt_hygiene"],
      evidence: [
        {
          polarity: "positive",
          refPath: "docs/source-of-truth/ae-shared-path-regression-restoration.md",
          refKind: "sot",
          summary: "SHARED BASELINE RESTORED after removing always-on pollution",
        },
        {
          polarity: "negative",
          refPath: "evidence/ae-shared-path-regression/prompt-diffs-a-vs-b.json",
          refKind: "other",
          summary: "MULTIPLE_SHARED_REGRESSIONS / SHARED_PROMPT_POLLUTION",
        },
      ],
    },
    {
      lessonType: "model_invocation",
      modelScope: "model_specific",
      modelFamily: NEMOTRON_NANO_FAMILY,
      modelId: NEMOTRON_NANO_MODEL_ID,
      signature: normalizeFailureSignature("NEMOTRON:faithful_invocation_contract"),
      title: "Nemotron faithful invocation contract",
      lesson:
        "FAITHFUL Nano: nano_v3 + qwen3_coder + auto tool choice, 256k context, batched 2048, reasoning ON, NVIDIA sampling. CONTROL rollback only via explicit flag.",
      antiPatterns: ["Claiming FAITHFUL while running CONTROL/DEGRADED"],
      tags: ["nemotron", "faithful"],
      evidence: [
        {
          polarity: "positive",
          refPath: "docs/source-of-truth/nemotron-nano-production-faithful-runtime.md",
          refKind: "sot",
        },
      ],
    },
    {
      lessonType: "runtime",
      modelScope: "model_specific",
      modelFamily: NEMOTRON_NANO_FAMILY,
      modelId: NEMOTRON_NANO_MODEL_ID,
      signature: normalizeFailureSignature("NEMOTRON:conditional_gbe_rescue"),
      title: "Nemotron conditional generation-budget rescue",
      lesson:
        "Primary path remains single-shot FAITHFUL. On GENERATION_BUDGET_EXHAUSTED only, apply FAITHFUL_SINGLE_SHOT_THEN_BUDGET_RESCUE. Global always-on 4k is experimental, not qualification default.",
      antiPatterns: ["Global ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET=4000 as default"],
      tags: ["nemotron", "gbe", "rescue"],
      evidence: [
        {
          polarity: "positive",
          refPath: "docs/source-of-truth/ae-q1-conditional-reasoning.md",
          refKind: "sot",
        },
      ],
    },
    // Bad candidate — must be rejected
    {
      lessonType: "engineering",
      modelScope: "model_independent",
      signature: normalizeFailureSignature("BAD:always_import_store_js"),
      title: "Always tell Nano to import store.js",
      lesson: "Always tell Nano to import store.js.",
      antiPatterns: [],
      tags: ["bad_candidate"],
      evidence: [
        {
          polarity: "negative",
          refPath: "docs/source-of-truth/ae-shared-path-regression-restoration.md",
          refKind: "sot",
          summary: "Explicit reject example — harness-adjacent always-on pollution",
        },
      ],
    },
  ];
}

export interface SeedCorpusResult {
  inserted: SkillRecord[];
  validatedTitles: string[];
  rejectedTitles: string[];
}

/**
 * Insert seed candidates; validate the six good examples; reject the bad one.
 * Idempotent-ish: skips titles that already exist.
 */
export function seedSkillOptCorpus(): SeedCorpusResult {
  const existingTitles = new Set(listSkills().map((s) => s.title));
  const inserted: SkillRecord[] = [];
  const validatedTitles: string[] = [];
  const rejectedTitles: string[] = [];

  for (const proposal of buildSeedCorpusProposals()) {
    if (existingTitles.has(proposal.title)) continue;
    const skill = insertSkillCandidate(proposal);
    inserted.push(skill);
    existingTitles.add(skill.title);

    const auto = shouldAutoRejectProposal(skill.lesson, skill.title);
    if (auto || skill.tags.includes("bad_candidate")) {
      rejectSkill(skill.id, auto ?? "seed_bad_candidate", "seed_corpus");
      rejectedTitles.push(skill.title);
      continue;
    }

    // Curate the six required examples as validated (evidence already attached).
    validateSkill(skill.id, "seed_corpus_curated_validation", "seed_corpus");
    validatedTitles.push(skill.title);
  }

  return { inserted, validatedTitles, rejectedTitles };
}
