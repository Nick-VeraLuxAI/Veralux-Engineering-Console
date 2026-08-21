import { normalizeFailureSignature } from "./skill-evidence";
import { shouldAutoRejectProposal } from "./skill-curator";
import { resolveSkillOptFlags } from "./skill-flags";
import {
  NEMOTRON_NANO_FAMILY,
  NEMOTRON_NANO_MODEL_ID,
  type SkillCandidateProposal,
} from "./skill-types";

/** Delivery / run evidence shape used for post-run extraction (proposals only). */
export interface AeRunEvidenceSlice {
  runId?: string;
  taskId?: string;
  objective?: string;
  specimenId?: string;
  deliveryCandidateStatus?: string | null;
  primaryFailureCategory?: string | null;
  nanoRuntimeMode?: string | null;
  workerModel?: { modelName?: string } | string | null;
  priorAttempts?: Array<{ summary?: string; failureClass?: string }>;
  failedHypotheses?: string[];
  qcDelta?: { objectiveQcPassed?: boolean; summary?: string } | null;
  reviews?: Array<{ outcome?: string; defects?: string[] }>;
  score?: { pass?: boolean } | null;
  plans?: unknown[];
  acceptanceCriteria?: string[];
  evidencePath?: string;
}

function modelNameOf(slice: AeRunEvidenceSlice): string | null {
  if (!slice.workerModel) return null;
  if (typeof slice.workerModel === "string") return slice.workerModel;
  return slice.workerModel.modelName ?? null;
}

/**
 * Extract skill *candidates* from objective/plans/QC/diagnosis/strategies/reviews/AC/delivery.
 * Returns proposals only — never auto-validates.
 */
