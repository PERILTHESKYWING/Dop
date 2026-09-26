"""The training loop: self-play, shuffle, train, export, rate. Forever, until stopped.

It follows KataGo's python/selfplay/synchronous_loop.sh step for step, in Python so it runs on
Windows without bash, and adds a rating step so progress can be watched.
"""

from __future__ import annotations

import gzip
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import rating
from .cfgfile import write_cfg
from .install import katago_env
from .settings import Paths, Settings

GEN0 = "gen0"


class Stopped(Exception):
    pass


@dataclass
class Status:
    phase: str = "starting"          # starting | selfplay | shuffle | train | export | rating | waiting | paused | stopped | error
    detail: str = ""
    done: int = 0
    total: int = 0
    phase_started: float = field(default_factory=time.time)
    cycle: int = 0
    paused: bool = False
    error: str = ""
    log_tail: list = field(default_factory=list)


class Trainer:
    def __init__(self, home: Path, settings: Settings):
        self.paths = Paths(home)
        self.settings = settings
        self.status = Status()
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.pause_event = threading.Event()
        self.proc: subprocess.Popen | None = None
        self.on_new_generation: list[Callable[[dict], None]] = []
        self.state = self._load_state()

    # ---- persistent state ------------------------------------------------------------------

    def _load_state(self) -> dict:
        p = self.paths.state
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
        return {"created": time.time(), "cycles": 0, "selfplay_games": 0, "generations": [], "pairs": [],
                "training_seconds": 0.0}

    def save_state(self) -> None:
        with self.lock:
            tmp = self.paths.state.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.state, indent=1), encoding="utf-8")
            os.replace(tmp, self.paths.state)

    def generations(self) -> list[dict]:
        with self.lock:
            return list(self.state["generations"])

    def model_file(self, gen_name: str) -> Path | None:
        if gen_name == GEN0:
            f = self.paths.anchors / GEN0 / "model.bin.gz"
            return f if f.exists() else None
        if gen_name.startswith("ref"):
            ref = self.reference_file()
            return ref
        for g in self.generations():
            if g["name"] == gen_name:
                return Path(g["file"])
        return None

    def latest(self) -> dict | None:
        gens = self.generations()
        return gens[-1] if gens else None

    def reference_file(self) -> Path | None:
        refs = sorted(self.paths.reference_dir.glob("*.bin.gz"))
        return refs[0] if refs else None

    def ratings(self) -> dict[str, tuple[float, float]]:
        with self.lock:
            pairs = [rating.Pair(**p) for p in self.state["pairs"]]
        if not pairs:
            return {GEN0: (0.0, 0.0)}
        return rating.fit(pairs, GEN0)

    # ---- status ----------------------------------------------------------------------------

    def set_phase(self, phase: str, detail: str = "", total: int = 0) -> None:
        with self.lock:
            self.status.phase = phase
            self.status.detail = detail
            self.status.done = 0
            self.status.total = total
            self.status.phase_started = time.time()
        print(f"[{time.strftime('%H:%M:%S')}] {phase}: {detail}", flush=True)

    def progress(self, done: int, detail: str | None = None) -> None:
        with self.lock:
            self.status.done = done
            if detail is not None:
                self.status.detail = detail

    def pause(self, on: bool) -> None:
        with self.lock:
            self.status.paused = on
        if on:
            self.pause_event.set()
            # Self-play can be cut short safely; the other steps finish first.
            if self.status.phase == "selfplay" and self.proc:
                self._terminate()
        else:
            self.pause_event.clear()

    def stop(self) -> None:
        self.stop_event.set()
        self._terminate()

    def _terminate(self) -> None:
        p = self.proc
        if p and p.poll() is None:
            try:
                p.terminate()
            except OSError:
                pass

    # ---- running programs ------------------------------------------------------------------

    def run(self, cmd: list, log_name: str, cwd: Path | None = None, on_line: Callable[[str], None] | None = None,
            env: dict | None = None, check: bool = True) -> int:
        if self.stop_event.is_set():
            raise Stopped()
        log_path = self.paths.logs / log_name
        cmd = [str(c) for c in cmd]
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(f"\n==== {time.strftime('%Y-%m-%d %H:%M:%S')} {' '.join(cmd)}\n")
            log.flush()
            self.proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                         encoding="utf-8", errors="replace", env=env, bufsize=1)
            assert self.proc.stdout
            for line in self.proc.stdout:
                log.write(line)
                line = line.rstrip()
                if line:
                    with self.lock:
                        tail = self.status.log_tail
                        tail.append(line[-300:])
                        del tail[:-30]
                if on_line:
                    try:
                        on_line(line)
                    except Exception:
                        pass
            code = self.proc.wait()
            self.proc = None
        if self.stop_event.is_set():
            raise Stopped()
        if code != 0 and check and not self.pause_event.is_set():
            what = Path(cmd[2]).name if cmd[1] == "-u" else f"{Path(cmd[0]).name} {cmd[1] if len(cmd) > 1 else ''}"
            raise RuntimeError(f"{what} failed with exit code {code}; see {log_path}")
        return code

    def python(self, script: str, *args, log: str, on_line=None, check=True) -> int:
        env = dict(os.environ)
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        return self.run([sys.executable, "-u", script, *args], log, cwd=self.paths.python_dir, on_line=on_line, env=env, check=check)

    def katago(self, *args, log: str, on_line=None, check=True) -> int:
        return self.run([self.paths.katago_exe, *args], log, cwd=self.paths.katago_dir, on_line=on_line,
                        env=katago_env(self.paths, self.settings.backend), check=check)

    # ---- the steps ---------------------------------------------------------------------------

    def selfplay(self) -> None:
        s = self.settings
        cfg = write_cfg(self.paths.training_cfgs / "selfplay1.cfg", self.paths.cfg_dir / "selfplay.cfg",
                        {"logToStdout": True, "logGamesEvery": 1, **s.selfplay_overrides})
        n = s.games_per_cycle
        latest = self.latest()
        self.set_phase("selfplay", f"playing {n} games with {latest['label'] if latest else 'a random network'}", n)
        start_games = self.state["selfplay_games"]
        count = [0]

        def on_line(line: str) -> None:
            # KataGo logs "Started N games with <net>" as each game begins, and the total at the end.
            m = re.search(r"Started (\d+) games with", line)
            if m:
                self.progress(min(int(m.group(1)), n))
            m = re.search(r"Total games: (\d+)", line)
            if m:
                count[0] = int(m.group(1))

        self.katago("selfplay", "-max-games-total", n, "-output-dir", self.paths.selfplay,
                    "-models-dir", self.paths.models, "-config", cfg, log="selfplay.log", on_line=on_line)
        with self.lock:
            self.state["selfplay_games"] = start_games + count[0]
        self.save_state()

    def shuffle(self) -> bool:
        s = self.settings
        self.set_phase("shuffle", "mixing the newest games into a training window")
        stamp = time.strftime("%Y%m%d-%H%M%S")
        out = self.paths.shuffled / (stamp + ".tmp")
        out.mkdir(parents=True, exist_ok=True)
        (self.paths.scratch / "train").mkdir(parents=True, exist_ok=True)
        enough = [True]
        oldest_used: list[str] = []

        def on_line(line: str) -> None:
            m = re.match(r"Using: (.+\.npz) \(\d+-\d+\) \((\d+)/(\d+) desired rows\)", line)
            if m and int(m.group(2)) >= int(m.group(3)):
                oldest_used.append(m.group(1))
            if line.startswith("Not enough rows"):
                enough[0] = False
                m = re.search(r"only (\d+) \(fewer than (\d+)\)", line)
                if m:
                    self.progress(0, f"collecting data: {int(m.group(1)):,} of {int(m.group(2)):,} positions needed before training starts")

        self.python("shuffle.py", str(self.paths.selfplay) + os.sep,
                    "-expand-window-per-row", 0.4, "-taper-window-exponent", 0.65,
                    "-out-dir", out / "train", "-out-tmp-dir", self.paths.scratch / "train",
                    "-approx-rows-per-out-file", 70000, "-num-processes", s.shuffle_processes,
                    "-keep-target-rows", s.shuffle_keep_rows,
                    "-only-include-md5-path-prop-lbound", 0.0, "-only-include-md5-path-prop-ubound", 1.0,
                    "-min-rows", s.shuffle_min_rows, "-taper-window-scale", s.taper_window_scale,
                    # Rows of old games deleted by prune_selfplay still count towards the window size.
                    "-add-to-data-rows", self.state.get("pruned_rows", 0),
                    log="shuffle.log", on_line=on_line)
        if not (out / "train.json").exists():
            shutil.rmtree(out, ignore_errors=True)
            if enough[0]:
                raise RuntimeError("Shuffle produced no training data; see run/logs/shuffle.log")
            with self.lock:
                self.status.phase = "waiting"
            return False
        os.replace(out, self.paths.shuffled / stamp)
        # Keep the three newest windows (training reads only the newest).
        dirs = sorted(d for d in self.paths.shuffled.iterdir() if d.is_dir() and not d.name.endswith(".tmp"))
        for d in dirs[:-3]:
            shutil.rmtree(d, ignore_errors=True)
        if oldest_used:
            self.prune_selfplay(Path(oldest_used[-1]))
        return True

    def prune_selfplay(self, oldest_used: Path) -> None:
        """Delete self-play data older than the training window, which training can never use again.

        The window only moves forward, so a file older than the oldest one in it is dead weight
        (on a real run, gigabytes a day). Its row count is remembered and passed to the shuffler,
        so the window keeps the size it would have had.
        """
        try:
            cutoff = oldest_used.stat().st_mtime
        except OSError:
            return
        pruned = 0
        for f in self.paths.selfplay.glob("*/tdata/*.npz"):
            try:
                if f.stat().st_mtime < cutoff:
                    rows = _npz_rows(f)
                    f.unlink()
                    pruned += rows
            except OSError:
                continue
        for d in self.paths.selfplay.iterdir():
            if d.is_dir() and d.name != "random" and not any((d / "tdata").glob("*.npz")) and (d / "tdata").exists():
                latest = self.latest()
                if latest and d.name == latest["name"]:
                    continue
                shutil.rmtree(d, ignore_errors=True)
        if pruned:
            with self.lock:
                self.state["pruned_rows"] = self.state.get("pruned_rows", 0) + pruned
            self.save_state()

    def train(self) -> None:
        s = self.settings
        where = "on the GPU" if _torch_cuda() else "on the CPU"
        self.set_phase("train", f"training the {s.model_kind} network {where}")
        args = ["-traindir", self.paths.train, "-latestdatadir", self.paths.shuffled,
                "-exportdir", self.paths.to_export, "-exportprefix", "dop",
                "-pos-len", 19, "-batch-size", s.batch_size, "-model-kind", s.model_kind,
                "-samples-per-epoch", s.samples_per_epoch, "-swa-period-samples", s.swa_period_samples,
                "-quit-if-no-data", "-stop-when-train-bucket-limited", "-no-repeat-files",
                "-max-train-bucket-per-new-data", s.max_train_per_data,
                "-max-train-bucket-size", s.max_train_samples_per_cycle]
        # torch.compile needs Triton, which PyTorch does not ship for Windows.
        if platform.system() == "Windows" or not _torch_cuda():
            args.append("-no-compile")
        t0 = time.time()

        def on_line(line: str) -> None:
            m = re.search(r"nsamp\s*=?\s*(\d+)", line)
            if m:
                self.progress(0, f"training the {s.model_kind} network: {int(m.group(1)):,} positions seen in total")

        self.python("train.py", *args, log="train.log", on_line=on_line)
        with self.lock:
            self.state["training_seconds"] = self.state.get("training_seconds", 0.0) + time.time() - t0

    def export(self) -> list[dict]:
        new = []
        src_dirs = sorted((d for d in self.paths.to_export.iterdir()
                           if d.is_dir() and not d.name.endswith((".tmp", ".exported"))),
                          key=lambda d: d.stat().st_mtime)
        for src in src_dirs:
            self.set_phase("export", f"exporting {src.name}")
            name = src.name
            tmp = self.paths.to_export / (name + ".exported")
            shutil.rmtree(tmp, ignore_errors=True)
            tmp.mkdir()
            self.python("export_model_pytorch.py", "-checkpoint", src / "model.ckpt", "-export-dir", tmp,
                        "-model-name", name, "-filename-prefix", "model", "-use-swa", log="export.log")
            _gzip(tmp / "model.bin")
            target = self.paths.models / name
            if target.exists():
                shutil.rmtree(tmp)
            else:
                (self.paths.selfplay / name / "sgfs").mkdir(parents=True, exist_ok=True)
                (self.paths.selfplay / name / "tdata").mkdir(parents=True, exist_ok=True)
                os.replace(tmp, target)
            shutil.rmtree(src, ignore_errors=True)
            new.append(self._register(name, target / "model.bin.gz"))
        if new:
            self.prune_models()
        return new

    def prune_models(self, keep_recent: int = 20, keep_every: int = 10) -> None:
        """Keep the newest networks and every tenth one; delete the rest (a few MB each, dozens a day).

        Their ratings stay in the history; only the files go, so they can no longer be played.
        """
        gens = self.generations()
        for g in gens[:-keep_recent]:
            if g["gen"] % keep_every == 0 or not g.get("rated"):
                continue
            d = Path(g["file"]).parent
            if d.exists() and d.parent == self.paths.models:
                shutil.rmtree(d, ignore_errors=True)

    def _register(self, name: str, file: Path) -> dict:
        m = re.search(r"-s(\d+)-d(\d+)", name)
        with self.lock:
            gens = self.state["generations"]
            existing = next((g for g in gens if g["name"] == name), None)
            if existing:
                return existing
            n = len(gens) + 1
            g = {"gen": n, "name": name, "label": f"gen{n}", "file": str(file), "created": time.time(),
                 "trainSamples": int(m.group(1)) if m else None, "dataRows": int(m.group(2)) if m else None,
                 "selfplayGames": self.state["selfplay_games"], "rated": False}
            gens.append(g)
        self.save_state()
        for cb in self.on_new_generation:
            cb(g)
        return g

    def ensure_gen0(self) -> None:
        f = self.paths.anchors / GEN0 / "model.bin.gz"
        if f.exists():
            return
        self.set_phase("export", "creating the untrained starting network (gen 0, the 0 Elo anchor)")
        d = f.parent
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        self.python("export_model_pytorch.py", "-export-random-initialized-model", self.settings.model_kind,
                    "-export-dir", d, "-model-name", "dop-gen0-untrained", "-filename-prefix", "model", log="export.log")
        _gzip(d / "model.bin")

    def rate(self, g: dict) -> None:
        s = self.settings
        gens = self.generations()
        idx = next(i for i, x in enumerate(gens) if x["name"] == g["name"])
        ratings = self.ratings()
        opponents: list[tuple[str, Path, int, int]] = []  # (label, file, visits, games)

        def add(label: str, visits: int, games: int) -> None:
            f = self.model_file_by_label(label)
            if f and f.exists() and label != g["label"] and all(o[0] != label for o in opponents):
                opponents.append((label, f, visits, games))

        prev = gens[idx - 1]["label"] if idx > 0 else GEN0
        add(prev, s.rating_visits, s.rating_games)
        if idx >= 3:
            # An older generation for a longer baseline: the nearest one to half way that is still kept.
            kept = [x for x in gens[:idx - 1] if Path(x["file"]).exists()]
            if kept:
                mid = min(kept, key=lambda x: abs(x["gen"] - (idx + 1) // 2))
                add(mid["label"], s.rating_visits, s.rating_games)
        prev_elo = ratings.get(prev, (0.0, 0.0))[0]
        if prev_elo < 1500 or idx < 2:
            add(GEN0, s.rating_visits, max(2, s.rating_games // 2))
        if self.reference_file() and (g["gen"] % max(1, s.reference_every) == 0):
            add("ref-policy", 1, s.reference_games)
            add("ref", s.rating_visits, s.reference_games)

        total = sum(o[3] for o in opponents)
        self.set_phase("rating", f"{g['label']} is playing {total} rating games against {', '.join(o[0] for o in opponents)}", total)
        out = self.paths.rating / g["label"]
        shutil.rmtree(out, ignore_errors=True)
        before = [0]

        def on_line(line: str) -> None:
            m = re.search(r"Started (\d+) games", line)
            if m:
                self.progress(min(before[0] + int(m.group(1)), total))

        # One two-bot match per opponent, so each opponent gets exactly its number of games,
        # half with each colour.
        for label, f, visits, games in opponents:
            cfg = write_cfg(self.paths.katago_dir / "match_example.cfg", self.paths.cfg_dir / "match.cfg", {
                "logToStdout": True, "logGamesEvery": 1,
                "numBots": 2, "numGameThreads": min(s.rating_game_threads, games), "numGamesTotal": games,
                "botName0": g["label"], "nnModelFile0": g["file"], "maxVisits0": s.rating_visits,
                "botName1": label, "nnModelFile1": f, "maxVisits1": visits,
                "koRules": "POSITIONAL", "scoringRules": "AREA", "taxRules": "NONE",
                "multiStoneSuicideLegals": "false", "hasButtons": "false",
                "bSizes": s.rating_board_size, "bSizeRelProbs": 1, "allowRectangleProb": 0.0,
                "komiAuto": False, "komiMean": 7.5 if s.rating_board_size >= 13 else 7.0,
                "handicapProb": 0.0, "maxMovesPerGame": 3 * s.rating_board_size ** 2,
            }, drop=("botName", "nnModelFile", "maxVisits"))
            sub = out / label
            sub.mkdir(parents=True, exist_ok=True)
            self.katago("match", "-config", cfg, "-sgf-output-dir", sub,
                        "-log-file", self.paths.logs / "match-katago.log", log="match.log", on_line=on_line)
            before[0] += games
        # Results are added only once all matches are done, so a run stopped half way through
        # rating replays this generation's matches without counting any game twice.
        with self.lock:
            pairs = {(p["a"], p["b"]): rating.Pair(**p) for p in self.state["pairs"]}
            for label, *_ in opponents:
                for black, white, winner in rating.read_sgfs_dir(out / label):
                    rating.add_result(pairs, winner, black, white)
            self.state["pairs"] = [p.__dict__ for p in pairs.values()]
            for x in self.state["generations"]:
                if x["name"] == g["name"]:
                    x["rated"] = True
        self.save_state()

    def model_file_by_label(self, label: str) -> Path | None:
        if label == GEN0 or label.startswith("ref"):
            return self.model_file(label)
        for g in self.generations():
            if g["label"] == label:
                return Path(g["file"])
        return None

    # ---- main loop ---------------------------------------------------------------------------

    def wait_if_paused(self) -> None:
        if not self.pause_event.is_set():
            return
        prev = self.status.phase
        self.set_phase("paused", "paused from the website; press Resume to continue")
        while self.pause_event.is_set() and not self.stop_event.is_set():
            time.sleep(0.5)
        if self.stop_event.is_set():
            raise Stopped()
        self.set_phase(prev, "resuming")

    def loop(self) -> None:
        self.paths.ensure()
        try:
            self.ensure_gen0()
            self.export()  # anything a previous run trained but did not export
            while not self.stop_event.is_set():
                self.wait_if_paused()
                for g in self.generations():
                    if not g.get("rated"):
                        self.rate(g)
                        self.wait_if_paused()
                with self.lock:
                    self.status.cycle = self.state["cycles"] + 1
                self.selfplay()
                self.wait_if_paused()
                if self.shuffle():
                    self.wait_if_paused()
                    self.train()
                    self.export()
                with self.lock:
                    self.state["cycles"] += 1
                self.save_state()
        except Stopped:
            pass
        except Exception as e:
            with self.lock:
                self.status.phase = "error"
                self.status.error = str(e)
            print(f"ERROR: {e}", flush=True)
            raise
        finally:
            if self.status.phase != "error":
                self.set_phase("stopped", "the trainer is not running")


def _npz_rows(path: Path) -> int:
    """Number of rows in a KataGo training .npz, read from an array header without loading it."""
    import zipfile

    import numpy as np

    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.startswith("binaryInputNCHWPacked"))
        with z.open(name) as f:
            version = np.lib.format.read_magic(f)
            read = np.lib.format.read_array_header_1_0 if version == (1, 0) else np.lib.format.read_array_header_2_0
            shape, _, _ = read(f)
    return int(shape[0])


def _gzip(path: Path) -> Path:
    dst = path.with_suffix(path.suffix + ".gz")
    with open(path, "rb") as fi, gzip.open(dst, "wb", compresslevel=6) as fo:
        shutil.copyfileobj(fi, fo)
    path.unlink()
    return dst


def _torch_cuda() -> bool:
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False
