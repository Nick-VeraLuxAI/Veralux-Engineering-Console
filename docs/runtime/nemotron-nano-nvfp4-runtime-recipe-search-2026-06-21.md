# Nemotron Nano NVFP4 Runtime Recipe Search - 2026-06-21

## Summary

Goal: prove `Nemotron-Nano-30B-A3B-NVFP4` as one hot service per RTX 5090 GPU:

- GPU0: Vera service on `127.0.0.1:8081`
- GPU1: Engineering Console default worker on `127.0.0.1:8082`
- Runtime policy: Nemotron-only, no legacy fallback, no FP8 fallback as the final recipe
- Senior worker: not started; AirLLM Super remains deferred until Nano NVFP4 hot endpoints are stable

Result: Recipe 1 succeeded with NVIDIA's NGC vLLM image `nvcr.io/nvidia/vllm:26.03.post1-py3`.

## Current Known Blocker Resolved

The previous upstream `vllm/vllm-openai:nemotron` image failed because its CUDA 12.9 runtime lacked an internally compatible cuBLAS development/toolkit stack for FlashInfer/CUTLASS NVFP4 JIT. Attempts to mount host CUDA 13.3 headers produced toolkit/header incompatibilities.

The NGC image below includes the needed runtime/toolchain pieces and served the NVFP4 model on a single RTX 5090 with TP=1.

## Recipe 0 - Baseline

Commands executed:

```bash
docker rm -f nemotron-nano-vera-8081 nemotron-nano-console-8082 2>/dev/null || true
nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free --format=csv,noheader,nounits
docker ps -a --filter name=nemotron
ss -ltnp
df -h /home /mnt/large-storage
```

Baseline findings:

- No stale Nemotron containers remained after cleanup.
- Ports `8081` and `8082` were free.
- GPU0 baseline: `87 MiB` used, `32016 MiB` free.
- GPU1 baseline: `15 MiB` used, `32096 MiB` free.
- `/home`: `87G` available.
- `/mnt/large-storage`: `3.3T` available.
- Local NVFP4 serving copy: `/home/ndesantis/models/nemotron/nano-30b-a3b-nvfp4`, `19G`.
- Archive NVFP4 copy: `/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4`, `18G`.
- Required model files were present.
- Safetensors shards: `5`.
- Python mmap succeeded against `model-00001-of-00005.safetensors`.
- Docker NVIDIA runtime is available.

## Recipe 1 - NVIDIA NGC vLLM

Candidate order:

1. `nvcr.io/nvidia/vllm:26.03.post1-py3`
2. `nvcr.io/nvidia/vllm:25.12.post1-py3`
3. `nvcr.io/nvidia/vllm:latest`

Only the first candidate was needed because it succeeded.

Image details:

- Tag: `nvcr.io/nvidia/vllm:26.03.post1-py3`
- Repo digest: `nvcr.io/nvidia/vllm@sha256:fe21f1b1f3a53886515a191ba6309065a54b3e026fe8a43573e75e4ecdfd530d`
- Local image id: `sha256:1f82ba158d8f82264bf013860d2a6f8f1fd5d123ee157e715801af5aec4db1f0`
- Created: `2026-04-10T12:35:27.721437281Z`
- Size: `25019515224`

Variant A succeeded:

- `VLLM_USE_FLASHINFER_MOE_FP4=1`
- `VLLM_FLASHINFER_MOE_BACKEND=throughput`
- No `--enforce-eager`
- `--gpu-memory-utilization 0.82`
- `--max-model-len 8192`
- `--kv-cache-dtype fp8`
- `--tensor-parallel-size 1`
- `--max-num-seqs 1`
- `--max-num-batched-tokens 2048`

GPU0 launch:

```bash
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

GPU1 launch:

```bash
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

Readiness:

- GPU0 `/v1/models`: ready after about `40s`.
- GPU1 `/v1/models`: ready after about `45s`.

Smoke tests:

- GPU0 exact response: `Nemotron Nano NVFP4 online` - pass.
- GPU1 exact response: `Console Nano NVFP4 online` - pass.

Single-GPU hold:

- GPU0 remained running for `10` minutes.
- Restart count remained `0`.
- GPU0 memory stayed at `27615 MiB` used, `4488 MiB` free.
- No CUDA OOM was observed.

Dual stability loop:

- Containers: both running, restart count `0`.
- Ports: `127.0.0.1:8081` and `127.0.0.1:8082` listening.
- `/v1/models`: pass on both endpoints.
- Exact-response calls: GPU0 `10/10`, GPU1 `10/10`.
- Short coding calls against `8082`: `5/5`.
- JSON structured-output calls: GPU0 `5/5`, GPU1 `5/5`.
- Final log scan: no `out of memory`, `cuda oom`, or `traceback`.
- Final memory:
  - GPU0: `27615 MiB` used, `4488 MiB` free.
  - GPU1: `27543 MiB` used, `4568 MiB` free.

Restart policy:

```bash
docker update --restart unless-stopped nemotron-nano-vera-8081 nemotron-nano-console-8082
```

Result:

- `/nemotron-nano-vera-8081 RestartPolicy=unless-stopped RestartCount=0 State=running`
- `/nemotron-nano-console-8082 RestartPolicy=unless-stopped RestartCount=0 State=running`

## Recipes Not Attempted

Recipe 2, Recipe 3, Recipe 4, and Recipe 5 were not attempted because Recipe 1 met the success criteria on both GPUs with stable endpoints.

## Winning Recipe

Use NVIDIA NGC vLLM `nvcr.io/nvidia/vllm:26.03.post1-py3` with FlashInfer FP4 enabled, no `--enforce-eager`, TP=1, `max_model_len=8192`, and `gpu_memory_utilization=0.82`.

## Remaining Blockers

No runtime blocker remains for activating the Nano NVFP4 hot-service routing.

AirLLM Super was not started. It can be evaluated only after an explicit operator instruction now that both Nano endpoints are stable.
