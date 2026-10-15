"""Optional uploads (each skips cleanly without its token):

  HF_TOKEN      champion + hive adapters -> <hf-user>/kami-coach       (folders champion/, hive/, kami.json)
                web export (export.py)   -> <hf-user>/kami-coach-web   (what the Kami site downloads)
  GITHUB_TOKEN  the pool -> the coach-lm release (merge-on-upload, pool.py)

Both Hugging Face repos are public: the site downloads the web model without a token.
pull() does the reverse at the start of a run on a new machine (e.g. Kaggle), so every
machine continues the same lineage.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from util import copy_dir, log, read_json

CARD = """---
license: apache-2.0
base_model: {base}
library_name: peft
tags: [go, baduk, weiqi, kami, lora]
---
# Kami coach ({what})

Kami's own small Go-explaining model, grown by the DOPPELGANGER (Dop) training kit
(github.com/PERILTHESKYWING/Dop, scripts/coachlm). It turns facts that KataGo already checked into
plain explanations; it is not meant to find moves itself, and the Kami site checks every answer
against KataGo's facts before showing it.

- `champion/`: the best LoRA adapter so far (it only replaces the previous one when it scores better on held-out tasks)
- `hive/`: the fitness-weighted merge of every member that was eliminated
- `kami.json`: generation, scores and training settings of the champion

Base model: [{base}](https://huggingface.co/{base}), Apache-2.0.
"""

WEB_CARD = """---
license: apache-2.0
base_model: {base}
library_name: transformers.js
pipeline_tag: text-generation
tags: [go, baduk, kami, onnx, webgpu]
---
# Kami coach for the browser

{base} with the Kami champion adapter merged in, exported to ONNX for transformers.js
(`onnx/model_q4f16.onnx` for WebGPU, `onnx/model_q4.onnx` as a fallback). Prompt it with the
tokenizer's chat template and `enable_thinking: false`.
"""


def _api(token: str):
    from huggingface_hub import HfApi
    return HfApi(token=token)


def hf_user(token: str) -> str:
    return _api(token).whoami()['name']


def repo_names(cfg, token: str) -> tuple[str, str]:
    user = None
    if not cfg.hf_repo or not cfg.hf_web_repo:
        user = hf_user(token)
    return cfg.hf_repo or f'{user}/kami-coach', cfg.hf_web_repo or f'{user}/kami-coach-web'


def kami_info(cfg, state: dict) -> dict:
    ch = state.get('champion') or {}
    return {'base': cfg.base_id, 'promptVersion': state.get('promptVersionTrained'), 'champion': ch,
            'hive': {k: v for k, v in (state.get('hive') or {}).items() if k != 'folded'},
            'generation': state.get('generation')}


def upload_adapters(cfg, state: dict, token: str | None = None) -> str:
    token = token or os.environ.get('HF_TOKEN', '').strip()
    if not token:
        return 'adapters not uploaded (no HF_TOKEN)'
    champ = cfg.path('champion')
    if not (champ / 'adapter_config.json').exists():
        return 'no champion yet; nothing to upload'
    repo, _web = repo_names(cfg, token)
    api = _api(token)
    api.create_repo(repo, repo_type='model', private=False, exist_ok=True)
    stage = cfg.path('tmp', 'hf-adapters')
    copy_dir(champ, stage / 'champion')
    if (cfg.path('hive') / 'adapter_config.json').exists():
        copy_dir(cfg.path('hive'), stage / 'hive')
    (stage / 'kami.json').write_text(json.dumps(kami_info(cfg, state), indent=1), encoding='utf-8')
    (stage / 'README.md').write_text(CARD.format(base=cfg.base_id, what='LoRA adapters'), encoding='utf-8')
    ch = state.get('champion') or {}
    api.upload_folder(repo_id=str(repo), folder_path=str(stage),
                      commit_message=f'champion from generation {ch.get("generation")} ({ch.get("run", "")})')
    return f'adapters uploaded to huggingface.co/{repo}'


def upload_web(cfg, web_dir: Path, token: str | None = None) -> str:
    token = token or os.environ.get('HF_TOKEN', '').strip()
    if not token:
        return 'web model not uploaded (no HF_TOKEN)'
    web_dir = Path(web_dir)
    if not (web_dir / 'onnx').exists():
        return f'no web export in {web_dir}; run export.py first'
    _repo, web = repo_names(cfg, token)
    api = _api(token)
    api.create_repo(web, repo_type='model', private=False, exist_ok=True)
    readme = web_dir / 'README.md'
    if not readme.exists():
        readme.write_text(WEB_CARD.format(base=cfg.base_id), encoding='utf-8')
    api.upload_folder(repo_id=web, folder_path=str(web_dir), commit_message='web export of the champion')
    return f'web model uploaded to huggingface.co/{web}'


def pull(cfg, state: dict, token: str | None = None) -> str:
    """On a machine with no champion yet, download the shared champion and hive (public repo)."""
    if (cfg.path('champion') / 'adapter_config.json').exists():
        return ''
    token = token or os.environ.get('HF_TOKEN', '').strip() or None
    repo = cfg.hf_repo
    if not repo:
        if not token:
            return ''
        repo = repo_names(cfg, token)[0]
    try:
        from huggingface_hub import snapshot_download
        d = Path(snapshot_download(repo, allow_patterns=['champion/*', 'hive/*', 'kami.json'], token=token))
    except Exception as e:  # missing repo, offline, ...
        return f'no shared champion yet ({type(e).__name__})'
    info = read_json(d / 'kami.json', {}) or {}
    if info.get('base') and info['base'] != cfg.base_id:
        return f'shared champion is for {info["base"]}, not {cfg.base_id}; starting fresh'
    if (d / 'champion' / 'adapter_config.json').exists():
        copy_dir(d / 'champion', cfg.path('champion'))
        ch = dict(info.get('champion') or {})
        ch['fit'] = None              # re-measured on this machine's eval set before it can block anyone
        ch.setdefault('genes', None)
        ch.setdefault('member', 'shared')
        ch.setdefault('generation', 0)
        state['champion'] = ch
    if (d / 'hive' / 'adapter_config.json').exists():
        copy_dir(d / 'hive', cfg.path('hive'))
        h = info.get('hive') or {}
        state['hive'] = {'mass': float(h.get('mass', 1.0)), 'folded': [], 'rank': int(h.get('rank', 32))}
    log(f'continuing the shared lineage from huggingface.co/{repo}')
    return f'pulled champion and hive from {repo}'
