from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from airllm.init_model_spike import EXPECTED_LAYER_FILES, run_init_model_spike_preflight
from airllm.nemotronh_config import validate_nemotronh_config_at_path
from airllm.nemotronh_layer_map import NEMOTRONH_LAYER_NAMES
from airllm.split_cache_path import read_split_cache_dir_from_env, read_super_model_path_from_env

LAYER_LOAD_PROBE_STATUS = "s5_layer_load_probe"
DEFAULT_PROBE_LAYER_NAMES = [
    NEMOTRONH_LAYER_NAMES["embed"],
    f'{NEMOTRONH_LAYER_NAMES["layer_prefix"]}.0',
]
OPTIONAL_PROBE_LAYER_NAMES = [
    NEMOTRONH_LAYER_NAMES["norm"],
]


def parse_probe_layer_tokens(tokens: list[str] | None) -> list[str]:
    if not tokens:
        return list(DEFAULT_PROBE_LAYER_NAMES)
    layer_prefix = NEMOTRONH_LAYER_NAMES["layer_prefix"]
    resolved: list[str] = []
    for token in tokens:
        normalized = token.strip()
        if not normalized:
            continue
        if normalized in {"embed", "embeddings"}:
            resolved.append(NEMOTRONH_LAYER_NAMES["embed"])
        elif normalized in {"norm", "norm_f"}:
            resolved.append(NEMOTRONH_LAYER_NAMES["norm"])
        elif normalized in {"lm_head", "head"}:
            resolved.append(NEMOTRONH_LAYER_NAMES["lm_head"])
        elif normalized.isdigit():
            resolved.append(f"{layer_prefix}.{normalized}")
        elif normalized.startswith("backbone."):
            resolved.append(normalized)
        else:
            raise ValueError(f"Unknown probe layer token: {token}")
    seen: set[str] = set()
    unique: list[str] = []
    for name in resolved:
        if name not in seen:
            seen.add(name)
            unique.append(name)
    return unique


@dataclass(frozen=True)
class LayerLoadProbePreflight:
    status: str
    model_path: str
    split_output_path: str | None
    architecture: str | None
    materialized_layer_files: int
    split_materialized: bool
    layer0_split_exists: bool
    probe_layer_names: list[str]
    blocked_reasons: list[str]
    diagnostics: list[str]
    dry_run: bool

    @property
    def passed(self) -> bool:
        return self.status == "ready"


@dataclass(frozen=True)
class LayerLoadProbeResult:
    status: str
    model_path: str
    split_output_path: str | None
    probe_layer_names: list[str]
    blocked_reasons: list[str]
    diagnostics: list[str]
    layer_load_performed: bool
    forward_probe_performed: bool
    forward_probe_status: str | None
    failure_classification: str | None
    gpu_use_performed: bool
    generation_performed: bool
    boot_performed: bool

    @property
    def passed(self) -> bool:
        return self.status in {"layer_load_probe_ready", "layer_forward_probe_ready", "layer_forward_probe_unsupported"}


def run_layer_load_probe_preflight(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    dry_run: bool = True,
    probe_layer_names: list[str] | None = None,
    include_norm_layer: bool = False,
) -> LayerLoadProbePreflight:
    blocked: list[str] = []
    diagnostics: list[str] = [f"LAYER_LOAD_PROBE_STATUS:{LAYER_LOAD_PROBE_STATUS}"]
    if model_path is None:
        model_path = read_super_model_path_from_env(env)

    layers = list(probe_layer_names or DEFAULT_PROBE_LAYER_NAMES)
    if include_norm_layer and NEMOTRONH_LAYER_NAMES["norm"] not in layers:
        layers.append(NEMOTRONH_LAYER_NAMES["norm"])

    init_preflight = run_init_model_spike_preflight(model_path=model_path, env=env, dry_run=True)
    diagnostics.extend(init_preflight.diagnostics)
    blocked.extend(init_preflight.blocked_reasons)

    architecture = None
    if Path(model_path).is_dir():
        config_validation = validate_nemotronh_config_at_path(model_path)
        diagnostics.extend(config_validation.diagnostics)
        architecture = config_validation.architecture
        if not config_validation.passed:
            blocked.extend(config_validation.blocked_reasons)

    split_output_path = init_preflight.split_output_path
    layer0_split_exists = False
    if split_output_path:
        layer0_file = Path(split_output_path) / "backbone.layers.0.safetensors"
        layer0_split_exists = layer0_file.is_file()
        diagnostics.append(f"LAYER0_SPLIT_EXISTS:{layer0_split_exists}")
        if not layer0_split_exists:
            blocked.append("LAYER0_SPLIT_MISSING")

    for layer_name in layers:
        if split_output_path:
            split_file = Path(split_output_path) / f"{layer_name}.safetensors"
            if not split_file.is_file():
                blocked.append("split_file_missing")
                diagnostics.append(f"SPLIT_FILE_MISSING:{split_file}")

    status = "ready" if not blocked else "blocked"
    return LayerLoadProbePreflight(
        status=status,
        model_path=model_path,
        split_output_path=split_output_path,
        architecture=architecture,
        materialized_layer_files=init_preflight.materialized_layer_files,
        split_materialized=init_preflight.materialized_layer_files >= EXPECTED_LAYER_FILES,
        layer0_split_exists=layer0_split_exists,
        probe_layer_names=layers,
        blocked_reasons=blocked,
        diagnostics=diagnostics,
        dry_run=dry_run,
    )


