# Engineering Console operator glossary

Plain-English definitions for the operator-facing terms used across setup, run, governance, PR, and release panels. This glossary complements the inline help disclosures in the UI.

---

## Setup and repo terms

### Setup readiness

- **Plain English:** A read-only checklist of whether the environment and repo setup are ready for onboarding or staging work.
- **Why it matters:** It helps the operator catch missing setup before creating tasks or starting runs.
- **What to do next:** Review missing or warning items first, then follow the next-action hint in each row.

### Approved repo roots

- **Plain English:** The top-level folders the console is allowed to register repositories from.
- **Why it matters:** They enforce workspace boundaries.
- **What to do next:** Register repos only from paths inside these roots.

### File index

- **Plain English:** A metadata scan of repository files such as paths, sizes, hashes, and detected languages.
- **Why it matters:** Later repo intelligence depends on knowing which files exist.
- **What to do next:** Verify the repo first, then run file index.

### Code index

- **Plain English:** A searchable record of symbols and code chunks built from indexed files.
- **Why it matters:** It powers better code search and compatibility analysis.
- **What to do next:** Run file index first, then run code index.

### Compatibility analysis

- **Plain English:** A read-only comparison of cross-repo interfaces and possible impact between registered repos.
- **Why it matters:** It helps the operator see whether one repo’s change may affect another.
- **What to do next:** Run code index first, then review compatibility findings before approval or release work.

---

## Run and governance terms

### Worker plan

- **Plain English:** A reviewed list of file operations the run is allowed to perform.
- **Why it matters:** It makes the proposed work explicit before execution.
- **What to do next:** Review summary, allowed files, and operations before validation and execution.

### Quality gates

- **Plain English:** Recorded checks such as tests, build, or lint that show whether the run passed validation.
- **Why it matters:** Failed or missing gates are a strong sign the run should not move forward yet.
- **What to do next:** Review failing checks and confirm the latest recorded results are acceptable.

### Evidence bundle

- **Plain English:** A saved snapshot of the run facts used for review and audit.
- **Why it matters:** Policy, replay, approval, and sign-off depend on this record.
- **What to do next:** Generate or refresh evidence before approval or release work.

### Replay verification

- **Plain English:** A check that the saved run record can be replayed and validated from stored evidence.
- **Why it matters:** It helps prove the run history is internally consistent.
- **What to do next:** Run replay verification and review warnings or failures before continuing.

### Governance policy

- **Plain English:** The rule set that decides whether the run can be approved, needs senior review, or is blocked.
- **Why it matters:** It tells the operator whether human review can proceed now.
- **What to do next:** Evaluate policy and complete any required review work before approval.

### Review stages

- **Plain English:** Named review checkpoints that capture whether required human review has been completed.
- **Why it matters:** Required stages can block final approval.
- **What to do next:** Generate or refresh stages after policy evaluation, then complete the required ones.

### Approval report

- **Plain English:** The detailed review record that summarizes what changed and whether the run is ready for a human decision.
- **Why it matters:** It is the deeper approval context behind the top approval controls.
- **What to do next:** Read the report details, then record the human decision if the run is ready.

### Audit chain

- **Plain English:** A tamper-evident history of the recorded actions and decisions for the run.
- **Why it matters:** If the audit chain does not verify cleanly, the technical audit needs review before the run should proceed.
- **What to do next:** Review the audit timeline and any chain verification failures before continuing release work.

### Technical audit

- **Plain English:** The technical record of audit history and verification details for the run.
- **Why it matters:** It helps advanced operators inspect whether stored history is complete and internally consistent.
- **What to do next:** Open the technical audit group when other panels mention audit issues.

---

## PR and release terms

### PR readiness

- **Plain English:** A check that the run has the records and state needed to open or retry a safe draft pull request.
- **Why it matters:** It prevents PR creation before evidence, approval, replay, and review state are in order.
- **What to do next:** Check PR readiness, resolve blockers or warnings, then create or retry the draft PR.

### Release gates

- **Plain English:** Fail-closed rules that block merge, deployment, or sign-off when required release conditions are not met.
- **Why it matters:** They stop late-stage actions from proceeding when checklist, replay, policy, or health requirements are unresolved.
- **What to do next:** Use the action checklist to clear blockers before merge, deployment, or sign-off.

### Deployment health policy

- **Plain English:** A rule-based interpretation of post-deployment health check results.
- **Why it matters:** It translates raw health checks into a governance decision about whether release work should continue.
- **What to do next:** Evaluate health policy after health checks run, then review warnings or blockers.

### Release checklist

- **Plain English:** A stored summary of what release requirements are complete, blocked, or still need attention.
- **Why it matters:** It is the main readiness snapshot before sign-off.
- **What to do next:** Check the checklist, resolve blockers, and review attention items before sign-off.

### Release sign-off

- **Plain English:** The final human go / no-go record for the release flow.
- **Why it matters:** It documents the admin decision after checklist, replay, policy, and other controls are reviewed.
- **What to do next:** Choose the right decision, add rationale when required, and confirm the latest checklist state first.

---

## Important note

The glossary adds plain-English guidance, but it does **not** replace raw technical statuses. The UI still preserves advanced details such as raw readiness states, policy statuses, gate statuses, health-policy results, audit-chain verification, and other technical context needed for governed operation.
