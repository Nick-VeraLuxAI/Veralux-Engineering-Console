#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT}"

export PYENV_VERSION="${PYENV_VERSION:-3.10.11}"
PYTHON="${ROOT}/.venv-airllm/bin/python"
VENDOR="${ROOT}/vendor/airllm-nemotronh"

if [[ ! -x "${PYTHON}" ]]; then
  echo "Missing ${PYTHON}; AirLLM init_model spike requires .venv-airllm" >&2
  exit 1
fi

VENV_SITE="$("${PYTHON}" -c "import site; print([p for p in site.getsitepackages() if 'site-packages' in p][0])")"
export AIRLLM_STOCK_SITE_PACKAGES="${VENV_SITE}"
export PYTHONPATH="${VENDOR}${PYTHONPATH:+:${PYTHONPATH}}"
exec "${PYTHON}" -m airllm.init_model_spike_cli "$@"
