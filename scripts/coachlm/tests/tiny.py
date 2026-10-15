"""A tiny random Qwen3-style model and tokenizer built locally (no downloads), for the
optional real-library smoke test. Needs torch, transformers and tokenizers."""
from __future__ import annotations

from pathlib import Path

# ChatML with Qwen3's "thinking off" generation prompt, like the real template.
CHAT_TEMPLATE = (
    "{%- for m in messages %}{{ '<|im_start|>' + m['role'] + '\\n' + m['content'] + '<|im_end|>\\n' }}{%- endfor %}"
    "{%- if add_generation_prompt %}{{ '<|im_start|>assistant\\n' }}"
    "{%- if enable_thinking is defined and enable_thinking is false %}{{ '<think>\\n\\n</think>\\n\\n' }}{%- endif %}"
    "{%- endif %}"
)
SPECIAL = ['<|endoftext|>', '<|im_start|>', '<|im_end|>', '<think>', '</think>']
CORPUS = [
    'You are Kami, a Go teacher. Black R16 is good because it takes the corner. White Q17 attaches.',
    'Question: Why not D4? Facts: B wins 55%. Variations: [[v1]] best (best): B R16, W Q17. The shape is weak.',
    'Sente gote territory influence ladder net ko atari capture eye life death thickness moyo invasion reduction.',
    'ABCDEFGHJKLMNOPQRST 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 . , : ; ( ) [ ] % pts loses',
]


def build(dest: Path, vocab: int = 512) -> Path:
    from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers
    from transformers import PreTrainedTokenizerFast, Qwen3Config, Qwen3ForCausalLM
    import torch

    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    tk = Tokenizer(models.BPE(unk_token=None))
    tk.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tk.decoder = decoders.ByteLevel()
    tr = trainers.BpeTrainer(vocab_size=vocab, special_tokens=SPECIAL, initial_alphabet=pre_tokenizers.ByteLevel.alphabet())
    tk.train_from_iterator(CORPUS * 20, tr)
    fast = PreTrainedTokenizerFast(tokenizer_object=tk, eos_token='<|im_end|>', pad_token='<|endoftext|>',
                                   additional_special_tokens=SPECIAL[1:])
    fast.chat_template = CHAT_TEMPLATE
    fast.save_pretrained(dest)
    torch.manual_seed(0)
    cfg = Qwen3Config(vocab_size=len(fast), hidden_size=32, intermediate_size=64, num_hidden_layers=2,
                      num_attention_heads=4, num_key_value_heads=2, head_dim=8, max_position_embeddings=4096,
                      tie_word_embeddings=True, eos_token_id=fast.eos_token_id, pad_token_id=fast.pad_token_id,
                      bos_token_id=None)
    model = Qwen3ForCausalLM(cfg)
    model.generation_config.eos_token_id = fast.eos_token_id
    model.generation_config.pad_token_id = fast.pad_token_id
    model.save_pretrained(dest)
    return dest
