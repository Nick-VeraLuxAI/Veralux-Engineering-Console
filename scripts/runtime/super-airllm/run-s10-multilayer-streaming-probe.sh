#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT}"

export PYENV_VERSION="${PYENV_VERSION:-3.10.11}"
PYTHON="${ROOT}/.venv-airllm/bin/python"
VENDOR="${ROOT}/vendor/airllm-nemotronh"
PROBE_TIMEOUT_SECONDS="${PROBE_TIMEOUT_SECONDS:-2400}"
LOG_DIR="${ROOT}/.download-logs"
LOG_FILE="${LOG_DIR}/super-s10-multilayer-streaming-probe.log"

if [[ ! -x "${PYTHON}" ]]; then
  echo "Missing ${PYTHON}; S10 multi-layer streaming probe requires .venv-airllm" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"

VENV_SITE="$("${PYTHON}" -c "import site; print([p for p in site.getsitepackages() if 'site-packages' in p][0])")"
export AIRLLM_STOCK_SITE_PACKAGES="${VENV_SITE}"
export PYTHONPATH="${VENDOR}${PYTHONPATH:+:${PYTHONPATH}}"

CMD=(timeout "${PROBE_TIMEOUT_SECONDS}" "${PYTHON}" -m airllm.s10_multilayer_streaming_probe_cli "$@")

if [[ "${S10_MULTILAYER_PROBE_FOREGROUND:-}" == "1" ]]; then
  exec "${CMD[@]}"
fi

set +e
"${CMD[@]}" 2>&1 | tee "${LOG_FILE}"
exit_code=${PIPESTATUS[0]}
set -e

if [[ ${exit_code} -eq 124 ]]; then
  echo '{"phase":"S10","verdict":"s10_multilayer_streaming_failed","errors":["timeout"]}' >&2
fi

exit ${exit_code}
