# Engineering Console — End-to-end demo script

**Duration:** 45–75 minutes (live) or 20 minutes (abbreviated)  
**Audience:** Engineering leadership, security, release ops  
**Goal:** Show governed AI-assisted change from repo intake through release sign-off without implying autonomous deploy.

**Demo repo assumption:** A small real git repo under your allowlist (e.g. internal service with `npm test`). Use **mock** model provider for reliability unless Kimi is pre-verified.

---

## Scenario narrative

> “An operator receives a task to add a documented config flag. The model proposes a worker plan; a human reviews and executes it. Quality gates and governance run automatically. After admin approval and review stages, we open a PR, merge, deploy to staging with a fixed profile, verify health, evaluate the release checklist, and record admin sign-off — all with an audit trail and evidence bundle.”

---

## Pre-demo checklist (15 min before)

- [ ] `npm install`, `npm run engineer-console:init-db`, `npm run dev`
- [ ] `.env.local`: `ENGINEER_CONSOLE_REPO_ROOTS`, trusted dev **or** admin login ready
- [ ] `ENGINEER_CONSOLE_MODEL_PROVIDER=mock`
- [ ] Optional: staging deploy + health JSON profiles configured
- [ ] `gh auth status` OK on demo machine
- [ ] Demo repo: clean `main`, push access, tests pass on `main`

---

## Act 1 — Platform setup (5 min)

### Steps

1. Open `/engineer/repos`.
2. **Register** demo repo (name + absolute path).
3. Click **Verify** → expect `ok`.
4. **Index files** → wait for completion.
5. **Index code** (optional, 30s talking point on context for drafts).

### Talking points

- Repos are allowlisted paths, not arbitrary disk access.
- Indexes are operator-triggered, not model-triggered.

### Expected

- Verification status green.
- Index run rows in API/history.

---

## Act 2 — Task and run (5 min)

### Steps

1. `/engineer` → **New task** linked to registered repo.
2. Open task → **Start run**.
3. Open run (`/engineer/runs/[id]`).

### Expected status

| Field | Value |
|-------|--------|
| Run status | `completed` (after orchestration) or ready for worker plan |
| Branch | `engineer/...` |

### Talking points

- One task, many runs possible; run is the audit unit.

---

## Act 3 — Model draft and worker plan (10 min)

### Steps

1. Scroll to **Worker plan draft** → **Generate worker plan draft**.
2. Show validation status and JSON (small file change only).
3. **Copy to worker plan editor**.
4. **Validate and execute worker plan**.

### Expected

- Draft status valid (mock returns deterministic plan).
- Execution success; changed files listed.
- Quality gates section shows pass/fail (ideally all pass).

### Talking points

- **Safety boundary:** model proposes; operator executes.
- No auto-run on paste or copy.

---

## Act 4 — Governance baseline (8 min)

Work top panels on run page:

| Panel | Button | Expected |
|-------|--------|----------|
| Policy results | Evaluate | `passed` or `requires_review` |
| Replay verification | Run | `passed` |
| Evidence bundle | Regenerate (if needed) | Hash prefix displayed |
| Review stages | Generate → Approve each (admin) | All required approved |
| Audit timeline | (read-only) | Events for plan, gates, reviews |

### Approval

1. **Approval** section → **Approve** (admin account).
2. **Decision history** shows `approved`.

### Talking points

- Append-only audit chain.
- Evidence is redacted — no full diffs in bundle.

---

## Act 5 — PR and merge (8 min)

### PR creation

1. **PR creation** → evaluate readiness → **passed**.
2. **Create PR** (admin).
3. Note PR URL in panel.

### Merge

1. **Merge controls** → readiness **passed**.
2. **Merge** (admin) — or merge in GitHub if demo policy prefers, then refresh.

### Expected audit

- `PR_CREATED`, merge-related events in timeline.

### Talking points

- PR is human-gated; console uses `gh`, not model tools.

---

## Act 6 — Deploy and health (10 min)

*Skip if profiles not configured; show UI empty state instead.*

