# Cross-Repo Dependencies

## Context Sources Used

External source-of-truth docs were locally available and used as context:

- `Veralux-Observational-Layer/docs/source-of-truth/*`
- `Veralux-Observational-Layer/docs/observation-layer/IMPLEMENTATION_PLAN.md`
- `Veralux-System/docs/source-of-truth/implementation-audit/*`

The Observation repo was treated as planning/scaffold context. `Veralux-System` audit docs were treated as the Vera-side implementation map.

## Dependency Map

| Dependency | Owning repo | Engineering Console role |
|---|---|---|
| Vera command/task router | `Veralux-System` | Receives structured build/prototype requests after Vera classification |
| Vera bridge client | `Veralux-System` | Provides Console endpoints for Vera to call |
| Vera governed builder UI | `Veralux-System` | Console returns evidence/status/summaries for Vera UI/operator approval |
| Console execution/gates/evidence | `Veralux-Engineering-Console` | Owns prototype execution chain and broader project orchestration |
| Observation Layer | `Veralux-System` implementation, `Veralux-Observational-Layer` docs | Not directly part of Engineering Console, but part of ecosystem denominator |
| Runtime/model policy | Split across `Veralux-System` and Console | Needs shared Role Runtime Policy v1 |
| Senior review | Split/unclear | Console has blocked/proof/candidate senior modules; `Veralux-System` has senior review queue/status concepts |
| Final integration workflow smoke metadata | `Veralux-System` | Console validates mirrored metadata only through `mirror_validator_only`; no dry-run, GitHub, PR, route, or mutation authority |

## Vera-To-Console Bridge Cross-Repo Requirements

Must verify in `Veralux-System`:

- Which endpoints are called and in what sequence.
- Request body fields and how they map to Console TypeScript interfaces.
- Whether Vera stores Console evidence paths, workspace paths, task/run ids, candidate ids, and final safety flags.
- Whether Vera asks user approval before any integration step.
- Whether Vera can surface blocked/failed/passed-with-skips states.
- Whether Vera validates Console response schema/version.

Must verify in Console:

- Endpoint authorization.
- Field validation.
- Evidence path and workspace path creation.
- Lineage validation/rehydration.
- No production mutation before final approval.

## Runtime / Model Policy Dependencies

`Veralux-System` has its own model registry/routing docs and code per the previous audit. Console has `src/lib/engineer-console/model-routing/model-role-routing.ts`.

Shared policy still needs to answer:

- Are role ids identical across repos?
- Are allowed models declared in one place?
- Are fallback policies explicit and approval-gated?
- Is senior blocked/candidate/available status synchronized?
- How are cloud providers such as OpenAI/Anthropic represented if allowed?

## Evidence / Lineage Dependencies

Console evidence artifacts:

- `evidence/prototype-loop-v1/*`
- `evidence/prototype-controlled-apply/*`
- `evidence/prototype-integration-candidates/*`
- SQLite run evidence bundles.

Vera/System evidence dependencies:

- Vera bridge client must store and later submit evidence ids/paths without losing lineage.
- Vera should not treat caller-entered paths/flags as proof unless Console can rehydrate/verify them.

Open cross-repo question:

- Should evidence bundle hashes be exchanged and verified across repos, or is path/id lineage enough?

## Product Boundary Dependencies

Engineering Console can be scored independently for:

- Console-side gates.
- Console-side evidence.
- Console-side workspaces.
- Console UI and API.

It cannot be scored independently for:

- End-to-end Vera intent classification to build execution.
- User approval before integration as experienced in Vera UI.
- Runtime role/model policy across the whole VeraLux ecosystem.
- Final production integration after Console candidate creation.

## Final Integration Workflow Smoke Mirror

Path B Phase 12I adds a Console-owned, non-mutating mirror validator for System-owned final integration workflow smoke metadata:

- `Veralux-System` remains canonical.
- Console consumes metadata as non-authoritative mirror input only.
- `manual_operator_v1` remains the current final integration boundary.
- `github_pr_workflow` remains a future-only transport vehicle.
- final integration and dry-run execution remain blocked/default-off.
- audit, rollback/abort, transport design, dry-run readiness, workflow dry-run, Vera handoff, candidate, evidence, and runtime-policy audit IDs are cross-reference metadata only.
- Git credentials, GitHub tokens, PR tokens, SSH keys, raw patches, commands, local paths, provider credentials, secrets, and authority-bearing flags are rejected.

Focused check: `npm run check:final-integration:smoke-mirror`.

## Recommended Merge Order

1. Merge Vera-to-Console bridge contract docs from both repos.
2. Freeze task lifecycle states across Vera and Console.
3. Freeze evidence lineage fields and hash verification requirements.
4. Decide whether real build tasks use project-orchestration worktrees instead of prototype-loop folders.
5. Draft Role Runtime Policy v1 from both repos’ model routing code.
6. Create scorecards only after the denominator separates prototype proof, general execution, and production integration.
