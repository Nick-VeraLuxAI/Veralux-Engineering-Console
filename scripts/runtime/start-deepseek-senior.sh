#!/usr/bin/env bash
# Start DeepSeek-V4-Flash FTW senior on 127.0.0.1:1919 (FreeToken TP1, GPU 0).
# Stops legacy Nano 8081 first so GPU 0 is free. Map chat + AE stay on FAITHFUL 8082 (GPU 1).
set -euo pipefail

FT_ENV="${FT_ENV:-/mnt/model-storage/venvs/freetoken-glm52}"
LOG_DIR="${LOG_DIR:-$HOME/deepseek-v4-freetoken-ftw-verify/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$LOG_DIR"

echo "=== DeepSeek senior serve ==="
echo "log dir: $LOG_DIR"

if curl -sf --max-time 2 "http://127.0.0.1:1919/v1/models" >/dev/null 2>&1; then
  echo "DeepSeek already listening on 1919."
  exit 0
fi

echo "Stopping legacy Nano 8081 to free GPU 0 (8082 FAITHFUL remains primary)..."
if command -v docker >/dev/null 2>&1; then
  docker stop nemotron-nano-vera-8081 2>/dev/null || true
fi
pkill -f "vllm serve.*--port 8081" 2>/dev/null || true
sleep 2

if ! curl -sf --max-time 2 "http://127.0.0.1:8082/v1/models" >/dev/null 2>&1; then
  echo "WARNING: Nano FAITHFUL 8082 is not reachable. Start 8082 before relying on chat/AE." >&2
fi

# shellcheck disable=SC1091
source "$FT_ENV/bin/activate"
if [[ -f "$FT_ENV/nccl.env" ]]; then
  # shellcheck disable=SC1091
  source "$FT_ENV/nccl.env"
fi

export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
CMD=(
  ft serve
  --model /mnt/model-storage/models/deepseek-ai_DeepSeek-V4-Flash-0731-ftw
  --host 127.0.0.1
  --port 1919
  --moe-backend hybrid
  --tensor-parallel-size 1
  --served-model-name deepseek-v4-flash-ftw-tp1
  --max-seq-len-override 32768
  --num-tokens 32768
  --memory-ratio 0.95
  --max-running-requests 1
  --max-prefill-length 8192
  --decode-log-interval 20
)

printf '%s\n' "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES" "${CMD[*]}" | tee "$LOG_DIR/exact_serve_command.txt"

{
  date -u
  echo "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
  echo "cmd=${CMD[*]}"
  exec "${CMD[@]}"
} 2>&1 | tee "$LOG_DIR/deepseek_ftw_tp1_32k_serve.log"
