"""Settings for growing Kami's own small Go-explaining model (the "coach LM").

Everything has a default that fits one 12 GB card (RTX 5070) overnight. Override any field
with `config.json` in the data dir ({"population": 6, ...}) or the environment variables
named below. Nothing here imports torch, so `run.py --check` and the tests stay light.

Base model (KAMI_BASE_MODEL: a key below or any Hugging Face id):
  qwen3-1.7b (default)  Qwen/Qwen3-1.7B, Apache-2.0. Newest small Apache model that
                        transformers.js runs on WebGPU (architecture "qwen3", supported since
                        transformers.js 3.5). Clearly stronger than Qwen2.5-1.5B at following
                        rules and explaining, same browser cost (about 1.2-1.5 GB as q4f16).
                        It can "think"; we always switch that off (enable_thinking=False) so
                        answers are short and the browser does not spend tokens thinking.
  qwen2.5-1.5b          Qwen/Qwen2.5-1.5B-Instruct, Apache-2.0. The proven fallback: many
                        transformers.js WebGPU demos use it. Pick it if a qwen3 export fails.
  qwen3-0.6b            Qwen/Qwen3-0.6B, Apache-2.0. For phones and quick test runs; weaker.
Gemma, Llama, LFM and Phi-style small models were left out: their licences are not
Apache-2.0 (or MIT) or transformers.js support is shakier.
"""
from __future__ import annotations

import json
import os
import platform
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

REPO = 'PERILTHESKYWING/Dop'
RELEASE_TAG = 'coach-lm'
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent

BASE_MODELS = {
    'qwen3-1.7b': {'id': 'Qwen/Qwen3-1.7B', 'license': 'apache-2.0', 'chat': {'enable_thinking': False}},
    'qwen2.5-1.5b': {'id': 'Qwen/Qwen2.5-1.5B-Instruct', 'license': 'apache-2.0', 'chat': {}},
    'qwen3-0.6b': {'id': 'Qwen/Qwen3-0.6B', 'license': 'apache-2.0', 'chat': {'enable_thinking': False}},
}
DEFAULT_BASE = 'qwen3-1.7b'

# Gemini models the judge tries, best first (same chain as shared/llm.ts GEMINI_CHAIN).
GEMINI_CHAIN = ['gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite']

# OpenAI models the tone reviewer (tone.py) tries, cheapest good one first; OPENAI_MODEL goes in front.
OPENAI_CHAIN = ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini']

# Evolvable training settings: name -> (low, high, how it mutates, default).
#   'log'  multiply by exp(N(0, 0.5))      'lin'  add N(0, 0.15 * range)
#   'choice' step to a neighbouring value in the list given as `low`
GENES = {
    'lr': (2e-5, 5e-4, 'log', 1e-4),          # learning rate of the short train
    'rank': ([8, 16, 32], None, 'choice', 16),  # LoRA rank
    'refShare': (0.0, 1.0, 'lin', 0.6),        # data mix: share of SFT rows from the engine's own text
    'dpoShare': (0.0, 0.8, 'lin', 0.3),        # data mix: share of steps spent on (better, worse) pairs
    'temperature': (0.3, 1.2, 'lin', 0.8),     # sampling temperature when answering train tasks
    'hardShare': (0.0, 0.9, 'lin', 0.3),       # share of hard tasks in what it answers and trains on
}


def default_genes() -> dict:
    return {k: v[3] for k, v in GENES.items()}


def default_data_dir() -> Path:
    env = os.environ.get('KAMI_DATA_DIR')
    if env:
        return Path(env).expanduser()
    if platform.system() == 'Windows':
        base = os.environ.get('LOCALAPPDATA') or str(Path.home() / 'AppData' / 'Local')
        return Path(base) / 'kami-train'
    return Path.home() / '.kami-train'


