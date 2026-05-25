import React from "react";
import {
  getOperatorGlossaryTerm,
  type OperatorGlossaryTermId,
} from "@/lib/engineer-console/ux/operator-glossary";

export function OperatorHelp({
  term,
  label,
  className,
}: {
  term: OperatorGlossaryTermId;
  label: string;
  className?: string;
}) {
  const entry = getOperatorGlossaryTerm(term);

  return (
    <details
      className={`group inline-block text-left ${className ?? ""} [&_summary::-webkit-details-marker]:hidden`}
    >
      <summary className="cursor-pointer list-none">
        <span className="inline-flex rounded border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)] transition group-open:text-white">
          {label}
        </span>
      </summary>
      <div className="mt-2 max-w-md rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-xs text-[var(--muted)] shadow-sm">
        <p>
          <span className="font-medium text-white">Plain English: </span>
          {entry.plainEnglish}
        </p>
        <p className="mt-2">
          <span className="font-medium text-white">Why it matters: </span>
          {entry.whyItMatters}
        </p>
        <p className="mt-2">
          <span className="font-medium text-white">What to do next: </span>
          {entry.operatorAction}
        </p>
        {entry.advancedMeaning ? (
          <p className="mt-2">
            <span className="font-medium text-white">Technical meaning: </span>
            {entry.advancedMeaning}
          </p>
        ) : null}
      </div>
    </details>
  );
}
