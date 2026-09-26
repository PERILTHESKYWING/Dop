"""Where things live and how big each training cycle is."""

from __future__ import annotations

import json
import os
import platform
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

DEFAULT_PORT = 7474


def default_home() -> Path:
    env = os.environ.get("DOP_TRAINER_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / "DopTrainer"


@dataclass
class Settings:
    """Everything is saved to trainer.json in the home folder, so it can be edited there too."""

    # Which KataGo build to use: "opencl" works on any NVIDIA/AMD GPU with just the graphics driver.
    # "cuda" is faster on NVIDIA but needs the CUDA/cuDNN libraries (Dop Trainer borrows PyTorch's).
    backend: str = "opencl"
    # Size of the network being trained. b6c96 learns fastest at the start; see README for bigger ones.
    model_kind: str = "b6c96"
    # Preset the numbers below came from ("gpu" for a real run, "tiny" for a quick CPU smoke test).
    preset: str = "gpu"

    # Self-play: games per cycle, and overrides for KataGo's selfplay1.cfg.
    games_per_cycle: int = 500
    selfplay_overrides: dict = field(default_factory=dict)

    # Shuffle and training (the numbers from KataGo's synchronous_loop.sh).
    batch_size: int = 128
    samples_per_epoch: int = 100_000
    swa_period_samples: int = 80_000
    max_train_per_data: int = 8
    shuffle_min_rows: int = 100_000
    max_train_samples_per_cycle: int = 500_000
    taper_window_scale: int = 50_000
    shuffle_keep_rows: int = 600_000
    shuffle_processes: int = 4

    # Rating matches after each new network.
    rating_games: int = 16          # games against each opponent (half with each colour)
    rating_visits: int = 100
    rating_board_size: int = 19
    rating_game_threads: int = 16
    reference_every: int = 5        # play the reference networks every N generations
    reference_games: int = 8

    # Local server for the website.
    port: int = DEFAULT_PORT
    allowed_origins: list = field(default_factory=lambda: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "https://*.vercel.app",
    ])
    play_visits: int = 400

    @classmethod
    def load(cls, home: Path) -> "Settings":
        p = home / "trainer.json"
        if not p.exists():
            return cls()
        data = json.loads(p.read_text(encoding="utf-8"))
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known})

    def save(self, home: Path) -> None:
        home.mkdir(parents=True, exist_ok=True)
        (home / "trainer.json").write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")

    def apply_preset(self, name: str) -> None:
        for k, v in PRESETS[name].items():
            setattr(self, k, v)
        self.preset = name


PRESETS: dict[str, dict] = {
    # One desktop GPU (tuned with an RTX 5070 in mind): KataGo's own single-GPU numbers.
    "gpu": dict(
        model_kind="b6c96",
        games_per_cycle=500,
        selfplay_overrides={},
        batch_size=128,
        samples_per_epoch=100_000,
        swa_period_samples=80_000,
        shuffle_min_rows=100_000,
        max_train_samples_per_cycle=500_000,
        taper_window_scale=50_000,
        shuffle_keep_rows=600_000,
        rating_games=16,
        rating_visits=100,
        rating_board_size=19,
        rating_game_threads=16,
        reference_every=5,
        reference_games=8,
    ),
    # A few minutes on a CPU: 9x9, tiny network, a handful of visits. Only for checking the loop works.
    "tiny": dict(
        model_kind="b2c16",
        games_per_cycle=40,
        selfplay_overrides={
            "maxVisits": 32,
            "cheapSearchVisits": 16,
            "reducedVisitsMin": 16,
            "handicapAsymmetricPlayoutProb": 0.0,
            "normalAsymmetricPlayoutProb": 0.0,
            "numGameThreads": 8,
            "nnMaxBatchSize": 8,
            "bSizes": "9",
            "bSizeRelProbs": "1",
            "allowRectangleProb": 0.0,
            "estimateLeadProb": 0.0,
            "maxMovesPerGame": 200,
        },
        batch_size=32,
        samples_per_epoch=1_000,
        swa_period_samples=500,
        shuffle_min_rows=2_000,
        max_train_samples_per_cycle=4_000,
        taper_window_scale=1_000,
        shuffle_keep_rows=8_000,
        shuffle_processes=2,
        rating_games=4,
        rating_visits=8,
        rating_board_size=9,
        rating_game_threads=4,
        reference_every=2,
        reference_games=2,
    ),
}


class Paths:
    def __init__(self, home: Path):
        self.home = home
        self.katago_dir = home / "katago"
        self.src_dir = home / "katago-src"
        self.python_dir = self.src_dir / "python"
        self.training_cfgs = self.src_dir / "cpp" / "configs" / "training"
        self.reference_dir = home / "reference"
        self.cfg_dir = home / "cfg"
        self.run = home / "run"
        self.models = self.run / "models"
        self.selfplay = self.run / "selfplay"
        self.shuffled = self.run / "shuffleddata"
        self.scratch = self.run / "shufflescratch"
        self.train = self.run / "train" / "dop"
        self.to_export = self.run / "torchmodels_toexport"
        self.logs = self.run / "logs"
        self.rating = self.run / "rating"
        self.anchors = self.run / "anchors"
        self.state = self.run / "state.json"

    @property
    def katago_exe(self) -> Path:
        return self.katago_dir / ("katago.exe" if platform.system() == "Windows" else "katago")

    def ensure(self) -> None:
        for d in (self.run, self.models, self.selfplay, self.shuffled, self.scratch, self.train, self.to_export,
                  self.logs, self.rating, self.anchors, self.cfg_dir):
            d.mkdir(parents=True, exist_ok=True)
