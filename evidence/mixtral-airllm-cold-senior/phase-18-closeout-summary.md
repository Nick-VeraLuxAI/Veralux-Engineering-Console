# Phase 18 Closeout — Mixtral AirLLM Runtime Proof

## Verdict

`mixtral_candidate_bounded_inference_runtime_proven_bypass_required`

Mixtral 8x22B can run bounded AirLLM inference on VeraTitan only when all of the following are true:

- Model is stored on Linux-native ext4 storage.
- Checkpoint shards are valid.
- Transformers is pinned to `4.44.2`.
- AirLLM's built-in Mixtral split output is bypassed.
- A manually repaired, tensor-complete split is used.
- Runtime monkeypatch redirects AirLLM to the protected repaired split.

## What passed

- ext4 safetensors mmap proof
- fresh Mixtral checkpoint validation
- all 59 source shards `safe_open` validation
- AirLLM route to `AirLLMMixtral`
- boot-only proof
- Transformers 4.44.2 compatibility proof
- manual repaired split integrity audit
- protected repaired split runtime bypass
- bounded inference pass across all 59 layers

## What failed

AirLLM 2.11.0's built-in Mixtral splitter produces incomplete layer files for this 59-shard Mixtral layout.

Observed failure pattern:

- layer 25 expected 31 tensors, actual 28
- layer 26 expected 31 tensors, actual 27
- missing tensors increase across later layers
- layers 52–55 were empty or effectively unusable in the bad split

The resulting inference failure was:

`RuntimeError: Tensor on device cuda:0 is not on the expected device meta!`

## Root cause

AirLLM's splitter checks file existence, not tensor completeness. It saves logical layer files before all tensors for shard-spanning Mixtral layers are loaded. This creates partial layer files that AirLLM later treats as complete.

## Important limitation

The bounded runtime inference passed, but output quality and structured JSON compliance are not proven. The proof generated text, but did not obey the requested JSON-only format.

## Safety decision

Senior routing remains blocked.

No fallback was used.
Qwen was not used.
No site-packages were modified.
No production integration was performed.

## Required next step before product use

Build a maintained Mixtral AirLLM adapter/fork or wrapper that:

1. Pins the compatible runtime stack.
2. Uses a tensor-complete split generator.
3. Performs split integrity validation before boot.
4. Prevents AirLLM from regenerating known-bad split artifacts.
5. Produces structured senior-review output with validation.
6. Keeps senior/offline review optional and unpromoted until quality gates pass.
