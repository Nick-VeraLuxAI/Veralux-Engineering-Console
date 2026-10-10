import type { MultitaskFleetProposal } from "./multitask-fleet-intent";

export type AlignmentOption = {
  id: string;
  label: string;
  detail?: string;
};

export type AlignmentQuestion = {
  id: string;
  prompt: string;
  recommendedId: string;
  allowCustom: true;
  options: AlignmentOption[];
};

export type AlignmentQuestionnaireProposal = {
  type: "alignment_questionnaire";
  jobTitles: string[];
  questions: AlignmentQuestion[];
};

export type AlignmentAnswer = {
  questionId: string;
  optionId: string;
  customText?: string;
};

export function workingRepoNameFromBrief(brief?: string | null): string | null {
  const match = brief?.match(/Working repository:\s*([^(.\n]+)/i);
  const name = match?.[1]?.trim();
  return name || null;
}

export function fleetJobTitles(proposal: MultitaskFleetProposal): string[] {
  return proposal.items
    .map((item) => (item.type === "start_repo" ? item.name : item.title))
    .filter((title): title is string => Boolean(title?.trim()));
}

export function buildAlignmentQuestionnaire(
  proposal: MultitaskFleetProposal,
  input: { workingRepoName?: string | null } = {},
): AlignmentQuestionnaireProposal {
  const titles = fleetJobTitles(proposal);
  const count = proposal.items.length;
  const repoName = input.workingRepoName?.trim() || null;
  const listed = titles.length ? titles.map((title) => `“${title}”`).join(", ") : `${count} jobs`;

  return {
    type: "alignment_questionnaire",
    jobTitles: titles,
    questions: [
      {
        id: "objective",
        prompt: "What should exist when this split is done?",
        recommendedId: "keep-proposed",
        allowCustom: true,
        options: [
          {
            id: "keep-proposed",
            label: `Keep all ${count} jobs as proposed`,
            detail: listed,
          },
          {
            id: "keep-narrow",
            label: "Keep these jobs, but tighten each objective",
            detail: "Same titles. Rewrite each body so the work is bounded.",
          },
          {
            id: "merge-fewer",
            label: "Merge into fewer jobs",
            detail: "Too many cards. Combine overlapping work.",
          },
        ],
      },
      {
        id: "repository",
        prompt: "Which repository should these jobs use?",
        recommendedId: repoName ? "use-working" : "select-first",
        allowCustom: true,
        options: repoName
          ? [
              {
                id: "use-working",
                label: `Use ${repoName} for every job`,
                detail: "The selected working repo is the target.",
              },
              {
                id: "working-now-split-later",
                label: `Start on ${repoName}, split repos later if needed`,
              },
              {
                id: "different-repo",
                label: "A different registered repo",
                detail: "Say which repo in Your answer.",
              },
            ]
          : [
              {
                id: "select-first",
                label: "Select a working repo before creating tasks",
                detail: "No working repo is selected yet.",
              },
              {
                id: "name-repo",
                label: "I will name the repo in Your answer",
              },
            ],
      },
      {
        id: "success",
        prompt: "How will we know each job worked?",
        recommendedId: "job-criteria",
        allowCustom: true,
        options: [
          {
            id: "job-criteria",
            label: "Use the acceptance criteria already listed on each job",
          },
          {
            id: "tests-required",
            label: "Each job must land with tests that cover the criteria",
          },
          {
            id: "inspectable",
            label: "Tests plus something a human can inspect in the console",
          },
        ],
      },
      {
        id: "constraints",
        prompt: "What must we not touch?",
        recommendedId: "safety-defaults",
        allowCustom: true,
        options: [
          {
            id: "safety-defaults",
            label: "Do not start runs, change Docker, change model routing, or change senior review",
          },
          {
            id: "drafts-only",
            label: "Draft tasks only. No file edits until a human starts a run.",
          },
          {
            id: "narrow-scope",
            label: "Stay inside the jobs listed. Do not expand scope.",
          },
        ],
      },
      {
        id: "commencement",
        prompt: "What should happen after you continue?",
        recommendedId: "open-drafts",
        allowCustom: true,
        options: [
          {
            id: "open-drafts",
            label: "Open draft-task cards. One fleet checkbox can start every run.",
          },
          {
            id: "plan-only",
            label: "Do not open cards yet. Restate the plan and wait.",
          },
        ],
      },
    ],
  };
}

export function alignmentIntroReply(proposal: AlignmentQuestionnaireProposal): string {
  const count = proposal.jobTitles.length || "these";
  return `I can split this into ${count} console jobs. Pick an answer for each question. Recommended choices are marked. Then continue. I will not open cards, start a run, or spawn workers until you continue.`;
}

export function parseAlignmentQuestionnaire(value: unknown): AlignmentQuestionnaireProposal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.type !== "alignment_questionnaire" || !Array.isArray(record.questions)) return undefined;
  const jobTitles = Array.isArray(record.jobTitles)
    ? record.jobTitles.filter((title): title is string => typeof title === "string" && Boolean(title.trim()))
    : [];
  const questions = record.questions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const question = item as Record<string, unknown>;
    if (typeof question.id !== "string" || typeof question.prompt !== "string") return [];
    if (typeof question.recommendedId !== "string" || !Array.isArray(question.options)) return [];
    const options = question.options.flatMap((option) => {
      if (!option || typeof option !== "object") return [];
      const next = option as Record<string, unknown>;
      if (typeof next.id !== "string" || typeof next.label !== "string") return [];
      return [
        {
          id: next.id,
          label: next.label,
          detail: typeof next.detail === "string" ? next.detail : undefined,
        },
      ];
    });
    if (options.length < 2) return [];
    return [
      {
        id: question.id,
        prompt: question.prompt,
        recommendedId: question.recommendedId,
        allowCustom: true as const,
        options,
      },
    ];
  });
  if (questions.length < 2) return undefined;
  return { type: "alignment_questionnaire", jobTitles, questions };
}

export function formatAlignmentConfirmation(
  questionnaire: AlignmentQuestionnaireProposal,
  answers: AlignmentAnswer[],
): string {
  const lines = questionnaire.questions.map((question) => {
    const answer = answers.find((entry) => entry.questionId === question.id);
    const option = question.options.find((entry) => entry.id === answer?.optionId);
    const custom = answer?.customText?.trim();
    const label = custom || option?.label || "No answer";
    return `- ${question.prompt} ${label}`;
  });
  const commencement = answers.find((entry) => entry.questionId === "commencement");
  const planOnly = commencement?.optionId === "plan-only";
  if (planOnly) {
    return ["Hold. Do not open confirm cards yet.", ...lines].join("\n");
  }
  return ["go ahead", "", "Aligned answers:", ...lines].join("\n");
}
