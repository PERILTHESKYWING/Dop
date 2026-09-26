"""KataGo's JSON analysis engine running one of the trained networks, for playing against it."""

from __future__ import annotations

import json
import subprocess
import threading
import time
from pathlib import Path

from .cfgfile import write_cfg
from .install import katago_env
from .settings import Paths


class PlayEngine:
    def __init__(self, paths: Paths, backend: str):
        self.paths = paths
        self.backend = backend
        self.proc: subprocess.Popen | None = None
        self.model: Path | None = None
        self.lock = threading.Lock()          # one process switch at a time
        self.write_lock = threading.Lock()
        self.pending: dict[str, dict] = {}
        self.events: dict[str, threading.Event] = {}
        self.next_id = 0

    def _start(self, model: Path) -> None:
        self.close()
        cfg = write_cfg(self.paths.katago_dir / "analysis_example.cfg", self.paths.cfg_dir / "analysis.cfg", {
            "logDir": str(self.paths.logs / "analysis"),
            "reportAnalysisWinratesAs": "BLACK",
            "numAnalysisThreads": 2,
            "numSearchThreadsPerAnalysisThread": 8,
            "nnMaxBatchSize": 32,
        })
        self.proc = subprocess.Popen(
            [str(self.paths.katago_exe), "analysis", "-config", str(cfg), "-model", str(model)],
            cwd=self.paths.katago_dir, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", bufsize=1, env=katago_env(self.paths, self.backend))
        self.model = model
        threading.Thread(target=self._reader, args=(self.proc,), daemon=True).start()

    def _reader(self, proc: subprocess.Popen) -> None:
        assert proc.stdout
        for line in proc.stdout:
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            qid = msg.get("id")
            if qid in self.events:
                if "error" in msg or not msg.get("isDuringSearch", False):
                    self.pending[qid] = msg
                    self.events[qid].set()
        # Process ended: wake anyone still waiting.
        for qid, ev in list(self.events.items()):
            self.pending.setdefault(qid, {"error": "KataGo stopped"})
            ev.set()

    def close(self) -> None:
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.stdin.close()  # type: ignore[union-attr]
                self.proc.wait(timeout=5)
            except Exception:
                self.proc.kill()
        self.proc = None
        self.model = None

    def analyze(self, model: Path, query: dict, timeout: float = 120.0) -> dict:
        with self.lock:
            if self.model != model or self.proc is None or self.proc.poll() is not None:
                self._start(model)
            proc = self.proc
        with self.write_lock:
            self.next_id += 1
            qid = f"q{self.next_id}"
            ev = threading.Event()
            self.events[qid] = ev
            assert proc and proc.stdin
            proc.stdin.write(json.dumps({**query, "id": qid}) + "\n")
            proc.stdin.flush()
        t0 = time.time()
        if not ev.wait(timeout):
            self.events.pop(qid, None)
            raise TimeoutError("KataGo did not answer in time")
        self.events.pop(qid, None)
        res = self.pending.pop(qid)
        if "error" in res:
            raise RuntimeError(res["error"])
        res["elapsed"] = time.time() - t0
        return res


def play_query(body: dict, max_visits: int) -> dict:
    """Turn the website's request into an analysis-engine query for the position after all moves."""
    size = int(body.get("size", 19))
    moves = [[c, m] for c, m in body.get("moves", [])]
    visits = max(1, min(int(body.get("visits", max_visits)), 20000))
    return {
        "moves": moves,
        "initialStones": body.get("initialStones", []),
        "rules": body.get("rules", "chinese"),
        "komi": float(body.get("komi", 7.5)),
        "boardXSize": size,
        "boardYSize": size,
        "maxVisits": visits,
        "analyzeTurns": [len(moves)],
        "includePolicy": False,
    }
