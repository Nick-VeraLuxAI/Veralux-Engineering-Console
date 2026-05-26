export const REQUIRED_OPERATOR_GLOSSARY_TERMS = [
  "worker_plan",
  "quality_gates",
  "evidence_bundle",
  "replay_verification",
  "governance_policy",
  "review_stages",
  "approval_report",
  "pr_readiness",
  "release_gates",
  "deployment_health_policy",
  "release_checklist",
  "release_signoff",
  "audit_chain",
  "compatibility_analysis",
  "code_index",
  "file_index",
  "approved_repo_roots",
] as const;

export const EXTRA_OPERATOR_GLOSSARY_TERMS = [
  "setup_readiness",
  "technical_audit",
] as const;

export type OperatorGlossaryTermId =
  | (typeof REQUIRED_OPERATOR_GLOSSARY_TERMS)[number]
  | (typeof EXTRA_OPERATOR_GLOSSARY_TERMS)[number];

export interface OperatorGlossaryEntry {
  term: OperatorGlossaryTermId;
  shortLabel: string;
  plainEnglish: string;
  whyItMatters: string;
  operatorAction: string;
  advancedMeaning?: string;
}

export const OPERATOR_GLOSSARY: Record<OperatorGlossaryTermId, OperatorGlossaryEntry> = {
  setup_readiness: {
    term: "setup_readiness",
    shortLabel: "Setup readiness",
    plainEnglish:
      "A read-only checklist of the environment, repo, and indexing signals that tell you whether onboarding or staging work can start safely.",
    whyItMatters:
      "It helps the operator catch missing setup before they create tasks, start runs, or test release flow steps.",
    operatorAction:
      "Review missing or warning items first, then use the suggested next action in each row.",
    advancedMeaning:
      "This panel summarizes safe config and database state only. It does not expose secrets or perform checks that mutate the system.",
  },
  approved_repo_roots: {
    term: "approved_repo_roots",
    shortLabel: "Approved repo roots",
    plainEnglish:
      "The top-level folders the console is allowed to register repositories from.",
    whyItMatters:
      "They enforce workspace boundaries so operators cannot point the console at arbitrary local paths in staging or production.",
    operatorAction:
      "Register repositories only from paths inside these roots. If the list is missing in staging or production, fix config first.",
    advancedMeaning:
      "These roots come from ENGINEER_CONSOLE_REPO_ROOTS. Path validation still happens server-side even if the UI explains it more clearly.",
  },
  file_index: {
    term: "file_index",
    shortLabel: "File index",
    plainEnglish:
      "A metadata scan of repository files, such as paths, sizes, hashes, and detected languages.",
    whyItMatters:
      "Later steps like code index, compatibility analysis, and review context depend on knowing which files exist.",
    operatorAction:
      "Verify the repository first, then run file index before moving on to code index.",
    advancedMeaning:
      "The file index stores metadata only. It is not a commit, patch, or repo mutation.",
  },
  code_index: {
    term: "code_index",
    shortLabel: "Code index",
    plainEnglish:
      "A searchable record of symbols and code chunks built from the indexed files in a repository.",
    whyItMatters:
      "Compatibility analysis and deeper model context work better when the console can reference functions, classes, and code chunks.",
    operatorAction:
      "Run file index first, then run code index. Re-run it after major code changes when you need fresh code context.",
    advancedMeaning:
      "The code index stores extracted symbols and bounded content previews. It does not execute code or change repository files.",
  },
  compatibility_analysis: {
    term: "compatibility_analysis",
    shortLabel: "Compatibility analysis",
    plainEnglish:
      "A read-only comparison of cross-repo interfaces, links, and possible impact between registered repositories.",
    whyItMatters:
      "It helps operators see whether a change could affect another repository before approval or release work continues.",
    operatorAction:
      "Run code index first, then run compatibility analysis and review warnings or breaking links before moving forward.",
    advancedMeaning:
      "This analysis records detected API surfaces and cross-repo links. It does not rewrite code or apply fixes.",
  },
  worker_plan: {
    term: "worker_plan",
    shortLabel: "Worker plan",
    plainEnglish:
      "A reviewed list of file operations the run is allowed to perform.",
    whyItMatters:
      "It makes the proposed work explicit before execution so operators can validate scope and safety.",
    operatorAction:
      "Review the summary, allowed files, and operations, then validate or adjust the plan before execution.",
    advancedMeaning:
      "The worker plan is the structured execution contract for the run. It is separate from the model draft and from final approval.",
  },
  quality_gates: {
    term: "quality_gates",
    shortLabel: "Quality gates",
    plainEnglish:
      "Recorded checks such as tests, build, or lint that show whether the run passed the expected validation steps.",
    whyItMatters:
      "Failed or missing quality gates are a strong signal that the run should not move into approval, PR, or release work yet.",
    operatorAction:
      "Review failing checks, fix the underlying issue, and confirm the latest recorded gate results are acceptable before continuing.",
    advancedMeaning:
      "These are stored run artifacts with raw commands, statuses, exit codes, and truncated logs.",
  },
  evidence_bundle: {
    term: "evidence_bundle",
    shortLabel: "Evidence bundle",
    plainEnglish:
      "A saved snapshot of the run facts used for review and audit.",
    whyItMatters:
      "Policy, replay, approval, and sign-off depend on this record to show what happened in the run.",
    operatorAction:
      "Generate or refresh evidence before approval or release work so reviewers have a current record.",
    advancedMeaning:
      "The bundle includes run, worker-plan, gate, governance, approval, and audit references along with a bundle hash.",
  },
  replay_verification: {
    term: "replay_verification",
    shortLabel: "Replay verification",
    plainEnglish:
      "A check that the run record can be replayed and validated from the saved evidence and package data.",
    whyItMatters:
      "It helps prove the run history is consistent before approval, PR creation, or sign-off.",
    operatorAction:
      "Run replay verification and review warnings or failures before moving deeper into release flow steps.",
    advancedMeaning:
      "Replay verification evaluates stored replay-package data and records per-check results without changing the repository.",
  },
  governance_policy: {
    term: "governance_policy",
    shortLabel: "Governance policy",
    plainEnglish:
      "The rule set that decides whether the run can be approved, needs senior review, or is blocked.",
    whyItMatters:
      "It tells the operator whether human review can proceed now or whether more evidence, replay, or review stages are required first.",
    operatorAction:
      "Evaluate policy, read blockers and warnings, and complete any required review work before approval.",
    advancedMeaning:
      "The panel shows the stored policy version, hash prefix, raw status, and recommended next action from policy evaluation.",
  },
  review_stages: {
    term: "review_stages",
    shortLabel: "Review stages",
    plainEnglish:
      "Named review checkpoints that capture whether required human review has been completed.",
    whyItMatters:
      "Required review stages can block final approval even when the run looks otherwise healthy.",
    operatorAction:
      "Generate or refresh stages after policy evaluation, then complete required stages with the right rationale and reviewer action.",
    advancedMeaning:
      "Stages preserve reviewer labels, notes, policy references, evidence references, and per-stage status history.",
  },
  approval_report: {
    term: "approval_report",
    shortLabel: "Approval report",
    plainEnglish:
      "The detailed review record that summarizes what changed and whether the run is ready for a human decision.",
    whyItMatters:
      "It is the deeper approval context behind the top-level approval actions and recommended next step.",
    operatorAction:
      "Read the report details, confirm scope and governance state, then record the human approval decision if appropriate.",
    advancedMeaning:
      "The report includes diff summary, worker-plan outcome, governance issues, and approval guidance used by the approval actions.",
  },
  pr_readiness: {
    term: "pr_readiness",
    shortLabel: "PR readiness",
    plainEnglish:
      "A check that the run has the records and state needed to open or retry a safe draft pull request.",
    whyItMatters:
      "It prevents operators from creating PRs before the run has evidence, approval, replay, and review state in order.",
    operatorAction:
      "Check PR readiness, resolve blockers or warnings, then create or retry the draft PR.",
    advancedMeaning:
      "The technical details still expose raw readiness status, branch state, review-stage counts, and related signals.",
  },
  release_gates: {
    term: "release_gates",
    shortLabel: "Release gates",
    plainEnglish:
      "The fail-closed rules that block merge, deployment, or sign-off when required release conditions are not met.",
    whyItMatters:
      "They stop late-stage actions from proceeding when checklist, replay, policy, or health requirements are still unresolved.",
    operatorAction:
      "Use the action checklist to clear blockers before merge, deployment, or sign-off.",
    advancedMeaning:
      "Raw gate signals still show checklist status, sign-off state, replay status, policy status, and health-policy status.",
  },
  deployment_health_policy: {
    term: "deployment_health_policy",
    shortLabel: "Deployment health policy",
    plainEnglish:
      "A rule-based interpretation of post-deployment health check results.",
    whyItMatters:
      "It translates raw health checks into a governance decision about whether release work should continue.",
    operatorAction:
      "Evaluate health policy after health checks run, then review warnings or blockers before sign-off.",
    advancedMeaning:
      "The panel preserves raw health-check status, HTTP status, latency, policy version, and recommended action.",
  },
  release_checklist: {
    term: "release_checklist",
    shortLabel: "Release checklist",
    plainEnglish:
      "A stored summary of what release requirements are complete, blocked, or still need attention.",
    whyItMatters:
      "It is the operator’s main readiness snapshot before release sign-off.",
    operatorAction:
      "Check the checklist, resolve blockers, and review attention items before recording sign-off.",
    advancedMeaning:
      "Checklist evaluations store per-item status, severity, evidence references, and an overall readiness status.",
  },
  release_signoff: {
    term: "release_signoff",
    shortLabel: "Release sign-off",
    plainEnglish:
      "The final human go / no-go record for the release flow.",
    whyItMatters:
      "It documents the admin decision after checklist, replay, policy, and other release controls are reviewed.",
    operatorAction:
      "Choose the right decision, record rationale when required, and confirm the latest checklist state first.",
    advancedMeaning:
      "Sign-off records the decision and supporting snapshot data. It does not deploy, merge, or trigger CI/CD by itself.",
  },
  audit_chain: {
    term: "audit_chain",
    shortLabel: "Audit chain",
    plainEnglish:
      "A tamper-evident history of the recorded actions and decisions for the run.",
    whyItMatters:
      "If the audit chain does not verify cleanly, the technical audit needs review before the run should proceed.",
    operatorAction:
      "Check the audit timeline, review any verification failures, and treat a failed chain as a technical issue to resolve before release work continues.",
    advancedMeaning:
      "The timeline preserves event types, actors, entity references, and chain-hash prefixes used for verification.",
  },
  technical_audit: {
    term: "technical_audit",
    shortLabel: "Technical audit",
    plainEnglish:
      "The technical record of audit history and verification details for the run.",
    whyItMatters:
      "It helps advanced operators inspect whether the stored history is complete and internally consistent.",
    operatorAction:
      "Open technical audit when the command center, current action zone, or release panels mention audit issues.",
    advancedMeaning:
      "This group exposes lower-level audit evidence, including timeline entries and chain verification failures.",
  },
};

export const OPERATOR_GLOSSARY_LIST = Object.values(OPERATOR_GLOSSARY);

export function getOperatorGlossaryTerm(term: OperatorGlossaryTermId): OperatorGlossaryEntry {
  return OPERATOR_GLOSSARY[term];
}
