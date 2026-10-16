"""Shared test helpers. CPU only, no network, no torch/transformers: the model is faked."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from config import load_config  # noqa: E402
from util import write_jsonl  # noqa: E402

PY = sys.executable
STUB_VERIFY = (PY, str(HERE / 'stub_verify.py'))
STUB_FACTORY = (PY, str(HERE / 'stub_factory.py'))


def make_task(i, split='train', version=1, size=19):
    tid = f'{split}-{i:03d}'
    # variation first moves at Q16 (best) and D4 (refutation): loc = y * size + x
    q16 = (size - 16) * size + 15
    d4 = (size - 4) * size + 3
    return {
        'id': tid, 'promptVersion': version, 'kind': 'position', 'split': split, 'system': 'You are Kami.',
        'prompt': f'Question: Why not D4? ({tid})\nFacts:\n- Black leads by 3.2 points',
        'reference': f'D4 is slow here because the corner is already settled ({tid}). Q16 takes the last big point.',
        'concept': None,
        'explanation': {'position': {'size': size}, 'variations': [
            {'id': 'v1', 'kind': 'best', 'moves': [{'color': 1, 'loc': q16}]},
            {'id': 'v2', 'kind': 'refutation', 'moves': [{'color': 1, 'loc': d4}, {'color': 2, 'loc': q16}]},
        ]},
    }


@pytest.fixture(autouse=True)
def no_openai_key(monkeypatch):
    """No test may reach the real OpenAI API: the tone reviewer is off unless a test gives it a key."""
    for k in ('OPENAI_API_KEY', 'OPENAI_MODEL', 'KAMI_TONE_CAP', 'KAMI_TONE_DAILY_CAP'):
        monkeypatch.delenv(k, raising=False)


@pytest.fixture
def cfg(tmp_path):
    c = load_config(tmp_path / 'data', base_model='tiny/test-model', population=4, train_tasks=4, samples=2,
                    eval_tasks=4, judged_eval_tasks=2, sft_steps=2, dpo_steps=2, first_sft_steps=2, grad_accum=2,
                    judge_min_interval=0.0, tone_min_interval=0.0, hard_tasks=2, keep_gen_dirs=1)
    c.verify_cmd = STUB_VERIFY
    c.factory_cmd = STUB_FACTORY
    c.repo_root = tmp_path
    return c


@pytest.fixture
def tasks_on_disk(cfg):
    train = [make_task(i) for i in range(10)]
    ev = [make_task(i, split='eval') for i in range(6)]
    write_jsonl(cfg.path('tasks', 'tasks.jsonl.gz'), train)
    write_jsonl(cfg.path('tasks', 'eval.jsonl.gz'), ev)
    return train, ev


def write_fake_adapter(d: Path, rank: int, seed: int, quality: float | None = None, out_dim=6, in_dim=5):
    import numpy as np
    from merge import save_adapter
    rng = np.random.default_rng(seed)
    mods = {f'base_model.model.model.layers.{i}.self_attn.q_proj': (rng.normal(size=(rank, in_dim)), rng.normal(size=(out_dim, rank)))
            for i in range(2)}
    save_adapter(d, {'r': rank, 'lora_alpha': rank, 'target_modules': ['q_proj'], 'peft_type': 'LORA'}, mods)
    if quality is not None:
        (Path(d) / 'fake.json').write_text(json.dumps({'quality': quality}))
