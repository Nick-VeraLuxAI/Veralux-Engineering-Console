# Placeholder Module Card Metadata-Only Mirror

## Boundary

Engineering Console supports the first Vera Builder Loop MVP slice through a dedicated metadata-only bridge route:

```text
/api/engineer-console/bridge/placeholder-module-card
```

The route validates a Vera/System canonical placeholder module card handoff and returns non-authorizing status/evidence metadata. It does not create tasks, create runs, call the normal run/orchestrator path, create branches, create commits, create PRs, deploy, merge, or authorize final integration.

## What The Console Route Proves

- Console can reject unsafe handoff fields such as repo paths, branches, commands, PR intent, deploy intent, final-integration intent, and arbitrary filesystem paths.
- Console can validate the placeholder module card contract:
  - `artifact_type: "placeholder_module_card"`
  - `execution_mode: "metadata_only"`
  - `integration_mode: "blocked_manual_only"`
  - all mutation and integration authority flags set to `false`
- Console can return operator-readable evidence metadata for Vera display.
- Console remains a mirror validator only; System remains canonical for Vera-side state and decisions.

## What Remains Blocked

- normal run/orchestrator execution.
- branch creation.
- commits.
- PR creation.
- deployment.
- final integration.
- autonomous approval or apply behavior.
- arbitrary command execution.
- arbitrary path access.

## Next Required Proof

The next required proof is complete in `14-isolated-workspace-proof.md`.

The metadata-only route remains useful as the non-authorizing handoff validator. Real bootstrap build/test processing for Vera Builder Loop now uses:

```text
/api/engineer-console/bridge/placeholder-module-card/isolated-workspace-proof
```

The normal Console run/orchestrator path remains blocked for Vera Builder Loop work.

## Focused Test

```sh
npm test -- src/lib/engineer-console/bridge/placeholder-module-card-contract.test.ts
```
