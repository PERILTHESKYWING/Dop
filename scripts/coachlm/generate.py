"""Members answer tasks: one base model on the GPU, each member a small LoRA adapter on it.

The base loads once per process and adapters are put on and taken off it, so eight members
cost one model's memory. The model input is the task's `system` + `prompt` in the base
model's chat template (Qwen3 with thinking switched off), exactly what the Kami site sends.
"""
from __future__ import annotations

import re
import time
from pathlib import Path

from truth import tag_member
from util import log

_THINK = re.compile(r'<think>.*?</think>', re.S)


def messages(task: dict) -> list[dict]:
    return [{'role': 'system', 'content': task['system']}, {'role': 'user', 'content': task['prompt']}]


def chat_text(tokenizer, task: dict, chat_kwargs: dict) -> str:
    """The prompt string the model continues (generation prompt included)."""
    return tokenizer.apply_chat_template(messages(task), tokenize=False, add_generation_prompt=True, **chat_kwargs)


def clean(text: str) -> str:
    text = _THINK.sub('', text)
    return text.replace('<think>', '').replace('</think>', '').strip()


def pick_device_dtype():
    import torch
    if torch.cuda.is_available():
        return 'cuda', (torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16)
    return 'cpu', torch.float32


class Base:
    """The shared base model and tokenizer."""

    def __init__(self, cfg, model_id: str | None = None):
        self.cfg = cfg
        self.model_id = model_id or cfg.base_id
        self.model = None
        self.tok = None
        self.device = 'cpu'
        self.dtype = None

    def load(self):
        if self.model is not None:
            return self
        from transformers import AutoModelForCausalLM, AutoTokenizer
        self.device, self.dtype = pick_device_dtype()
        log(f'loading {self.model_id} on {self.device}')
        self.tok = AutoTokenizer.from_pretrained(self.model_id)
        if self.tok.pad_token is None:
            self.tok.pad_token = self.tok.eos_token
        self.model = AutoModelForCausalLM.from_pretrained(self.model_id, dtype=self.dtype).to(self.device)
        self.model.eval()
        return self

    def free(self):
        import gc
        self.model = None
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

    def attach(self, adapter_dir: Path | None, trainable: bool = False):
        """The base with this adapter on it (a PeftModel), or the bare base for None."""
        if adapter_dir is None:
            return self.model
        from peft import PeftModel
        return PeftModel.from_pretrained(self.model, str(adapter_dir), is_trainable=trainable)

    def detach(self, model) -> None:
        """Take every adapter off again (no merging), leaving the clean base."""
        if model is not self.model and hasattr(model, 'unload'):
            self.model = model.unload()
        self.model.eval()
        if hasattr(self.model, 'gradient_checkpointing_disable'):
            self.model.gradient_checkpointing_disable()
        self.model.config.use_cache = True


def answer(base: Base, adapter_dir: Path | None, member: str, tasks: list[dict], k: int, temperature: float,
           greedy: bool, done: set, on_rows, deadline: float | None = None) -> int:
    """Answer each task k times. Skips (task id, tagged member) pairs in `done`; hands each
    finished batch to on_rows([{"id", "member", "text"}]). Returns how many it wrote."""
    import torch
    cfg = base.cfg
    base.load()
    tok = base.tok
    tok.padding_side = 'left'
    jobs = [(t, s) for t in tasks for s in range(k) if (t['id'], tag_member(member, s)) not in done]
    if not jobs:
        return 0
    texts = {t['id']: chat_text(tok, t, cfg.chat_kwargs) for t in tasks}
    jobs.sort(key=lambda j: len(texts[j[0]['id']]))
    model = base.attach(adapter_dir)
    written = 0
    try:
        model.eval()
        for i in range(0, len(jobs), cfg.gen_batch):
            if deadline and time.time() > deadline:
                break
            batch = jobs[i:i + cfg.gen_batch]
            enc = tok([texts[t['id']] for t, _s in batch], return_tensors='pt', padding=True,
                      add_special_tokens=False, truncation=True, max_length=cfg.max_len).to(base.device)
            kw = {'max_new_tokens': cfg.max_new_tokens, 'pad_token_id': tok.pad_token_id}
            if greedy:
                kw.update(do_sample=False)
            else:
                kw.update(do_sample=True, temperature=max(0.05, temperature), top_p=0.95)
            with torch.inference_mode():
                out = model.generate(**enc, **kw)
            new = out[:, enc['input_ids'].shape[1]:]
            decoded = tok.batch_decode(new, skip_special_tokens=True)
            rows = [{'id': t['id'], 'member': tag_member(member, s), 'text': clean(d)} for (t, s), d in zip(batch, decoded)]
            on_rows(rows)
            written += len(rows)
    finally:
        base.detach(model)
    return written
