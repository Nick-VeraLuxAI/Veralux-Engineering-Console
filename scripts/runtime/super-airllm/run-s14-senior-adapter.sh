#!/usr/bin/env bash
# S14 gated senior-adapter launcher (Console repo).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
exec npx tsx scripts/runtime/super-airllm/s14-senior-adapter.ts "$@"
