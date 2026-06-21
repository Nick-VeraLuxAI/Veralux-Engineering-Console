# Nemotron Nano NVFP4 Winning Recipe - 2026-06-21

## Runtime

- Image: `nvcr.io/nvidia/vllm:26.03.post1-py3`
- Digest: `nvcr.io/nvidia/vllm@sha256:fe21f1b1f3a53886515a191ba6309065a54b3e026fe8a43573e75e4ecdfd530d`
- Model: `Nemotron-Nano-30B-A3B-NVFP4`
- Model path: `/home/ndesantis/models/nemotron/nano-30b-a3b-nvfp4`
- Container model mount: `/models/nano-30b-a3b-nvfp4`
- Policy: Nemotron-only with no legacy fallback and no FP8 fallback as the final runtime

## Launch GPU0 - Vera

```bash
docker rm -f nemotron-nano-vera-8081 2>/dev/null || true

docker run -d \
  --name nemotron-nano-vera-8081 \
  --gpus '"device=0"' \
  --ipc=host \
  -p 127.0.0.1:8081:8081 \
  -v /home/ndesantis/models/nemotron:/models:ro \
  -e PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  -e VLLM_USE_FLASHINFER_MOE_FP4=1 \
  -e VLLM_FLASHINFER_MOE_BACKEND=throughput \
  nvcr.io/nvidia/vllm:26.03.post1-py3 \
  vllm serve /models/nano-30b-a3b-nvfp4 \
    --served-model-name Nemotron-Nano-30B-A3B-NVFP4 \
    --host 0.0.0.0 \
    --port 8081 \
    --trust-remote-code \
    --kv-cache-dtype fp8 \
    --tensor-parallel-size 1 \
    --max-model-len 8192 \
    --max-num-seqs 1 \
    --max-num-batched-tokens 2048 \
    --gpu-memory-utilization 0.82
```

## Launch GPU1 - Engineering Console

```bash
docker rm -f nemotron-nano-console-8082 2>/dev/null || true

docker run -d \
  --name nemotron-nano-console-8082 \
  --gpus '"device=1"' \
  --ipc=host \
  -p 127.0.0.1:8082:8082 \
  -v /home/ndesantis/models/nemotron:/models:ro \
  -e PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  -e VLLM_USE_FLASHINFER_MOE_FP4=1 \
  -e VLLM_FLASHINFER_MOE_BACKEND=throughput \
  nvcr.io/nvidia/vllm:26.03.post1-py3 \
  vllm serve /models/nano-30b-a3b-nvfp4 \
    --served-model-name Nemotron-Nano-30B-A3B-NVFP4 \
    --host 0.0.0.0 \
    --port 8082 \
    --trust-remote-code \
    --kv-cache-dtype fp8 \
    --tensor-parallel-size 1 \
    --max-model-len 8192 \
    --max-num-seqs 1 \
    --max-num-batched-tokens 2048 \
    --gpu-memory-utilization 0.82
```

## Restart Policy

```bash
docker update --restart unless-stopped nemotron-nano-vera-8081 nemotron-nano-console-8082
```

## Health Checks

```bash
docker inspect --format '{{.Name}} RestartPolicy={{.HostConfig.RestartPolicy.Name}} RestartCount={{.RestartCount}} State={{.State.Status}}' \
  nemotron-nano-vera-8081 nemotron-nano-console-8082

ss -ltnp | awk '$4 ~ /:(8081|8082)$/ {print}'

curl -sS http://127.0.0.1:8081/v1/models
curl -sS http://127.0.0.1:8082/v1/models

nvidia-smi --query-gpu=index,memory.used,memory.free --format=csv,noheader,nounits
```

## Smoke Test GPU0

```bash
curl -sS http://127.0.0.1:8081/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Nemotron-Nano-30B-A3B-NVFP4",
    "messages": [
      {
        "role": "system",
        "content": "You are a concise assistant. Do not explain reasoning. Follow the user instruction exactly."
      },
      {
        "role": "user",
        "content": "Reply with exactly: Nemotron Nano NVFP4 online"
      }
    ],
    "temperature": 0,
    "max_tokens": 80,
    "stream": false,
    "chat_template_kwargs": {
      "enable_thinking": false
    }
  }'
```

Expected content:

```text
Nemotron Nano NVFP4 online
```

## Smoke Test GPU1

```bash
curl -sS http://127.0.0.1:8082/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Nemotron-Nano-30B-A3B-NVFP4",
    "messages": [
      {
        "role": "system",
        "content": "You are a concise assistant. Do not explain reasoning. Follow the user instruction exactly."
      },
      {
        "role": "user",
        "content": "Reply with exactly: Console Nano NVFP4 online"
      }
    ],
    "temperature": 0,
    "max_tokens": 80,
    "stream": false,
    "chat_template_kwargs": {
      "enable_thinking": false
    }
  }'
```

Expected content:

```text
Console Nano NVFP4 online
```

## Stability Loop

Acceptance checks used for the proof:

- Both containers running with restart count `0`.
- Ports `127.0.0.1:8081` and `127.0.0.1:8082` listening.
- `/v1/models` succeeds on both endpoints.
- `10/10` exact-response calls pass on each endpoint.
- `5/5` short coding calls pass on `8082`.
- `5/5` JSON structured-output calls pass on each endpoint with `chat_template_kwargs.enable_thinking=false`.
- Final log scan has no `out of memory`, `cuda oom`, or `traceback`.
- Memory remains stable:
  - GPU0: about `27615 MiB` used.
  - GPU1: about `27543 MiB` used.

## Operator Restart Procedure

```bash
docker restart nemotron-nano-vera-8081 nemotron-nano-console-8082

curl -sS http://127.0.0.1:8081/v1/models
curl -sS http://127.0.0.1:8082/v1/models

docker inspect --format '{{.Name}} RestartCount={{.RestartCount}} State={{.State.Status}}' \
  nemotron-nano-vera-8081 nemotron-nano-console-8082
```

## Known Caveats

- Keep hot-serving paths under `/home/ndesantis/models/nemotron`; `/mnt/large-storage` previously caused mmap failures for vLLM safetensors.
- Keep `VLLM_USE_FLASHINFER_MOE_FP4=1` and `VLLM_FLASHINFER_MOE_BACKEND=throughput`.
- Do not add `--enforce-eager` to the winning recipe.
- Do not start AirLLM Super unless explicitly requested after the Nano endpoints are stable.
