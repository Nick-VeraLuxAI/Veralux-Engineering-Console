import React from "react";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";
import { Surface } from "@/components/ui/surface";
import type {
  PlaybookRecommendation,
  RunIntelligenceSummary,
} from "@/lib/engineer-console/intelligence/danger-point-types";

function badgeVariantForRisk(riskLevel: RunIntelligenceSummary["riskLevel"]) {
  switch (riskLevel) {
    case "critical":
      return "blocked";
    case "high":
      return "warning";
    case "medium":
      return "warning";
    default:
      return "ready";
  }
}

function badgeVariantForConfidence(confidenceLevel: RunIntelligenceSummary["confidenceLevel"]) {
  switch (confidenceLevel) {
    case "high":
      return "ready";
    case "medium":
      return "warning";
    default:
      return "muted";
  }
}

function badgeVariantForEscalation(escalationLevel: RunIntelligenceSummary["escalationLevel"]) {
  switch (escalationLevel) {
    case "blocked":
      return "blocked";
    case "senior_approval":
    case "required_review_stage":
    case "operator_review":
      return "warning";
    default:
      return "ready";
  }
}

function PlaybookList({ playbooks }: { playbooks: PlaybookRecommendation[] }) {
  if (playbooks.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No future playbooks are suggested from the current run signals.
      </p>
    );
  }

  return (
    <ul className="space-y-2 text-sm">
      {playbooks.map((playbook) => (
        <li
          key={playbook.playbookId}
          className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-white">{playbook.title}</p>
            <Badge size="sm" variant={playbook.safetyLevel === "safe" ? "ready" : "warning"}>
              {playbook.safetyLevel.replace(/_/g, " ")}
            </Badge>
          </div>
          <p className="mt-2 text-[var(--muted)]">{playbook.description}</p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            {playbook.requiresHumanConfirmation ? "Requires human confirmation" : "Could be safe to automate later"}
            {playbook.targetPanelAnchor ? (
              <>
                {" "}
                · <a href={`#${playbook.targetPanelAnchor}`} className="underline underline-offset-2">
                  Open panel
                </a>
              </>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function RunIntelligenceCard({ summary }: { summary: RunIntelligenceSummary }) {
  return (
    <Surface
      as="section"
      className="scroll-mt-28"
      data-run-intelligence-card="true"
      aria-labelledby="run-intelligence-card-heading"
    >
      <SectionHeader
        title="Run Intelligence"
        description="Read-only risk interpretation layered on top of the existing governed workflow. This card does not approve, merge, deploy, or bypass any gate."
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.9fr)]">
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge size="md" variant={badgeVariantForRisk(summary.riskLevel)}>
                Risk: {summary.riskLevel}
              </Badge>
              <Badge size="md" variant={badgeVariantForConfidence(summary.confidenceLevel)}>
                Confidence: {summary.confidenceLevel}
              </Badge>
              <Badge size="md" variant={badgeVariantForEscalation(summary.escalationLevel)}>
                Escalation: {summary.escalationLevel.replace(/_/g, " ")}
              </Badge>
              <Badge size="md" variant="muted">
                Danger points: {summary.dangerPoints.length}
              </Badge>
            </div>

            <p className="mt-4 text-base font-medium text-white">{summary.operatorSummary}</p>
            <p className="mt-3 text-sm text-[var(--muted)]">{summary.whyThisMatters}</p>

            <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-3">
              <p className="text-sm text-[var(--muted)]">Recommended next action</p>
              <p className="mt-1 text-sm font-medium text-white">{summary.recommendedNextAction}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">{summary.escalationReason}</p>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-white">Top danger points</h3>
              <p className="text-xs text-[var(--muted)]">{summary.changedFileRiskSummary.summary}</p>
            </div>
            {summary.dangerPoints.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">
                No material danger points were normalized from the current run signals.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {summary.dangerPoints.slice(0, 5).map((dangerPoint) => (
                  <li
                    key={dangerPoint.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge size="sm" variant={badgeVariantForRisk(dangerPoint.severity === "critical" ? "critical" : dangerPoint.severity === "high" ? "high" : dangerPoint.severity === "medium" ? "medium" : "low")}>
                        {dangerPoint.severity}
                      </Badge>
                      <Badge size="sm" variant="muted">
                        {dangerPoint.category.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm font-medium text-white">{dangerPoint.title}</p>
                    <p className="mt-2 text-sm text-[var(--muted)]">{dangerPoint.explanation}</p>
                    <p className="mt-2 text-xs text-[var(--muted)]">Next: {dangerPoint.recommendedAction}</p>
                    {dangerPoint.anchorTarget ? (
                      <a
                        href={`#${dangerPoint.anchorTarget}`}
                        className="mt-2 inline-flex text-xs text-white underline underline-offset-2"
                      >
                        Open supporting panel
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <h3 className="text-sm font-semibold text-white">Suggested playbooks</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Recommendation-only in A1. Nothing runs automatically from this card.
            </p>
            <div className="mt-3">
              <PlaybookList playbooks={summary.playbookRecommendations} />
            </div>
          </div>

          <details className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <summary className="cursor-pointer text-sm font-semibold text-white">
              Technical details
            </summary>
            <div className="mt-4 space-y-4 text-sm text-[var(--muted)]">
              <div>
                <p className="font-medium text-white">Risk reasons</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {summary.riskReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium text-white">Signals already on the run page/API</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {summary.signalAudit.availableOnRunPage.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium text-white">Signals derived locally for A1</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {summary.signalAudit.derivedLocally.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium text-white">Current signal snapshot</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {summary.technicalDetails.taskSignals
                    .concat(summary.technicalDetails.verificationSignals)
                    .concat(summary.technicalDetails.releaseSignals)
                    .concat(summary.technicalDetails.derivedNotes)
                    .map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                </ul>
              </div>
            </div>
          </details>
        </div>
      </div>
    </Surface>
  );
}