### Deployment gates

1. **Deployment gates** → environment **staging**.
2. **Evaluate readiness** → `passed`.
3. **Approve deployment** (admin).

### Execution

1. **Deployment execution** → select profile → **Execute** (admin).
2. Expect `succeeded` or controlled `failed` (have a safe echo profile for demos).

### Health

1. **Deployment health checks** → run profile (operator).
2. **Deployment health policy** → **Evaluate** → `healthy` or `needs_attention`.

### Expected evidence refresh

- Evidence bundle deployment summaries update after execution (may need regenerate).

### Talking points

- Approval ≠ execution; execution uses env-defined command only.
- Health is HTTP GET from profile URL, not arbitrary curl from client.

---

## Act 7 — Release checklist and sign-off (7 min)

### Checklist

1. **Release checklist** → **Evaluate checklist**.
2. Walk items: evidence, policy, PR merged, deploy executed, health policy.
3. Status likely `complete` or `needs_attention` (production without health → `needs_attention`).

### Sign-off (admin)

| If checklist | Action |
|--------------|--------|
| `complete` | **Completed** sign-off |
| `needs_attention` | **Completed with exceptions** + rationale |
| `blocked` | **Rejected** + rationale (fallback demo) |

### Expected

- Sign-off history row with decision, actor, hash prefixes.
- Audit: `RELEASE_SIGNOFF_COMPLETED` (or variants).
- Regenerate evidence → `releaseSignoff` summary present.
- **Replay package** includes sign-off summary (metadata only).

### Talking points

- Checklist is advisory; sign-off is human completion record.
- **Does not deploy or rollback.**

---

## Act 8 — Close (3 min)

1. `GET /api/engineer-console/audit/verify` (optional curl) — chain integrity.
2. Show **Replay package** download/view if exposed in UI.
3. Recap safety boundaries slide:

```
Model → draft only
Operator → execute plan, evaluate gates
Admin → approve, PR, merge, deploy, sign-off
```

---

## Abbreviated demo (20 min)

1. Pre-seeded run with completed worker plan + approval (DB or prior session).  
2. Show audit + evidence only (3 min).  
3. PR + merge live or pre-done (5 min).  
4. Deploy + health if configured (5 min).  
5. Checklist + sign-off (5 min).  
6. Safety recap (2 min).

---

## Expected status transition table

| Stage | Run / record status |
|-------|---------------------|
| Start run | `pending` → `running` → `completed` |
| Worker plan fail | run may `failed` |
| Approve | decision `approved`; gates unlock |
| PR | `pr_created` |
| Merge | `merged` |
| Deploy readiness | `passed` / `blocked` |
| Deploy execution | `succeeded` / `failed` |
| Health check | `healthy` / `unhealthy` / `failed` |
| Health policy | `healthy` / `needs_attention` / `unhealthy` |
| Checklist | `complete` / `needs_attention` / `blocked` |
| Sign-off | `completed` / `completed_with_exceptions` / `rejected` |

---

## Demo talking points (elevator)

1. **Governed, not autonomous** — every sensitive action is human-role-gated.  
2. **Provable** — hash-chained audit + evidence + replay.  
3. **Bounded AI** — models never touch production paths or shell.  
4. **Release-ready narrative** — same console records PR → deploy → health → sign-off.  
5. **Honest limits** — checklist/sign-off do not hard-block deploy yet; roadmap item.

---

## Failure recovery (live)

| Failure | Recovery line |
|---------|----------------|
| Kimi timeout | Switch to mock; “draft is optional” |
| Quality gate fail | Show request_fix path |
| `gh` not auth | Show readiness panel only; pre-created PR |
| Deploy profile missing | “Configuration-bound execution” — show JSON env |
| Checklist blocked | Sign-off **Rejected** with rationale — still valid demo |

---

## Related docs

- [operator-runbook.md](./operator-runbook.md)  
- [current-architecture.md](./current-architecture.md)  
- [final-hardening-notes.md](./final-hardening-notes.md)