@dataclass
class Config:
    data_dir: Path = field(default_factory=default_data_dir)
    base_model: str = DEFAULT_BASE
    # LoRA (rank itself is a gene; these apply to every member)
    lora_alpha_per_rank: float = 1.0     # alpha = rank * this, so the LoRA scale is 1
    lora_dropout: float = 0.05
    lora_targets: tuple = ('q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj')
    # Population
    population: int = 8
    hive_child_share: float = 0.25       # share of children that start from the hive adapter
    truth_gate: float = 0.95             # share of eval answers that must pass the truth check
    # Per generation
    train_tasks: int = 24                # train tasks each member answers
    samples: int = 2                     # answers per task (k)
    eval_tasks: int = 40                 # fixed held-out eval subset (greedy answers)
    judged_eval_tasks: int = 4           # of those, how many the judge also reads (fixed list)
    max_new_tokens: int = 400
    gen_batch: int = 8
    # Training (fitted to 12 GB: bf16, gradient checkpointing, batch 1 x accumulation)
    max_len: int = 2048
    dpo_max_len: int = 1536
    grad_accum: int = 8
    sft_steps: int = 40                  # optimizer steps of SFT per short train
    dpo_steps: int = 20                  # optimizer steps of DPO per short train (scaled by dpoShare)
    dpo_beta: float = 0.1
    first_sft_steps: int = 80            # generation 0: learn the format from references
    # Pool
    good_min_coverage: float = 0.3       # a passing answer below this coverage is not a "winner"
    pair_margin: float = 0.15            # quality gap needed to make a (better, worse) pair
    # Judge (Gemini, scores only)
    judge_cap: int = 40                  # hard cap on judge calls per run
    judge_daily_cap: int = 40            # and per calendar day on this machine
    judge_share: float = 0.1             # share of train answers sampled for judging
    judge_batch: int = 8                 # answers per judge call (same task)
    judge_min_interval: float = 7.0      # seconds between calls (free tier is about 10 a minute)
    # Tone reviewer (OpenAI API, "ChatGPT"; scores only, optional, billed separately from ChatGPT Plus)
    tone_cap: int = 30                   # hard cap on tone calls per run (one call = one answer)
    tone_daily_cap: int = 30             # and per calendar day on this machine (tone_review.py counts too)
    tone_per_gen: int = 6                # most answers it reads per generation, so later generations get some
    tone_batch: int = 4                  # it reads every passing answer of a task or none; bigger tasks are skipped
    tone_min_interval: float = 2.0       # seconds between calls
    # Self-play
    hard_tasks: int = 8                  # hardest tasks to ask new questions about each generation
    factory_minutes: int = 10
    # Disk (members + hive + champion + pool + generation files + exports; not the venv or model cache)
    disk_cap_gb: float = 20.0
    keep_gen_dirs: int = 3
    # Uploads
    hf_repo: str = ''                    # default <hf-user>/kami-coach
    hf_web_repo: str = ''                # default <hf-user>/kami-coach-web
    repo: str = REPO
    release_tag: str = RELEASE_TAG
    # Commands (Node CLIs from thread "coach/lm-factory"); run from the repo root
    verify_cmd: tuple = ('npx', '--yes', 'tsx', 'scripts/coachlm/verify.ts')
    factory_cmd: tuple = ('npx', '--yes', 'tsx', 'scripts/coachlm/factory.ts')
    repo_root: Path = REPO_ROOT
    seed: int = 1

    # ---- derived paths ----
    @property
    def base_id(self) -> str:
        return BASE_MODELS.get(self.base_model, {}).get('id', self.base_model)

    @property
    def chat_kwargs(self) -> dict:
        if self.base_model in BASE_MODELS:
            return dict(BASE_MODELS[self.base_model]['chat'])
        return {'enable_thinking': False} if 'qwen3' in self.base_model.lower() else {}

    def path(self, *parts: str) -> Path:
        return Path(self.data_dir).joinpath(*parts)

    def to_json(self) -> dict:
        d = asdict(self)
        return {k: (str(v) if isinstance(v, Path) else list(v) if isinstance(v, tuple) else v) for k, v in d.items()}


ENV_MAP = {
    'KAMI_BASE_MODEL': 'base_model',
    'KAMI_POPULATION': 'population',
    'KAMI_DISK_CAP_GB': 'disk_cap_gb',
    'KAMI_JUDGE_CAP': 'judge_cap',
    'KAMI_TONE_CAP': 'tone_cap',
    'KAMI_TONE_DAILY_CAP': 'tone_daily_cap',
    'KAMI_HF_REPO': 'hf_repo',
    'KAMI_HF_WEB_REPO': 'hf_web_repo',
}


def _coerce(name: str, value):
    default = Config.__dataclass_fields__[name].default
    if name in ('data_dir', 'repo_root'):
        return Path(value).expanduser()
    if isinstance(default, bool):
        return value if isinstance(value, bool) else str(value).lower() in ('1', 'true', 'yes')
    if isinstance(default, int):
        return int(value)
    if isinstance(default, float):
        return float(value)
    if isinstance(default, tuple):
        return tuple(value)
    return value


def load_config(data_dir: Path | None = None, **overrides) -> Config:
    """Defaults, then <data dir>/config.json, then KAMI_* environment, then overrides."""
    cfg = Config()
    if data_dir is not None:
        cfg.data_dir = Path(data_dir).expanduser()
    names = {f.name for f in fields(Config)}
    extra = cfg.path('config.json')
    if extra.exists():
        for k, v in json.loads(extra.read_text(encoding='utf-8')).items():
            if k in names and k != 'data_dir':
                setattr(cfg, k, _coerce(k, v))
    for env, k in ENV_MAP.items():
        if os.environ.get(env):
            setattr(cfg, k, _coerce(k, os.environ[env]))
    for k, v in overrides.items():
        if v is not None and k in names:
            setattr(cfg, k, _coerce(k, v))
    return cfg


def load_env_file(path: Path) -> list[str]:
    """Read KEY=value lines (tokens saved by the Windows starter) into os.environ.
    Values already set in the environment win. Returns the names it set."""
    set_names = []
    if not path.exists():
        return set_names
    for raw in path.read_text(encoding='utf-8', errors='replace').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and v and not os.environ.get(k):
            os.environ[k] = v
            set_names.append(k)
    return set_names
