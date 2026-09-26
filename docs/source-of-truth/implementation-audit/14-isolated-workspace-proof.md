# Vera Builder Loop Isolated Workspace Proof

## Purpose

This record defines the Console-side proof that Vera Builder Loop work can perform harmless build/test-style activity inside a system-created isolated temp workspace without using the normal Console run/orchestrator path.

Safe proof route:

```text
/api/engineer-console/bridge/placeholder-module-card/isolated-workspace-proof
```

This route is now the Console processor for the first tiny real Vera Builder Loop build/test vertical slice. It builds/tests a proposed placeholder module-card artifact only inside the isolated temp workspace and returns evidence/status metadata to Vera.

## Closeout Verdict

Bootstrap milestone complete for Console's side of the loop:

- Metadata-only placeholder handoff validation: proven.
- Isolated workspace build/test proof: proven.
- First tiny placeholder module-card artifact generation/checking slice: proven.
- Evidence/status metadata returned for Vera display: proven.
- Normal Console run/orchestrator path: still blocked for Vera Builder Loop work.
- Final integration, branch, commit, PR, deploy, merge, and bound-repo mutation: still blocked/future.

## What The Proof Demonstrates

- Console accepts the same governed Vera placeholder module-card handoff used by the metadata-only slice.
- Console rejects handoffs containing repo paths, branch names, commit intent, PR intent, deploy intent, final-integration intent, arbitrary filesystem paths, arbitrary command fields, or authority flags set to `true`.
- Console creates a system-owned temp workspace.
- Console materializes only harmless placeholder artifacts inside that temp workspace:
  - `module-card.json`
  - `module-card.md`
- Console runs internal validation checks only:
  - workspace containment
  - placeholder JSON validation
  - operator-readable markdown validation
- Console generates operator-readable evidence/status metadata including:
  - workspace type
  - generated artifact metadata
  - checks run
  - mutation-denial proof
  - final-integration-blocked proof
  - boundary flags
  - cleanup/containment status

## Why Execution Was Previously Blocked

The normal Console execution path may create a branch in the bound repository before Vera-specific worker handling. That path remains blocked for Vera Builder Loop real execution until separately proven or redesigned.

This proof avoids that path entirely. It does not call:

- `executeRun`
- `run-orchestrator`
- `startVeraExecution`
- branch helpers
- commit helpers
- PR helpers
- deploy helpers
- merge helpers
- shell/child process execution

## Safe Path For Vera Builder Loop Work

The only safe Console path proven by this record is the dedicated isolated workspace proof route above.

The proof uses only system-created temp workspace paths. It does not accept user-provided paths or commands. Evidence references the workspace through metadata and hashes rather than treating a user-provided path as authoritative.

The generated module card is a proposal only. It is not integrated into a repository, registered as a real product module, committed, opened as a PR, deployed, merged, or final-integrated.

## Auth Modes

Local trusted-dev may run the route with:

```text
ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV=true
ENGINEER_CONSOLE_AUTH_ENABLED=false
```

Auth-enabled deployments must preserve Console operator auth. The route accepts either valid operator auth or a scoped Vera/System service token:

```text
Header: x-veralux-placeholder-bridge-token
Env:    ENGINEER_CONSOLE_PLACEHOLDER_BRIDGE_TOKEN
```

That service token is implemented only for this isolated placeholder module-card bridge route. It does not authorize normal task/run/orchestrator routes, repo mutation, branch creation, commit creation, PR creation, deployments, merges, or final integration.

## Paths That Remain Blocked

The following remain blocked for Vera Builder Loop real execution:

- normal task/run execution route.
- normal run/orchestrator path.
- branch creation in a bound repo.
- commit creation.
- GitHub PR creation.
- deployment.
- merge.
- final integration.
- production data access.
- arbitrary command execution.
- arbitrary path access.

## Required Before Vera UI Real Build/Test Slice

For the current Vera UI tiny real build/test vertical slice:

- System must call only the isolated workspace proof or a successor route with the same safety properties.
- The route must remain operator-gated and must not weaken auth.
- Auth-enabled System-to-Console calls must use the scoped placeholder bridge token, not broad cookie forwarding.
- Runtime Policy and final-integration gates must remain non-authorizing/default-off.
- Console evidence must remain non-authoritative where System owns Vera-side source-of-truth state.
- UI copy must distinguish isolated workspace proof from final integration readiness.
- Tests must continue proving no branch, commit, PR, deploy, merge, main-tree mutation, bound-repo mutation, or final-integration authority.

Future work after bootstrap may replace this proof route with a more general isolated builder, but only after the same safety boundaries are proven for that successor path.

## How To Use This Going Forward

Vera Builder Loop work may use this isolated workspace route to build proposed artifacts, collect evidence/status, and support operator decisions in Vera.

This route does not integrate artifacts into a repository. Integrated repo changes remain a future workflow requiring a separately proven integration boundary and explicit manual approval.

## Proof Command

```sh
npm test -- src/lib/engineer-console/bridge/placeholder-module-card-isolated-workspace-proof.test.ts src/lib/engineer-console/bridge/placeholder-module-card-contract.test.ts src/lib/engineer-console/bridge/placeholder-module-card-service-auth.test.ts
```