def run_layer_load_probe(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    allow_layer_load_probe: bool = False,
    confirm_layer_load_probe: bool = False,
    allow_layer_forward_probe: bool = False,
    confirm_layer_forward_probe: bool = False,
    probe_layer_names: list[str] | None = None,
    include_norm_layer: bool = False,
    forward_layer_index: int = 0,
) -> LayerLoadProbeResult:
    dry_run = not (allow_layer_load_probe and confirm_layer_load_probe)
    preflight = run_layer_load_probe_preflight(
        model_path=model_path,
        env=env,
        dry_run=dry_run,
        probe_layer_names=probe_layer_names,
        include_norm_layer=include_norm_layer,
    )

    if dry_run:
        return LayerLoadProbeResult(
            status="dry_run",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            probe_layer_names=preflight.probe_layer_names,
            blocked_reasons=preflight.blocked_reasons,
            diagnostics=[*preflight.diagnostics, "LAYER_LOAD_PROBE_DRY_RUN"],
            layer_load_performed=False,
            forward_probe_performed=False,
            forward_probe_status=None,
            failure_classification=None,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )

    if not preflight.passed:
        return LayerLoadProbeResult(
            status="layer_load_probe_blocked",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            probe_layer_names=preflight.probe_layer_names,
            blocked_reasons=preflight.blocked_reasons or ["LAYER_LOAD_PROBE_PREFLIGHT_BLOCKED"],
            diagnostics=preflight.diagnostics,
            layer_load_performed=False,
            forward_probe_performed=False,
            forward_probe_status=None,
            failure_classification=None,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )

    split_cache_dir = read_split_cache_dir_from_env(env)
    run_forward = allow_layer_forward_probe and confirm_layer_forward_probe
    diagnostics = list(preflight.diagnostics)
    try:
        from airllm.layer_load_probe_runtime import run_guarded_layer_load_probe

        probe_details = run_guarded_layer_load_probe(
            model_path=preflight.model_path,
            split_cache_dir=split_cache_dir,
            probe_layer_names=preflight.probe_layer_names,
            run_forward_probe=run_forward,
            forward_layer_index=forward_layer_index,
        )
        diagnostics.extend(
            [
                f"LAYERS_LOADED:{probe_details.get('layers_loaded')}",
                f"LAYERS_ATTEMPTED:{probe_details.get('layers_attempted')}",
                f"LAYER0_BLOCK_SIGNATURE:{probe_details.get('layer0_block_signature')}",
                "LAYER_LOAD_PROBE_EXECUTED",
            ]
        )
        load_ok = (
            probe_details.get("layer_load_performed") is True
            and probe_details.get("layers_loaded") == probe_details.get("layers_attempted")
        )
        forward_probe = probe_details.get("forward_probe")
        forward_status = forward_probe.get("status") if isinstance(forward_probe, dict) else None
        failure_classification = None
        if probe_details.get("load_errors"):
            failure_classification = probe_details["load_errors"][0].get("failure_classification")
        elif isinstance(forward_probe, dict):
            failure_classification = forward_probe.get("failure_classification")

        if not load_ok:
            status = "layer_load_probe_failed"
        elif run_forward and forward_status:
            status = forward_status
        else:
            status = "layer_load_probe_ready"

        return LayerLoadProbeResult(
            status=status,
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            probe_layer_names=preflight.probe_layer_names,
            blocked_reasons=[] if load_ok else ["LAYER_LOAD_FAILED"],
            diagnostics=[*diagnostics, f"PROBE_DETAILS:{probe_details}"],
            layer_load_performed=bool(probe_details.get("layer_load_performed")),
            forward_probe_performed=bool(
                isinstance(forward_probe, dict) and forward_probe.get("forward_performed")
            ),
            forward_probe_status=forward_status,
            failure_classification=failure_classification,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )
    except Exception as error:  # pragma: no cover - runtime probe path
        diagnostics.append(f"LAYER_LOAD_PROBE_ERROR:{type(error).__name__}:{error}")
        return LayerLoadProbeResult(
            status="layer_load_probe_failed",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            probe_layer_names=preflight.probe_layer_names,
            blocked_reasons=["LAYER_LOAD_PROBE_FAILED"],
            diagnostics=diagnostics,
            layer_load_performed=False,
            forward_probe_performed=False,
            forward_probe_status=None,
            failure_classification="unknown",
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )
