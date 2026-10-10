"use client";

import React, { useMemo, useState } from "react";
import {
  formatAlignmentConfirmation,
  type AlignmentAnswer,
  type AlignmentQuestionnaireProposal,
} from "@/lib/engineer-console/dashboard/alignment-questionnaire";

const CUSTOM_ID = "custom";

export function AlignmentQuestionnaireForm({
  proposal,
  onContinue,
}: {
  proposal: AlignmentQuestionnaireProposal;
  onContinue: (message: string) => void;
}) {
  const defaults = useMemo(
    () =>
      Object.fromEntries(proposal.questions.map((question) => [question.id, question.recommendedId])) as Record<
        string,
        string
      >,
    [proposal.questions],
  );
  const [selected, setSelected] = useState<Record<string, string>>(defaults);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const answers: AlignmentAnswer[] = proposal.questions.map((question) => {
    const optionId = selected[question.id] ?? question.recommendedId;
    const customText = optionId === CUSTOM_ID ? custom[question.id] : undefined;
    return { questionId: question.id, optionId, customText };
  });
  const ready = answers.every((answer) =>
    answer.optionId === CUSTOM_ID ? Boolean(answer.customText?.trim()) : Boolean(answer.optionId),
  );

  function continueWithAnswers() {
    if (!ready || done) return;
    setDone(true);
    onContinue(formatAlignmentConfirmation(proposal, answers));
  }

  return (
    <div data-alignment-questionnaire="true" className="space-y-3">
      {proposal.jobTitles.length ? (
        <div className="flex flex-wrap gap-1.5">
          {proposal.jobTitles.map((title) => (
            <span
              key={title}
              className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/70"
            >
              {title}
            </span>
          ))}
        </div>
      ) : null}
      {proposal.questions.map((question, index) => {
        const value = selected[question.id] ?? question.recommendedId;
        return (
          <section
            key={question.id}
            data-alignment-question={question.id}
            className="rounded-[1rem] border border-white/8 bg-white/[0.03] p-3"
          >
            <p className="text-[12px] uppercase tracking-[0.1em] text-white/60">Question {index + 1}</p>
            <p className="mt-1 text-[13px] font-medium text-white">{question.prompt}</p>
            <div className="mt-2 space-y-1.5">
              {question.options.map((option) => {
                const active = value === option.id;
                const recommended = option.id === question.recommendedId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={done}
                    data-alignment-option={option.id}
                    data-alignment-recommended={recommended ? "true" : "false"}
                    onClick={() => setSelected((current) => ({ ...current, [question.id]: option.id }))}
                    className={`flex w-full items-start gap-2 rounded-[0.85rem] border px-2.5 py-2 text-left text-[12px] leading-5 transition ${
                      active
                        ? "border-white/25 bg-white/[0.08] text-white"
                        : "border-white/8 bg-transparent text-white/70 hover:border-white/16 hover:text-white"
                    }`}
                  >
                    <span
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border ${
                        active ? "border-white bg-white" : "border-white/30"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span>{option.label}</span>
                        {recommended ? (
                          <span className="rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200/90">
                            Recommended
                          </span>
                        ) : null}
                      </span>
                      {option.detail ? <span className="mt-0.5 block text-[13px] text-white/60">{option.detail}</span> : null}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                disabled={done}
                data-alignment-option={CUSTOM_ID}
                onClick={() => setSelected((current) => ({ ...current, [question.id]: CUSTOM_ID }))}
                className={`flex w-full items-start gap-2 rounded-[0.85rem] border px-2.5 py-2 text-left text-[12px] leading-5 ${
                  value === CUSTOM_ID
                    ? "border-white/25 bg-white/[0.08] text-white"
                    : "border-white/8 text-white/70 hover:border-white/16 hover:text-white"
                }`}
              >
                <span
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border ${
                    value === CUSTOM_ID ? "border-white bg-white" : "border-white/30"
                  }`}
                />
                <span>Write your own answer</span>
              </button>
              {value === CUSTOM_ID ? (
                <textarea
                  data-alignment-custom={question.id}
                  disabled={done}
                  value={custom[question.id] ?? ""}
                  onChange={(event) =>
                    setCustom((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                  rows={2}
                  placeholder="Your answer"
                  className="mt-1 w-full rounded-[0.85rem] border border-white/10 bg-black/30 px-2.5 py-2 text-[13px] text-white placeholder:text-white/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                />
              ) : null}
            </div>
          </section>
        );
      })}
      <button
        type="button"
        data-alignment-continue="true"
        disabled={!ready || done}
        onClick={continueWithAnswers}
        className="inline-flex rounded-full border border-white/12 bg-white/[0.08] px-3 py-1.5 text-[12px] text-white disabled:opacity-40"
      >
        {done ? "Continued" : "Continue with these answers"}
      </button>
    </div>
  );
}
