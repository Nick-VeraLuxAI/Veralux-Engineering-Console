# Nemotron Nano NVFP4 Migration Record — 2026-06-21

## Result

The FP8 TP=2 proof was stopped and the local FP8 serving copy was removed. The FP8 archive under `/mnt/large-storage/models` remains intact.

Nano NVFP4 was downloaded and validated under:

- Archive: `/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4`
- Local mmap-safe serving copy: `/home/ndesantis/models/nemotron/nano-30b-a3b-nvfp4`

The local safetensors mmap check passed. The archive contains five safetensors shards plus `config.json`, tokenizer files, `configuration_nemotron_h.py`, `modeling_nemotron_h.py`, and `nano_v3_reasoning_parser.py`.

## Runtime Blocker

The target hot service shape is blocked on the current `vllm/vllm-openai:nemotron` image:

- GPU0: `Nemotron-Nano-30B-A3B-NVFP4` on `127.0.0.1:8081`
- GPU1: `Nemotron-Nano-30B-A3B-NVFP4` on `127.0.0.1:8082`
- Runtime: vLLM TP=1 per GPU

NVFP4 loads successfully on GPU0 with about 18.65 GiB model memory, but vLLM fails during FlashInfer/CUTLASS MoE kernel initialization.

Observed blocker sequence:

1. Without FlashInfer NVFP4 env vars, vLLM fails with:
   `AssertionError: Non-gated activations are only supported by the flashinfer CUTLASS backend for modelopt checkpoints`
2. With `VLLM_USE_FLASHINFER_MOE_FP4=1` and `VLLM_FLASHINFER_MOE_BACKEND=throughput`, vLLM reaches the FlashInfer path, then fails JIT compilation because the image lacks cuBLAS development headers.
3. Mounting host CUDA 13.3 headers is not compatible with the image's CUDA 12.9 compiler:
   `CUDA compiler and CUDA toolkit headers are incompatible`
4. Mounting only cuBLAS headers advances the failure, but still hits CUDA 13.3/12.9 symbol mismatch:
   `identifier "cudaEmulationStrategy" is undefined`

This is a container/toolchain blocker, not a model artifact, mmap, or GPU memory blocker.

## Commands Used

Stop FP8 proof container:

```bash
docker rm -f nemotron-nano-vera-8081 || true
```

Download NVFP4 archive:

```bash
PYENV_VERSION=3.10.11 hf download nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4 \
  --local-dir /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4 \
  --max-workers 8
```

Sync to mmap-safe serving path:

```bash
rsync -a --delete \
  /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4/ \
  /home/ndesantis/models/nemotron/nano-30b-a3b-nvfp4/
```

Required smoke body once the runtime image is fixed:

```json
{
  "model": "Nemotron-Nano-30B-A3B-NVFP4",
  "messages": [
    {
      "role": "user",
      "content": "Reply with exactly: Nemotron Nano NVFP4 online"
    }
  ],
  "temperature": 0,
  "chat_template_kwargs": {
    "enable_thinking": false
  }
}
```

## No-Fallback Policy

The local runtime remains Nemotron-only. Qwen must not be used as a runtime fallback. If a configured Nemotron role is unavailable, the Console and Vera block with structured role, endpoint, model, failure reason, and next operator action.

## AirLLM Super Status

Super was not started. This preserves the safety rule that `Nemotron-Super-120B-A12B-FP8` through AirLLM cold escalation is probed only after both Nano NVFP4 hot endpoints pass stability.

## Next Operator Action

Build or install a vLLM/FlashInfer image whose CUDA toolkit, cuBLAS development headers, and FlashInfer NVFP4 CUTLASS support are internally compatible for CUDA 12.9 or CUDA 13.x on RTX 5090 / SM120.

The retry should keep:

```bash
VLLM_USE_FLASHINFER_MOE_FP4=1
VLLM_FLASHINFER_MOE_BACKEND=throughput
```

Then relaunch GPU0 first with the documented TP=1 NVFP4 command and run the exact-response smoke test before starting GPU1.
