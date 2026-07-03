#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT}/vendor/airllm-nemotronh"

export PYENV_VERSION="${PYENV_VERSION:-3.10.11}"

if ! python -c "import pytest" 2>/dev/null; then
  echo "pytest not found for PYENV_VERSION=${PYENV_VERSION}; creating local vendor/.venv-test (not committed)"
  python -m venv .venv-test
  .venv-test/bin/pip install -q pytest
  exec .venv-test/bin/python -m pytest tests -q
fi

python -m pytest tests -q
