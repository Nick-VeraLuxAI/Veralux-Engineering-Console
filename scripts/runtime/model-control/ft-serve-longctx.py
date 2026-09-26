"""Launch FreeToken `ft` for long-context DeepSeek-V4 serving on this workstation.

Two runtime tweaks the FreeToken CLI does not expose (no files in the venv are modified):

* FT_SWA_FULL_TOKENS_RATIO overrides ServerArgs.swa_full_tokens_ratio (DSV4 window/full
  KV pool ratio, default 0.2). The sliding-window pool is most of the KV memory at long
  context and it also sets the single-chunk prefill size (~ratio/2 x context).
* FT_INDEXER_MAX_ELEMS (default 48M) bounds the DSV4 lightning-indexer prefill transient.
  Stock code materialises fp32 scores + int64 masks of [chunk, context/4] per layer, which
  grows with depth and OOMs long prompts; here queries are scored/top-k'd in row blocks.
  Results are identical (per-row causal top-k), only the peak memory changes.

The indexer patch is installed at import time so FreeToken's spawned workers (which
re-import this module as __mp_main__) get it too.
"""
import os
import sys


def _install_indexer_patch() -> None:
    import torch
    from freetoken.models.deepseek_v4 import compress as C

    budget = int(os.environ.get("FT_INDEXER_MAX_ELEMS", str(48_000_000)))

    def _scores_topk(self, q, keys, weights, start_pos, seqlen, offset):
        n_blocks = keys.shape[1]
        step = max(64, budget // max(1, n_blocks))
        if step >= seqlen:
            scores = self.attn.indexer_prefill_logits(q, keys, weights)
            return self.attn.indexer_select_prefill(
                scores, start_pos=start_pos, seqlen=seqlen, ratio=self.compress_ratio,
                topk=self.index_topk, offset=offset,
            )
        outs = []
        for s in range(0, seqlen, step):
            e = min(seqlen, s + step)
            scores = self.attn.indexer_prefill_logits(
                q[:, s:e].contiguous(), keys, weights[:, s:e].contiguous()
            )
            outs.append(self.attn.indexer_select_prefill(
                scores, start_pos=start_pos + s, seqlen=e - s, ratio=self.compress_ratio,
                topk=self.index_topk, offset=offset,
            ))
            del scores
        return torch.cat(outs, dim=1)

    def forward(self, x, qr, start_pos, offset, window_slots, ti=0):
        bsz, seqlen, _ = x.size()
        freqs_cis = self.freqs_cis[start_pos:start_pos + seqlen]
        ratio, rd = self.compress_ratio, self.rope_head_dim
        end_pos = start_pos + seqlen
        q = self.wq_b(qr).unflatten(-1, (self.n_heads, self.head_dim))
        C.apply_rotary_emb(q[..., -rd:], freqs_cis)
        q = C.hadamard_transform(q)
        C.fp4_act_quant_inplace(q, 32)
        self.compressor(x, start_pos, window_slots, ti=ti)
        weights = self.weights_proj(x) * (self.softmax_scale * self.n_heads ** -0.5)
        keys = self.attn.indexer_keys(ti, end_pos // ratio, ratio, self.layer_id, bsz)
        return _scores_topk(self, q, keys, weights, start_pos, seqlen, offset)

    def extend(self, x, qr, start_pos, offset, window_slots, tail_window_slot, ti=0):
        bsz, seqlen, _ = x.size()
        end = start_pos + seqlen
        freqs_cis = self.freqs_cis[start_pos:end]
        ratio, rd = self.compress_ratio, self.rope_head_dim
        q = self.wq_b(qr).unflatten(-1, (self.n_heads, self.head_dim))
        C.apply_rotary_emb(q[..., -rd:], freqs_cis)
        q = C.hadamard_transform(q)
        C.fp4_act_quant_inplace(q, 32)
        self.compressor(x, start_pos, window_slots, tail_window_slot=tail_window_slot, ti=ti)
        weights = self.weights_proj(x) * (self.softmax_scale * self.n_heads ** -0.5)
        keys = self.attn.indexer_keys(ti, end // ratio, ratio, self.layer_id, bsz)
        return _scores_topk(self, q, keys, weights, start_pos, seqlen, offset)

    C.Indexer.forward = forward
    C.Indexer.extend = extend


def _install_args_patch() -> None:
    import freetoken.server.args as _args

    orig = _args.parse_args

    def patched(*a, **kw):
        result, run_shell = orig(*a, **kw)
        ratio = os.environ.get("FT_SWA_FULL_TOKENS_RATIO")
        if ratio:
            object.__setattr__(result, "swa_full_tokens_ratio", float(ratio))
            print(f"[ft-serve-swa] swa_full_tokens_ratio={ratio}", flush=True)
        return result, run_shell

    _args.parse_args = patched


if os.environ.get("FT_INDEXER_PATCH", "1") != "0":
    _install_indexer_patch()

if __name__ == "__main__":
    _install_args_patch()
    print(f"[ft-serve-swa] indexer row-block patch={'on' if os.environ.get('FT_INDEXER_PATCH','1')!='0' else 'off'}", flush=True)
    from freetoken.cli import main

    sys.exit(main())
