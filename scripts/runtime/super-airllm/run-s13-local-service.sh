#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT}"

PYTHON="${ROOT}/.venv-airllm/bin/python"
VENDOR="${ROOT}/vendor/airllm-nemotronh"
PROBE_TIMEOUT_SECONDS="${PROBE_TIMEOUT_SECONDS:-28800}"
LOG_DIR="${ROOT}/.download-logs"
LOG_FILE="${LOG_DIR}/super-s13-local-service.log"

if [[ ! -x "${PYTHON}" ]]; then
  echo "Missing ${PYTHON}; S13 requires .venv-airllm" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"

VENV_SITE="$("${PYTHON}" -c "import site; print([p for p in site.getsitepackages() if 'site-packages' in p][0])")"
export AIRLLM_STOCK_SITE_PACKAGES="${VENV_SITE}"
export PYTHONPATH="${VENDOR}${PYTHONPATH:+:${PYTHONPATH}}"

# Prefer exec so signals go directly to the Python service (no wrapper reaping issues).
CMD=(timeout "${PROBE_TIMEOUT_SECONDS}" "${PYTHON}" -m airllm.s13_service_cli "$@")

if [[ "${S13_LOCAL_SERVICE_FOREGROUND:-}" == "1" ]]; then
  exec "${CMD[@]}"
fi

# Optional tee logging; default exec so SIGTERM reaches the service.
if [[ "${S13_TEE_LOG:-}" == "1" ]]; then
  set +e
  "${CMD[@]}" 2>&1 | tee "${LOG_FILE}"
  exit_code=${PIPESTATUS[0]}
  set -e
  exit "${exit_code}"
fi

exec "${CMD[@]}"
