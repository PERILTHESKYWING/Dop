"""Short LoRA training of one member: SFT on good answers, then DPO on (better, worse) pairs.

Fitted to a 12 GB card: the base stays in bf16 (fp16 on cards without bf16, like Kaggle's T4),
only the LoRA weights train (fp32), gradient checkpointing is on, batch 1 with gradient
accumulation, prompts are cut at max_len. DPO (trl) uses a frozen copy of the member's own
starting adapter as the reference, so it learns "better than where I started", not "better
than the untrained base".

Rows:
  SFT  {"task": task, "text": answer}       (a pool winner, or the engine's reference early on)
  DPO  {"task": task, "chosen": text, "rejected": text}
"""
from __future__ import annotations

import time
from pathlib import Path

from generate import Base, chat_text
from util import log, remove


def _deadline_callback(deadline: float | None):
    from transformers import TrainerCallback

    class Deadline(TrainerCallback):
        def on_step_end(self, args, state, control, **kw):
            if deadline and time.time() > deadline:
                control.should_training_stop = True
            return control

    return Deadline()


def _common_args(base: Base, out: Path, lr: float, steps: int, cfg) -> dict:
    import torch
    cuda = base.device == 'cuda'
    return dict(
        output_dir=str(out), max_steps=max(1, steps), learning_rate=lr,
        per_device_train_batch_size=1, gradient_accumulation_steps=cfg.grad_accum,
        lr_scheduler_type='cosine', warmup_steps=max(1, steps // 10), weight_decay=0.0,
        bf16=cuda and base.dtype == torch.bfloat16, fp16=cuda and base.dtype == torch.float16,
        gradient_checkpointing=cuda, gradient_checkpointing_kwargs={'use_reentrant': False} if cuda else None,
        logging_steps=max(1, steps // 4), save_strategy='no', report_to='none', seed=cfg.seed,
        dataloader_num_workers=0, remove_unused_columns=True,
    )


def new_adapter(base: Base, rank: int, cfg):
    from peft import LoraConfig, get_peft_model
    lc = LoraConfig(r=rank, lora_alpha=rank * cfg.lora_alpha_per_rank, lora_dropout=cfg.lora_dropout,
                    target_modules=list(cfg.lora_targets), task_type='CAUSAL_LM', bias='none')
    return get_peft_model(base.model, lc)


def train_member(base: Base, init_dir: Path | None, out_dir: Path, genes: dict, sft_rows: list[dict],
                 dpo_rows: list[dict], sft_steps: int, dpo_steps: int, cfg, deadline: float | None = None) -> dict:
    """Train from init_dir (or a fresh adapter of rank genes['rank']) and save to out_dir."""
    from datasets import Dataset
    from trl import DPOConfig, DPOTrainer, SFTConfig, SFTTrainer
    base.load()
    tok = base.tok
    tok.padding_side = 'right'
    work = Path(cfg.path('tmp', 'trainer'))
    info = {'sft_rows': len(sft_rows), 'dpo_rows': len(dpo_rows)}
    model = base.attach(init_dir, trainable=True) if init_dir else new_adapter(base, int(genes['rank']), cfg)
    try:
        model.config.use_cache = False
        if sft_rows and sft_steps > 0:
            ds = Dataset.from_list([{'prompt': chat_text(tok, r['task'], cfg.chat_kwargs), 'completion': r['text'].strip()}
                                    for r in sft_rows])
            args = SFTConfig(**_common_args(base, work, genes['lr'], sft_steps, cfg), max_length=cfg.max_len,
                             packing=False, completion_only_loss=True)
            t = SFTTrainer(model=model, args=args, train_dataset=ds, processing_class=tok,
                           callbacks=[_deadline_callback(deadline)])
            res = t.train()
            info['sft_loss'] = round(float(res.training_loss), 4)
            model = t.model
            del t
        if dpo_rows and dpo_steps > 0 and not (deadline and time.time() > deadline):
            ds = Dataset.from_list([{'prompt': chat_text(tok, r['task'], cfg.chat_kwargs),
                                     'chosen': r['chosen'].strip(), 'rejected': r['rejected'].strip()} for r in dpo_rows])
            # A frozen "ref" copy of the adapter is added by trl and is the DPO reference.
            args = DPOConfig(**_common_args(base, work, genes['lr'] * 0.5, dpo_steps, cfg), max_length=cfg.dpo_max_len,
                             beta=cfg.dpo_beta)
            t = DPOTrainer(model=model, args=args, train_dataset=ds, processing_class=tok,
                           callbacks=[_deadline_callback(deadline)])
            res = t.train()
            info['dpo_loss'] = round(float(res.training_loss), 4)
            model = t.model
            del t
        out_dir = Path(out_dir)
        tmp = out_dir.with_name(out_dir.name + '.tmp')
        remove(tmp)
        model.save_pretrained(str(tmp), selected_adapters=['default'])
        _flatten_default(tmp)
        remove(out_dir)
        tmp.replace(out_dir)
    finally:
        if hasattr(model, 'peft_config') and 'ref' in getattr(model, 'peft_config', {}):
            model.delete_adapter('ref')
        base.detach(model)
        remove(work)
    log(f'trained {out_dir.name}: ' + ', '.join(f'{k} {v}' for k, v in info.items()))
    return info


def _flatten_default(d: Path) -> None:
    """save_pretrained puts non-"default" adapters in a subfolder; we only ever save "default",
    which lands at the top level. Guard against a version that nests it anyway."""
    sub = d / 'default'
    if not (d / 'adapter_config.json').exists() and (sub / 'adapter_config.json').exists():
        for f in sub.iterdir():
            f.replace(d / f.name)
        sub.rmdir()
