#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT}"

export PYENV_VERSION="${PYENV_VERSION:-3.10.11}"
PYTHON="${ROOT}/.venv-airllm/bin/python"
VENDOR="${ROOT}/vendor/airllm-nemotronh"
VENV_SITE="$("${PYTHON}" -c "import site; print([p for p in site.getsitepackages() if 'site-packages' in p][0])")"

if [[ ! -x "${PYTHON}" ]]; then
  echo "Missing ${PYTHON}; AirLLM split materialization requires .venv-airllm" >&2
  exit 1
fi

export AIRLLM_STOCK_SITE_PACKAGES="${VENV_SITE}"
export PYTHONPATH="${VENDOR}${PYTHONPATH:+:${PYTHONPATH}}"

if [[ " $* " == *" --allow-split-materialize "* && " $* " == *" --confirm-split-materialize "* ]]; then
  exec "${PYTHON}" "${ROOT}/scripts/runtime/super-airllm/s4-split-materialize-stock.py" "$@"
fi

exec "${PYTHON}" -m airllm.split_materialize_cli "$@"
