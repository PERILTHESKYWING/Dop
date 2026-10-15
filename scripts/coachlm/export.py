"""Champion -> one merged model -> ONNX in the transformers.js layout (q4f16 and q4) for WebGPU.

    python scripts/coachlm/export.py                       # champion adapter, default output folder
    python scripts/coachlm/export.py --adapter <dir> --out <dir> --dtypes q4f16
    python scripts/coachlm/export.py --upload               # and put it on <hf-user>/kami-coach-web

Steps:
  1. merge   (this venv)  base weights + the champion's LoRA delta, written as plain safetensors
             next to the base model's own config and tokenizer files (merge.py math, exact).
  2. onnx    (export venv) optimum-onnx exports text-generation-with-past (input_ids,
             attention_mask, position_ids, past_key_values.* -> logits, present.*), the
             layout transformers.js loads.
  3. quantize (export venv) onnxruntime MatMulNBits 4-bit weights, block 32: model_q4.onnx;
             and float16 first for model_q4f16.onnx (the WebGPU pick: about 1.2-1.5 GB for 1.7B).
  4. check   (export venv) runs each file on the CPU and compares its next-token choices with
             the merged PyTorch model; prints the agreement.

The export venv (<data dir>/venv-export) is separate because optimum-onnx pins an older
transformers than training uses. It is made on first use (CPU PyTorch, about 1 GB).

Site side (thread coach/kami-site): load with transformers.js
  pipeline('text-generation', '<hf-user>/kami-coach-web', { device: 'webgpu', dtype: 'q4f16' })
and build the prompt with the tokenizer's chat template and enable_thinking: false.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

EXPORT_REQS = ['optimum-onnx==0.1.0', 'optimum==2.1.0', 'transformers==4.57.6', 'onnxruntime==1.31.0', 'onnx==1.23.2',
               'onnx-ir==1.0.0']
KEEP_FILES = ('config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json',
              'special_tokens_map.json', 'vocab.json', 'merges.txt', 'added_tokens.json', 'chat_template.jinja', 'LICENSE')
EXTERNAL_LIMIT = 1_900_000_000   # protobuf files cannot pass 2 GB; bigger models keep weights in .onnx_data


def log(*a):
    from util import log as _log
    _log(*a)


# ------------------------------------------------------------------ merge ----

def base_snapshot(model_id: str) -> Path:
    p = Path(model_id)
    if p.is_dir():
        return p
    from huggingface_hub import snapshot_download
    return Path(snapshot_download(model_id, allow_patterns=['*.json', '*.safetensors', '*.txt', '*.jinja', 'LICENSE*']))


def merge_into(base_dir: Path, adapter_dir: Path, out: Path) -> dict:
    """Write base + LoRA delta to `out` (safetensors shards with the same names as the base)."""
    import torch
    from safetensors.torch import load_file, save_file
    from merge import load_adapter, lora_scale

    base_dir, out = Path(base_dir), Path(out)
    acfg, mods = load_adapter(adapter_dir)
    scale = lora_scale(acfg)
    want = {}
    for name in mods:
        key = name.split('base_model.model.', 1)[-1] + '.weight'
        want[key] = name
    out.mkdir(parents=True, exist_ok=True)
    shards = sorted(base_dir.glob('*.safetensors'))
    if not shards:
        raise SystemExit(f'no .safetensors weights in {base_dir}')
    found = 0
    for shard in shards:
        t = load_file(str(shard))
        for key in list(t):
            if key in want:
                a, b = mods[want[key]]
                w = t[key]
                delta = torch.from_numpy(b).float() @ torch.from_numpy(a).float() * scale
                t[key] = (w.float() + delta).to(w.dtype).contiguous()
                found += 1
        save_file(t, str(out / shard.name), metadata={'format': 'pt'})
    if found != len(want):
        raise SystemExit(f'only {found} of {len(want)} adapter layers matched the base weights; wrong base model?')
    for name in KEEP_FILES + ('model.safetensors.index.json',):
        if (base_dir / name).exists():
            shutil.copy2(base_dir / name, out / name)
    return {'layers': found, 'scale': scale, 'rank': acfg.get('r')}


# ------------------------------------------------------- export venv side ----

def export_venv(cfg) -> Path:
    """Python of the export venv, created on first use."""
    venv = cfg.path('venv-export')
    py = venv / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
    if py.exists():
        return py
    log('making the export venv (first time only, about 1 GB)')
    subprocess.run([sys.executable, '-m', 'venv', str(venv)], check=True)
    subprocess.run([str(py), '-m', 'pip', 'install', '-q', 'torch', '--index-url', 'https://download.pytorch.org/whl/cpu'], check=True)
    subprocess.run([str(py), '-m', 'pip', 'install', '-q', *EXPORT_REQS], check=True)
    return py


def onnx_step(merged: Path, out: Path, dtypes: list[str]) -> dict:
    """Runs inside the export venv: ONNX export, quantization, CPU check."""
    import onnx
    from optimum.exporters.onnx import main_export

    merged, out = Path(merged), Path(out)
    raw = out.parent / (out.name + '-fp32')
    if raw.exists():
        shutil.rmtree(raw)
    main_export(model_name_or_path=str(merged), output=str(raw), task='text-generation-with-past', device='cpu')
    (out / 'onnx').mkdir(parents=True, exist_ok=True)
    report = {}
    for dt in dtypes:
        model = onnx.load(str(raw / 'model.onnx'), load_external_data=True)
        if dt == 'q4f16':
            model = to_fp16(model)
        model = quantize_q4(model)
        dest = out / 'onnx' / f'model_{dt}.onnx'
        big = model.ByteSize() > EXTERNAL_LIMIT if hasattr(model, 'ByteSize') else False
        for old in (dest, dest.with_name(dest.name + '_data')):
            if old.exists():
                old.unlink()
        if big:
            onnx.save_model(model, str(dest), save_as_external_data=True, all_tensors_to_one_file=True,
                            location=dest.name + '_data', size_threshold=1024)
        else:
            onnx.save_model(model, str(dest))
        report[dt] = {'external': big, 'mb': round(sum(p.stat().st_size for p in dest.parent.glob(dest.name + '*')) / 1e6, 1)}
    for name in KEEP_FILES:   # the base model's own tokenizer files; the exporter's config.json
        src = (raw if name == 'config.json' else merged) / name
        if not src.exists():
            src = (merged if name == 'config.json' else raw) / name
        if src.exists():
            shutil.copy2(src, out / name)
    # transformers.js reads the chat template from tokenizer_config.json, not chat_template.jinja
    tc_path, jinja = out / 'tokenizer_config.json', out / 'chat_template.jinja'
    if tc_path.exists() and jinja.exists():
        tc = json.loads(tc_path.read_text(encoding='utf-8'))
        if not tc.get('chat_template'):
            tc['chat_template'] = jinja.read_text(encoding='utf-8')
            tc_path.write_text(json.dumps(tc, indent=2, ensure_ascii=False), encoding='utf-8')
    conf = json.loads((out / 'config.json').read_text(encoding='utf-8'))
    conf['transformers.js_config'] = {
        'dtype': 'q4f16' if 'q4f16' in dtypes else dtypes[0],
        'kv_cache_dtype': {'q4f16': 'float16', 'fp16': 'float16'},
        'use_external_data_format': {f'model_{dt}.onnx': True for dt, r in report.items() if r['external']},
    }
    (out / 'config.json').write_text(json.dumps(conf, indent=2), encoding='utf-8')
    report['check'] = check(merged, out, dtypes)
    shutil.rmtree(raw, ignore_errors=True)
    return report


def to_fp16(model):
    """Float16 weights, activations and KV cache (inputs/outputs too, as transformers.js expects
    for q4f16). onnxruntime's converter: onnxconverter-common's left mixed-type Adds in the
    RMSNorm of a Qwen3 export (seen in testing)."""
    from onnxruntime.transformers.float16 import convert_float_to_float16
    big = model.ByteSize() > EXTERNAL_LIMIT
    return convert_float_to_float16(model, keep_io_types=False, disable_shape_infer=big)


def quantize_q4(model):
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
    q = MatMulNBitsQuantizer(model, block_size=32, is_symmetric=True)
    q.process()
    return q.model.model


def check(merged: Path, out: Path, dtypes: list[str], steps: int = 8) -> dict:
    """Greedy next-token agreement between each ONNX file and the merged PyTorch model."""
    import numpy as np
    import onnxruntime as ort
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    try:
        tok = AutoTokenizer.from_pretrained(str(merged))
    except (ValueError, OSError):
        from transformers import PreTrainedTokenizerFast
        tok = PreTrainedTokenizerFast(tokenizer_file=str(merged / 'tokenizer.json'))
        tok.chat_template = (merged / 'chat_template.jinja').read_text(encoding='utf-8') if (merged / 'chat_template.jinja').exists() else None
    ref = AutoModelForCausalLM.from_pretrained(str(merged), torch_dtype=torch.float32).eval()
    msgs = [{'role': 'system', 'content': 'You are Kami, a Go teacher.'}, {'role': 'user', 'content': 'Question: Why not D4?'}]
    try:
        text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    except Exception:
        text = 'Question: Why not D4?'
    ids = tok(text, return_tensors='np', add_special_tokens=False)['input_ids'].astype(np.int64)
    with torch.no_grad():
        want = ref.generate(torch.from_numpy(ids), max_new_tokens=steps, do_sample=False, min_new_tokens=steps)[0, ids.shape[1]:].tolist()
    cfg = ref.config
    n_kv = getattr(cfg, 'num_key_value_heads', cfg.num_attention_heads)
    head = getattr(cfg, 'head_dim', None) or cfg.hidden_size // cfg.num_attention_heads
    res = {}
    for dt in dtypes:
        sess = ort.InferenceSession(str(out / 'onnx' / f'model_{dt}.onnx'), providers=['CPUExecutionProvider'])
        names = {i.name: i for i in sess.get_inputs()}
        kv_type = np.float16 if any('float16' in i.type for n, i in names.items() if n.startswith('past_key_values')) else np.float32
        past = {n: np.zeros((1, n_kv, 0, head), dtype=kv_type) for n in names if n.startswith('past_key_values')}
        cur, got, pos = ids, [], 0
        for _ in range(steps):
            feed = {'input_ids': cur, 'attention_mask': np.ones((1, pos + cur.shape[1]), dtype=np.int64), **past}
            if 'position_ids' in names:
                feed['position_ids'] = np.arange(pos, pos + cur.shape[1], dtype=np.int64)[None]
            outs = sess.run(None, feed)
            onames = [o.name for o in sess.get_outputs()]
            logits = outs[onames.index('logits')]
            nxt = int(np.argmax(logits[0, -1]))
            got.append(nxt)
            past = {n.replace('present', 'past_key_values'): v for n, v in zip(onames, outs) if n.startswith('present')}
            pos += cur.shape[1]
            cur = np.array([[nxt]], dtype=np.int64)
        same = sum(1 for a, b in zip(want, got) if a == b)
        res[dt] = {'agree': f'{same}/{steps}', 'kv': 'float16' if kv_type == np.float16 else 'float32'}
    return res


# ------------------------------------------------------------------ main ----

def main(argv=None):
    ap = argparse.ArgumentParser(description='Export the champion for the browser (transformers.js, WebGPU)')
    sub = ap.add_subparsers(dest='cmd')
    s = sub.add_parser('onnx-step', help=argparse.SUPPRESS)
    s.add_argument('--merged', required=True)
    s.add_argument('--out', required=True)
    s.add_argument('--dtypes', default='q4f16,q4')
    ap.add_argument('--data-dir')
    ap.add_argument('--adapter', help='adapter folder (default: the champion)')
    ap.add_argument('--out', help='web export folder (default: <data dir>/export/web)')
    ap.add_argument('--dtypes', default='q4f16,q4')
    ap.add_argument('--merge-only', action='store_true', help='stop after writing the merged model')
    ap.add_argument('--upload', action='store_true', help='then upload it to <hf-user>/kami-coach-web (HF_TOKEN)')
    a = ap.parse_args(argv)
    if a.cmd == 'onnx-step':
        print(json.dumps(onnx_step(Path(a.merged), Path(a.out), a.dtypes.split(','))))
        return
    from config import load_config, load_env_file
    cfg = load_config(Path(a.data_dir) if a.data_dir else None)
    load_env_file(cfg.path('.env'))
    os.environ.setdefault('HF_HOME', str(cfg.path('hf')))   # same model cache as run.py
    adapter = Path(a.adapter) if a.adapter else cfg.path('champion')
    if not (adapter / 'adapter_config.json').exists():
        raise SystemExit(f'no adapter in {adapter}: train first (run.py) or pass --adapter')
    merged = cfg.path('export', 'merged')
    out = Path(a.out) if a.out else cfg.path('export', 'web')
    log(f'merging {adapter.name} into {cfg.base_id}')
    info = merge_into(base_snapshot(cfg.base_id), adapter, merged)
    log(f'merged {info["layers"]} layers -> {merged}')
    if a.merge_only:
        return
    py = export_venv(cfg)
    log('exporting to ONNX and quantizing (several minutes, needs about 4x the model size in free RAM and disk)')
    p = subprocess.run([str(py), str(Path(__file__).resolve()), 'onnx-step', '--merged', str(merged), '--out', str(out),
                        '--dtypes', a.dtypes], capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit('ONNX export failed:\n' + '\n'.join((p.stderr or '').strip().splitlines()[-15:]))
    report = json.loads(p.stdout.strip().splitlines()[-1])
    log(f'web export ready in {out}: {json.dumps(report)}')
    if a.upload:
        from upload import upload_web
        log(upload_web(cfg, out))


if __name__ == '__main__':
    main()
