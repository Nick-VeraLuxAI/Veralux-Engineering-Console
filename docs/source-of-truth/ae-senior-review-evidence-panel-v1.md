# AE Senior Review Evidence Panel Surface V1

Status: **IMPLEMENTED**  
Date: 2026-08-22  
Does **not** auto-run from the AE loop.  
Does **not** start or stop FreeToken / Nano.  
Does **not** add a database table, new frontend, or release gate.  
Does **not** let senior output approve, merge, or deploy.

UI: `src/components/engineer-console/evidence-bundle-panel.tsx` (`#senior-review-advisory`)  
Nav: Review workspace hash-nav / `RUN_PANEL_IDS.seniorReviewAdvisory` (`#senior-review-advisory`, label **Senior Review Advisory**)  
View model: `src/lib/engineer-console/senior-escalation/evidence-panel-view.ts`  
Persistence: `ae-senior-review-durable-evidence-v1.md`

### Final verdict

`SENIOR REVIEW EVIDENCE PANEL V1 COMPLETE`  
`ADVISORY ONLY`  
`EVIDENCE-BUNDLE SUMMARY ONLY`

---

## What V1 does

On an AE run, the Review workspace **Evidence bundle** panel shows a **Senior Review Advisory** section.

Source: `engineer_run_evidence_bundles.bundle_json.seniorReview` (the redacted public bundle already returned by `GET /api/engineer-console/runs/:id/evidence-bundle`).

It does **not** read `state_json` package snapshots, raw senior responses, or senior env/config.

Displayed when a leak-safe summary exists:

- status
- escalation reasons
- blocked reason labels
- root-cause / next-worker-mission previews
- QC gates / risk labels / warnings (if present and safe)
- updatedAt
- `advisoryOnly: true`
- `humanGatesStillRequired: true`

Copy: **Senior review is advisory only. Human approval gates remain required.**

Empty: **No senior review advisory evidence for this run.**

---

## Safety

- Unsafe strings (`127.0.0.1`, `:1919`, `:8081`, `:8082`, `ENGINEER_CONSOLE`, `/mnt/model-storage`, secrets) are stripped; a leaking view falls back to the empty state
- No raw package snapshot or full raw response
- No decision-record writes
- No PR / merge / deploy authority
- AE loop does not import this path

---

## Known V1 limitations

- The section appears only after an evidence bundle exists (Generate or refresh evidence)
- Older bundles without `seniorReview` show the empty state until regenerate
- Overview still has the request panel; this surface is display-only
- Hash-nav always includes **Senior Review Advisory**. If the evidence bundle is missing, the section is not mounted yet; the Review Evidence panel still receives the jump.

Related: `ae-senior-review-durable-evidence-v1.md`, `ae-senior-review-panel-v1.md`.
