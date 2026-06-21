# Nemotron Nano Runtime Proof — 2026-06-21

## Result

Nemotron Nano FP8 successfully served locally through vLLM on port 8081.

## Working endpoint

- Base URL: http://127.0.0.1:8081/v1
- Model: Nemotron-Nano-30B-A3B-FP8
- Runtime: vLLM v0.12.0 container
- GPU mode: tensor parallel size 2 across both RTX 5090 GPUs

## Successful smoke test

Request used:

- temperature: 0
- max_tokens: 80
- chat_template_kwargs.enable_thinking: false

Observed response:

Nemotron Nano online

## Findings

Single-GPU TP=1 attempts loaded the model but failed with very small CUDA OOM during runtime/MoE execution. The vLLM FP8 runtime path is not stable on one RTX 5090 32GB card for this checkpoint.

TP=2 succeeds and proves the local Nemotron Nano checkpoint, custom code, safetensors load path, vLLM runtime, and OpenAI-compatible API are functional.

## Architectural implication

Current vLLM FP8 shape supports one hot Nano service using both GPUs.

This is a runtime proof, not the final two-hot-Nano architecture. Next work is to test an alternate runtime/configuration for single-GPU Nano viability, or temporarily route Vera and Console default worker to the shared TP=2 Nano endpoint.