export function extractSkillCandidatesFromRun(
  slice: AeRunEvidenceSlice,
  opts: { allowExtraction?: boolean } = {},
): SkillCandidateProposal[] {
  const flags = resolveSkillOptFlags();
  if (opts.allowExtraction === false || !flags.extraction) return [];

  const proposals: SkillCandidateProposal[] = [];
  const refPath = slice.evidencePath ?? `run:${slice.runId ?? "unknown"}`;
  const modelId = modelNameOf(slice);
  const textBlob = [
    slice.objective,
    slice.primaryFailureCategory,
    ...(slice.failedHypotheses ?? []),
    ...(slice.priorAttempts ?? []).map((p) => `${p.failureClass ?? ""} ${p.summary ?? ""}`),
    JSON.stringify(slice.qcDelta ?? {}),
    JSON.stringify(slice.reviews ?? []),
  ]
    .join("\n")
    .toLowerCase();

  const push = (p: SkillCandidateProposal) => {
    const reject = shouldAutoRejectProposal(p.lesson, p.title);
    if (reject) {
      proposals.push({
        ...p,
        title: `[AUTO-REJECT-CANDIDATE] ${p.title}`,
        lesson: `${p.lesson}\n\nCURATOR_NOTE: ${reject}`,
        tags: [...p.tags, "auto_reject_suggested"],
        extractorNotes: reject,
      });
      return;
    }
    proposals.push(p);
  };

  // Positive: sync vs async assertion discipline
  if (
    /assert\.rejects|assert\.throws|async|promise|sync subject/.test(textBlob) ||
    /test_assertion|assertion_mode|node:test/.test(textBlob)
  ) {
    push({
      lessonType: "testing",
      modelScope: "model_independent",
      signature: normalizeFailureSignature("TEST_ASSERTION_MODE_MISMATCH:sync_vs_async"),
      title: "Sync vs async Node assertion",
      lesson:
        "For negative-path tests: sync subjects use assert.throws(() => ...); async/Promise subjects use await assert.rejects(...). Never mix modes.",
      antiPatterns: [
        "Using assert.rejects on a synchronous thrower",
        "Using assert.throws on a Promise-returning subject without awaiting",
      ],
      tags: ["node:test", "assert", "testing"],
      evidence: [
        {
          polarity: /ready|pass/.test(
            `${slice.deliveryCandidateStatus} ${slice.score?.pass}`,
          )
            ? "positive"
            : "negative",
          refPath,
          refKind: "run_json",
          runId: slice.runId,
          taskId: slice.taskId,
          summary: "Assertion mode lessons from AE run evidence",
        },
      ],
    });
  }

  // Positive: explicit AC cleanup closure
  if (
    /delete_file|dead (helper|shim|scaffolding)|cleanup|acceptance/.test(textBlob) ||
    (slice.acceptanceCriteria ?? []).some((c) => /remov|delet|dead|unused/i.test(c))
  ) {
    push({
      lessonType: "acceptance",
      modelScope: "model_independent",
      signature: normalizeFailureSignature("AC_CLEANUP_CLOSURE:explicit_delete"),
      title: "Explicit AC cleanup closure",
      lesson:
        "When acceptance criteria require removing unused dead helpers/shims and the path is authorized, include delete_file with a non-empty reason. Do not leave residual scaffolding.",
      antiPatterns: ["Leaving dead WORKAROUND/HACK shims after QC pass"],
      tags: ["acceptance", "cleanup"],
      evidence: [
        {
          polarity: slice.deliveryCandidateStatus === "ready" ? "positive" : "negative",
          refPath,
          refKind: "run_json",
          runId: slice.runId,
          taskId: slice.taskId,
        },
      ],
    });
  }

  // Diagnosis: persistent causal production failure prioritization
  if (
    /referenceerror|unbound|production|causal|priorit/.test(textBlob) ||
    slice.primaryFailureCategory
  ) {
    push({
      lessonType: "diagnosis",
      modelScope: "model_independent",
      signature: normalizeFailureSignature("DIAGNOSIS:persistent_causal_production_first"),
      title: "Persistent causal production failure prioritization",
      lesson:
        "Prioritize persistent causal production failures (e.g. unbound production imports) over harness-only noise when both appear. Signature-gate unbound guidance; do not always-on bias every plan.",
      antiPatterns: [
        "Always-on ReferenceError prompt lines without unbound evidence",
        "Blaming Vitest expect when node:test is the harness",
      ],
      tags: ["diagnosis", "prioritization"],
      evidence: [
        {
          polarity: "positive",
          refPath,
          refKind: "run_json",
          runId: slice.runId,
          taskId: slice.taskId,
          summary: slice.primaryFailureCategory ?? "diagnosis prioritization",
        },
      ],
    });
  }

  // Governance: avoid always-on heuristic prompt pollution
  if (/prompt pollution|always-on|shared.?path|unboundhint/.test(textBlob) || true) {
    // Always emit as institutional memory candidate from any completed capture —
    // curator decides; seed corpus also inserts explicitly.
    push({
      lessonType: "governance",
      modelScope: "model_independent",
      signature: normalizeFailureSignature("GOVERNANCE:avoid_always_on_prompt_pollution"),
      title: "Avoid always-on heuristic prompt pollution",
      lesson:
        "Do not append always-on repair heuristics to every planning prompt. Gate guidance on normalized failure signatures and task-relevant evidence.",
      antiPatterns: [
        "for (const skill of allSkills) prompt += skill",
        "Always tell Nano to import store.js",
      ],
      tags: ["governance", "prompt_hygiene"],
      evidence: [
        {
          polarity: "negative",
          refPath,
          refKind: "sot",
          runId: slice.runId,
          taskId: slice.taskId,
          summary: "Shared-path prompt pollution anti-pattern",
        },
      ],
    });
  }

  // Model-specific: Nemotron faithful invocation
  if (
    (modelId && /nemotron|nano/i.test(modelId)) ||
    slice.nanoRuntimeMode === "FAITHFUL"
  ) {
    push({
      lessonType: "model_invocation",
      modelScope: "model_specific",
      modelFamily: NEMOTRON_NANO_FAMILY,
      modelId: modelId ?? NEMOTRON_NANO_MODEL_ID,
      signature: normalizeFailureSignature("NEMOTRON:faithful_invocation_contract"),
      title: "Nemotron faithful invocation contract",
      lesson:
        "Use FAITHFUL Nano envelope: nano_v3 reasoning, qwen3_coder tools, auto tool choice, 256k context, NVIDIA sampling (think ON 1.0/1.0 ~10k for plan/diagnosis/review). Do not silently fall back to CONTROL.",
      antiPatterns: ["Running qualification under DEGRADED/CONTROL while claiming FAITHFUL"],
      tags: ["nemotron", "faithful", "invocation"],
      evidence: [
        {
          polarity: slice.nanoRuntimeMode === "FAITHFUL" ? "positive" : "negative",
          refPath,
          refKind: "run_json",
          runId: slice.runId,
          taskId: slice.taskId,
          summary: `nanoRuntimeMode=${slice.nanoRuntimeMode ?? "unknown"}`,
        },
      ],
    });

    push({
      lessonType: "runtime",
      modelScope: "model_specific",
      modelFamily: NEMOTRON_NANO_FAMILY,
      modelId: modelId ?? NEMOTRON_NANO_MODEL_ID,
      signature: normalizeFailureSignature("NEMOTRON:conditional_gbe_rescue"),
      title: "Nemotron conditional generation-budget rescue",
      lesson:
        "Keep primary path single-shot FAITHFUL. On GENERATION_BUDGET_EXHAUSTED only, apply FAITHFUL_SINGLE_SHOT_THEN_BUDGET_RESCUE. Do not enable global always-on 4k reasoning budget for qualification.",
      antiPatterns: [
        "ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET=4000 as default qualification path",
      ],
      tags: ["nemotron", "gbe", "rescue"],
      evidence: [
        {
          polarity: "positive",
          refPath,
          refKind: "run_json",
          runId: slice.runId,
          taskId: slice.taskId,
          summary: "Conditional rescue policy",
        },
      ],
    });
  }

  // Reject-worthy bad candidate example when pollution text appears
  if (/always tell nano to import store\.js/i.test(textBlob)) {
    push({
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
          refPath,
          refKind: "other",
          runId: slice.runId,
          summary: "Explicitly reject this class of lesson",
        },
      ],
    });
  }

  return proposals;
}
