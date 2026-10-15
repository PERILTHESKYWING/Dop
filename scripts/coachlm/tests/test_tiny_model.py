"""Optional smoke test with the REAL libraries (torch, transformers, peft, trl) on a tiny random
model built locally: answer, SFT + DPO, rank change via merge.fold, hive merge loaded back
by peft, and export.merge_into against peft's own merge. Skipped when the libraries are
missing (the default suite never needs them). Run it after installing requirements.txt:
    python -m pytest scripts/coachlm/tests/test_tiny_model.py
"""
import json

import pytest

for mod in ('torch', 'transformers', 'peft', 'trl', 'datasets', 'tokenizers', 'safetensors'):
    pytest.importorskip(mod)

import torch  # noqa: E402

from config import load_config  # noqa: E402
from conftest import make_task  # noqa: E402


@pytest.fixture(scope='module')
def setup(tmp_path_factory):
    import tiny
    from generate import Base
    root = tmp_path_factory.mktemp('tiny')
    model_dir = tiny.build(root / 'model')
    cfg = load_config(root / 'data', base_model=str(model_dir), max_new_tokens=8, gen_batch=3, grad_accum=2,
                      max_len=512, dpo_max_len=512)
    return cfg, Base(cfg), root


def test_answer_train_merge_export(setup):
    from export import merge_into
    from generate import answer, chat_text
    from merge import fold, load_adapter
    from train import train_member
    cfg, base, root = setup
    tasks = [make_task(i) for i in range(3)]

    rows = []
    n = answer(base, None, 'pc/m0', tasks, 2, 0.8, False, {('train-000', 'pc/m0~0')}, rows.extend)
    assert n == 5 and len({(r['id'], r['member']) for r in rows}) == 5          # skips what is done
    text = chat_text(base.tok, tasks[0], {'enable_thinking': False})
    assert text.endswith('<|im_start|>assistant\n<think>\n\n</think>\n\n')

    sft = [{'task': t, 'text': t['reference']} for t in tasks]
    dpo = [{'task': t, 'chosen': t['reference'], 'rejected': 'Z99 wins.'} for t in tasks]
    info = train_member(base, None, root / 'm1', {'lr': 1e-3, 'rank': 4}, sft, dpo, 3, 2, cfg)
    assert info['sft_loss'] > 0 and 'dpo_loss' in info
    c1, m1 = load_adapter(root / 'm1')
    assert c1['r'] == 4 and m1 and not any('.ref.' in k for k in m1)
    assert type(base.model).__name__ == 'Qwen3ForCausalLM'                     # adapters fully taken off again

    fold([root / 'm1'], [1.0], 8, root / 'init')                                # child with a bigger rank
    info2 = train_member(base, root / 'init', root / 'm2', {'lr': 1e-3, 'rank': 8}, sft, dpo, 2, 2, cfg)
    assert load_adapter(root / 'm2')[0]['r'] == 8 and info2['sft_rows'] == 3

    fold([root / 'm1', root / 'm2'], [0.4, 0.6], 8, root / 'hive')              # hive loads back into peft
    rows = []
    answer(base, root / 'hive', 'hive', tasks[:1], 1, 0.0, True, set(), rows.extend)
    assert len(rows) == 1

    from peft import PeftModel
    from transformers import AutoModelForCausalLM
    ref = PeftModel.from_pretrained(AutoModelForCausalLM.from_pretrained(cfg.base_id), str(root / 'hive')).merge_and_unload()
    info3 = merge_into(cfg.base_id, root / 'hive', root / 'merged')
    assert info3['layers'] == 2 * 7                                             # 2 layers x 7 target modules
    mine = AutoModelForCausalLM.from_pretrained(str(root / 'merged'))
    sd_ref, sd_mine = ref.state_dict(), mine.state_dict()
    for k, v in sd_ref.items():
        assert torch.allclose(v.float(), sd_mine[k].float(), atol=1e-5), k
    assert json.loads((root / 'merged' / 'config.json').read_text())['model_type'] == 'qwen3'
