from airllm.nemotronh_layer_map import (
    EXPECTED_LAYER_COUNT,
    EXPECTED_PREFIX_COUNT,
    build_layer_name_list,
    build_super_layer_name_list,
)


def test_super_layer_map_has_91_prefixes_for_88_layers() -> None:
    names = build_super_layer_name_list()
    assert len(names) == EXPECTED_PREFIX_COUNT
    assert len(names) == EXPECTED_LAYER_COUNT + 3


def test_layer_names_match_phase_15_prefix_plan() -> None:
    names = build_super_layer_name_list()
    assert names[0] == "backbone.embeddings"
    assert names[1] == "backbone.layers.0"
    assert names[88] == "backbone.layers.87"
    assert names[89] == "backbone.norm_f"
    assert names[90] == "lm_head"


def test_build_layer_name_list_for_mini_config_layers() -> None:
    names = build_layer_name_list(3)
    assert names == [
        "backbone.embeddings",
        "backbone.layers.0",
        "backbone.layers.1",
        "backbone.layers.2",
        "backbone.norm_f",
        "lm_head",
    ]
