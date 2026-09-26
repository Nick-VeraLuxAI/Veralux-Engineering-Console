# Super AirLLM Repair — Phase S13.1 Bounded Graceful Shutdown (v1)

## Final verdict

```text
s13_1_bounded_shutdown_ready_with_emergency_fallback
```

Status: **S13.1 READY — BOUNDED SHUTDOWN WITH EMERGENCY FALLBACK**

This is a shutdown-lifecycle repair only. It is not a generation improvement, native FP8 enablement, S15, production deployment, remote serving, or full production readiness.

## Symptom that triggered S13.1

During final S14 cleanup:

- graceful S13 shutdown was requested;
- the S13 service remained hung on `127.0.0.1:8091`;
- forced termination with SIGKILL was required;
- the process exited with code `137`;
- port `8091` was released only after SIGKILL.

S14 remained valid (`s14_gated_senior_adapter_ready_fake_quant`). S13.1 repairs the lifecycle defect.

## Root cause

| Item | Detail |
| ---- | ------ |
| Blocking object | `ThreadingHTTPServer.shutdown()` invoked from the SIGTERM handler on the same thread that runs `serve_forever()` |
| Deadlock | `httpd.shutdown()` waits for `serve_forever` to exit; the handler never returns → listener never closes |
| Port hold | `127.0.0.1:8091` stayed occupied even after durable `stopped` / Nano restore completed |
| Wrapper | `tee`-based launcher could complicate signal delivery; foreground/default paths now `exec` the Python service |

Idle SIGTERM reproduction before the fix hung ≥25s with the port still listening (`REPRODUCED_HANG`).

## Proven baselines preserved

| Gate | Value |
| ---- | ----- |
| S13 immutable commit | `614377b02fa7ee06976fd58aeccaa7965a96b6e6` |
| S14 verdict | `s14_gated_senior_adapter_ready_fake_quant` |
| Execution mode | `modelopt_fake_quant_cuda` |
| `nativeFp8KernelProven` | `false` |
| Senior defaults | `defaultRoute=false`, `automaticSelection=false`, `explicitApprovalRequired=true` |
| Local only | `true` |
| `maxConcurrentRequests` | `1` |

## Shutdown architecture

### Modes

| Mode | Behavior |
| ---- | -------- |
| `graceful` | Stop admissions; preserve queued; allow active completion within remaining deadline; restore Nano if required; close service |
| `cancel_active` (default) | Stop admissions; preserve queued; cooperative cancel active; escalate worker; restore Nano if required; close service |
| `immediate` | Stop admissions; persist interrupted/recovery state; terminate worker with bounded escalation; restore Nano if required; close service |

### Central coordinator

`vendor/airllm-nemotronh/airllm/s13_shutdown.py` — `ShutdownCoordinator`:

- idempotent; serializes concurrent requests;
- one monotonic top-level deadline (default 30s);
- each step receives remaining time;
- continues on nonfatal step failures; collects `cleanupErrors`;
- structured `ShutdownResult` + verdicts:
  - `s13_shutdown_complete`
  - `s13_shutdown_complete_degraded` (includes SIGKILL fallback)
  - `s13_shutdown_deadline_exceeded`
  - `s13_shutdown_failed`

### Phase order

```text
shutdown_requested
admissions_closed
queue_paused
http_listener_closed   # early, off serve_forever thread
active_request_handled
worker_signalled
worker_reaped
nano_restoration_started
nano_restored
background_tasks_cancelled
resources_closed
shutdown_complete
```

### Worker escalation

```text
cooperative cancel → wait → SIGTERM → wait → SIGKILL (emergency only) → reap
```

Normal ready path must not require SIGKILL. Deliberately hung SIGTERM-ignoring workers may use SIGKILL and classify degraded / emergency-fallback.

### Signal handling

SIGINT / SIGTERM / `POST /v1/shutdown` all schedule the same coordinator on a dedicated thread. The raw signal handler never calls `httpd.shutdown()`. A second signal escalates toward `immediate`.

### Launcher

