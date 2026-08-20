#!/usr/bin/env bash
# Canonical Console Nano faithful serve recipe (promoted from experimental 8082).
# Same NVFP4 weights; NVIDIA parsers; 262144 ctx; batched tokens 2048; seqs 1.
#
# GPU placement: binds to one RTX 5090. Do not co-locate with Video-Generation
# nvfp4-director on the same GPU without pausing director first.
#
# Rollback: stop this container and start CONTROL 8081 recipe (no parsers, max-model-len 8192)
# and set ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION=false.
set -euo pipefail

NAME="${NANO_FAITHFUL_CONTAINER_NAME:-nemotron-nano-faithful-8082}"
HOST_PORT="${NANO_FAITHFUL_HOST_PORT:-8082}"
GPU_DEVICE="${NANO_FAITHFUL_GPU_DEVICE:-1}"
MODEL_HOST="${NANO_MODEL_HOST_PATH:-/mnt/model-storage/veralux-super-airllm-archive/20260725/models}"
IMAGE="${NANO_VLLM_IMAGE:-nvcr.io/nvidia/vllm:26.03.post1-py3}"

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "Container $NAME already exists. Remove or rename before recreate."
  docker ps -a --filter "name=^${NAME}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  exit 1
fi

docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  --gpus "device=${GPU_DEVICE}" \
  -p "127.0.0.1:${HOST_PORT}:8082" \
  -v "${MODEL_HOST}:/models:ro" \
  -e VLLM_USE_FLASHINFER_MOE_FP4=1 \
  -e VLLM_FLASHINFER_MOE_BACKEND=throughput \
  -e PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  "$IMAGE" \
  vllm serve /models/nano-30b-a3b-nvfp4 \
    --served-model-name Nemotron-Nano-30B-A3B-NVFP4 \
    --host 0.0.0.0 --port 8082 \
    --trust-remote-code \
    --kv-cache-dtype fp8 \
    --tensor-parallel-size 1 \
    --max-model-len 262144 \
    --max-num-seqs 1 \
    --max-num-batched-tokens 2048 \
    --gpu-memory-utilization 0.82 \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder \
    --reasoning-parser-plugin /models/nano-30b-a3b-nvfp4/nano_v3_reasoning_parser.py \
    --reasoning-parser nano_v3

echo "Started $NAME on 127.0.0.1:${HOST_PORT} (GPU ${GPU_DEVICE})"
echo "Client env:"
echo "  export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED=true"
echo "  export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:${HOST_PORT}/v1"
echo "  export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL=Nemotron-Nano-30B-A3B-NVFP4"
echo "  export ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144"
echo "  # Faithful is default ON; rollback with:"
echo "  # export ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION=false"
