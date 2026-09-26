import type { SeniorReviewResponse, SeniorReviewRisks } from "./invoke-types";

export function extractJsonValue(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || content.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("No JSON object found");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map((item) => (typeof item === "string" ? item : null));
  if (items.some((item) => item === null)) return null;
  return items as string[];
}

function asRisks(value: unknown): SeniorReviewRisks | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const approval = asString(record.approval) ?? "";
  const security = asString(record.security) ?? "";
  const dataContract = asString(record.dataContract) ?? "";
  return { approval, security, dataContract };
}

export function parseSeniorReviewResponse(content: string): {
  parsedReview: SeniorReviewResponse | null;
  warning: "unparseable_json" | null;
} {
  try {
    const raw = extractJsonValue(content);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { parsedReview: null, warning: "unparseable_json" };
    }
    const record = raw as Record<string, unknown>;
    const rootCause = asString(record.rootCause);
    const symptomPatchVsRealFix = asString(record.symptomPatchVsRealFix);
    const missingEvidence = asStringArray(record.missingEvidence);
    const nextWorkerMission = asString(record.nextWorkerMission);
    const recommendedWorkerProfile = asString(record.recommendedWorkerProfile);
    const qcGates = asStringArray(record.qcGates);
    const risks = asRisks(record.risks);
    if (
      !rootCause
      || !symptomPatchVsRealFix
      || !missingEvidence
      || !nextWorkerMission
      || !recommendedWorkerProfile
      || !qcGates
      || !risks
    ) {
      return { parsedReview: null, warning: "unparseable_json" };
    }
    return {
      parsedReview: {
        rootCause,
        symptomPatchVsRealFix,
        missingEvidence,
        nextWorkerMission,
        recommendedWorkerProfile,
        qcGates,
        risks,
        humanGatesStillRequired: true,
      },
      warning: null,
    };
  } catch {
    return { parsedReview: null, warning: "unparseable_json" };
  }
}
