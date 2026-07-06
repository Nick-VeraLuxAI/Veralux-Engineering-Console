#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT}"

export PYENV_VERSION="${PYENV_VERSION:-3.10.11}"
PYTHON="${ROOT}/.venv-airllm/bin/python"
VENDOR="${ROOT}/vendor/airllm-nemotronh"
PROBE_TIMEOUT_SECONDS="${PROBE_TIMEOUT_SECONDS:-600}"
LOG_DIR="${ROOT}/.download-logs"
LOG_FILE="${LOG_DIR}/super-layer-load-probe.log"

if [[ ! -x "${PYTHON}" ]]; then
  echo "Missing ${PYTHON}; AirLLM layer load probe requires .venv-airllm" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"

VENV_SITE="$("${PYTHON}" -c "import site; print([p for p in site.getsitepackages() if 'site-packages' in p][0])")"
export AIRLLM_STOCK_SITE_PACKAGES="${VENV_SITE}"
export PYTHONPATH="${VENDOR}${PYTHONPATH:+:${PYTHONPATH}}"
export CUDA_VISIBLE_DEVICES=""

CMD=(timeout "${PROBE_TIMEOUT_SECONDS}" "${PYTHON}" -m airllm.layer_load_probe_cli "$@")

if [[ "${LAYER_LOAD_PROBE_FOREGROUND:-}" == "1" ]]; then
  exec "${CMD[@]}"
fi

set +e
"${CMD[@]}" 2>&1 | tee "${LOG_FILE}"
exit_code=${PIPESTATUS[0]}
set -e

if [[ ${exit_code} -eq 124 ]]; then
  echo '{"phase":"super_airllm_repair_s5_layer_load_probe","verdict":"layer_forward_probe_timeout","failure_classification":"timeout"}' >&2
fi

exit ${exit_code}