`scripts/runtime/super-airllm/run-s13-local-service.sh` prefers `exec` so signals reach the service and the wrapper does not orphan Python. Optional `S13_TEE_LOG=1` retains tee logging.

### Exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | Bounded shutdown complete |
| 1 | Complete degraded (recoverable errors / SIGKILL used) |
| 2 | Failed or deadline exceeded |
| 137 | External SIGKILL only — never the normal successful path |

## Request-state behavior

- Queued requests remain durable and are not started during shutdown.
- Dispatcher re-checks pause/shutdown before promote and re-queues if shutdown raced.
- Active requests end in truthful durable states (`cancelled`, `recovery_required`, `completed`, `failed`).
- Event / service-state writes continue through shutdown phases.

## Nano restoration

Console Nano is restored only when S13 actually interrupted it (`nano_stopped` / `large_model_running`). Vera Nano on `:8081` must remain healthy. Restoration is bounded by the shared deadline.

## Automated tests

```bash
PYTHONPATH=vendor/airllm-nemotronh \
.venv-airllm/bin/python -m pytest vendor/airllm-nemotronh/tests/ -q
# 198 passed

npx vitest run src/lib/engineer-console/experimental/super-airllm/
# 19 files / 92 passed

PYTHONPATH=vendor/airllm-nemotronh \
.venv-airllm/bin/python -m pytest \
vendor/airllm-nemotronh/tests/test_s13_1_bounded_shutdown.py -q
# 12 passed
```

## Real verification

Run id: see `.download-logs/s13-1-shutdown-verification/<run-id>/`

| Scenario | Result |
| -------- | ------ |
| Idle graceful SIGTERM | pass — ~1.0s, exit 0, no SIGKILL, port released |
| Five repeated idle cycles | pass — bind/health/shutdown/port; FD trend stable |
| Queued request shutdown | pass — admissions closed; queued durable |
| Active cooperative cancel | pass — worker reaped; Nano restored; port released; no SIGKILL; durable `recovery_required` at interrupt boundary |
| Deliberately hung worker | pass — cancel → SIGTERM → SIGKILL → reap (emergency) |
| S14 cleanup compatibility | pass — health/readiness/runtime then SIGTERM; no hang; invariants unchanged |

### Timing (representative)

| Path | Time |
| ---- | ---- |
| Configured idle deadline | 30s |
| Idle shutdown | ~1.0–1.2s |
| Active cancel (incl. Nano restore) | ~27s (deadline budget 120s) |
| Hung-worker escalation | ~few seconds |

## Compatibility

Unchanged by design:

- S13 one-token / two-token generation contracts
- S13 cancellation / recovery semantics (truthful durable states)
- S14 adapter mapping / approval gate / no-default invariant
- `modelopt_fake_quant_cuda` classification
- `nativeFp8KernelProven = false`

Active-path lifecycle verification may set `S13_SHUTDOWN_VERIFY_RELAX_FINGERPRINT=1` so dirty S13.1 repair trees can admit a request without weakening the default generation fingerprint gate.

## Artifacts

| Artifact | Path |
| -------- | ---- |
| Canonical result | `.download-logs/super-s13-1-shutdown-result.json` |
| Timestamped result | `.download-logs/super-s13-1-shutdown-result-<UTC>.json` |
| Verification dir | `.download-logs/s13-1-shutdown-verification/<run-id>/` |
| Root cause | `root-cause.json` |
| Scenario results | `scenario-results.json` |
| This document | `docs/source-of-truth/implementation-audit/34-super-airllm-repair-s13-1-bounded-shutdown-v1.md` |

## Remaining limitations

- Emergency SIGKILL remains for workers that ignore cooperative cancel and SIGTERM (classified degraded / emergency-fallback).
- Active interrupt during layer streaming may land in `recovery_required` rather than `cancelled` when the worker exits non-cooperatively — durable and truthful.
- No S13.1 immutable commit was created unless explicitly authorized.

## Next gate

```text
S15 AUTHORIZED AS THE NEXT GATE
```

**S15: approved senior-review workflow integration**, preserving both default-worker and senior outputs and requiring explicit operator acceptance before the senior result affects execution.

Do not begin S15 automatically from this document.
