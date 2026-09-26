"""A small HTTP server on 127.0.0.1 that the Doppelgänger website talks to.

Only pages from the allowed origins (settings.allowed_origins) get CORS access, so other websites
you visit cannot read or steer the trainer.
"""

from __future__ import annotations

import fnmatch
import json
import os
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import KATAGO_VERSION, __version__
from .engine import PlayEngine, play_query
from .loop import GEN0, Trainer


class Api:
    def __init__(self, trainer: Trainer):
        self.t = trainer
        self.engine = PlayEngine(trainer.paths, trainer.settings.backend)
        self.started = time.time()

    def status(self) -> dict:
        t = self.t
        with t.lock:
            st = t.status
            s = {
                "phase": st.phase, "detail": st.detail, "done": st.done, "total": st.total,
                "phaseSeconds": time.time() - st.phase_started, "cycle": st.cycle, "paused": st.paused,
                "error": st.error, "log": st.log_tail[-8:],
            }
            state = t.state
            s.update({
                "selfplayGames": state["selfplay_games"], "cycles": state["cycles"],
                "trainingHours": state.get("training_seconds", 0.0) / 3600,
                "runStarted": state.get("created"), "generations": len(state["generations"]),
            })
        ratings = t.ratings()
        latest = t.latest()
        s["latest"] = _gen_view(latest, ratings) if latest else None
        s.update({"app": "dop-trainer", "version": __version__, "katago": KATAGO_VERSION,
                  "backend": t.settings.backend, "modelKind": t.settings.model_kind, "preset": t.settings.preset,
                  "uptime": time.time() - self.started})
        return s

    def history(self) -> dict:
        ratings = self.t.ratings()
        gens = [_gen_view(g, ratings) for g in self.t.generations()]
        refs = []
        for label, name in ((GEN0, "Untrained network (gen 0)"), ("ref-policy", "Reference b10, instinct only (1 visit)"),
                            ("ref", f"Reference b10 at {self.t.settings.rating_visits} visits")):
            if label in ratings:
                elo, se = ratings[label]
                refs.append({"label": label, "name": name, "elo": elo, "se": _finite(se)})
        with self.t.lock:
            pairs = list(self.t.state["pairs"])
        return {"generations": gens, "references": refs, "pairs": pairs,
                "ratingVisits": self.t.settings.rating_visits, "ratingBoardSize": self.t.settings.rating_board_size}

    def play(self, body: dict) -> dict:
        want = body.get("model") or "latest"
        gens = self.t.generations()
        if want == "latest":
            if not gens:
                raise ApiError(409, "No trained network yet. The first one appears after the first training cycle.")
            g = gens[-1]
        else:
            g = next((x for x in gens if x["label"] == want), None)
            if g is None:
                raise ApiError(404, f"No generation called {want}")
            if not Path(g["file"]).exists():
                raise ApiError(410, f"{want} was deleted to save disk space (every tenth generation is kept).")
        res = self.engine.analyze(Path(g["file"]), play_query(body, self.t.settings.play_visits))
        infos = sorted(res.get("moveInfos", []), key=lambda m: m.get("order", 0))
        root = res.get("rootInfo", {})
        return {
            "model": g["label"],
            "move": infos[0]["move"] if infos else "pass",
            "winrate": root.get("winrate"),
            "scoreLead": root.get("scoreLead"),
            "visits": root.get("visits"),
            "candidates": [{"move": m["move"], "winrate": m.get("winrate"), "scoreLead": m.get("scoreLead"),
                            "visits": m.get("visits"), "pv": m.get("pv", [])[:8]} for m in infos[:8]],
            "seconds": res.get("elapsed"),
        }

    def control(self, body: dict) -> dict:
        action = body.get("action")
        if action == "pause":
            self.t.pause(True)
        elif action == "resume":
            self.t.pause(False)
        else:
            raise ApiError(400, "action must be pause or resume")
        return {"ok": True, "paused": self.t.status.paused}


class ApiError(Exception):
    def __init__(self, code: int, msg: str):
        super().__init__(msg)
        self.code = code


def _finite(x: float) -> float | None:
    return x if x == x and x not in (float("inf"), float("-inf")) else None


def _gen_view(g: dict, ratings: dict) -> dict:
    elo, se = ratings.get(g["label"], (None, None))
    return {"gen": g["gen"], "label": g["label"], "name": g["name"], "created": g["created"],
            "trainSamples": g.get("trainSamples"), "dataRows": g.get("dataRows"),
            "selfplayGames": g.get("selfplayGames"), "rated": g.get("rated", False),
            "playable": os.path.exists(g["file"]),
            "elo": elo, "se": _finite(se) if se is not None else None}


def origin_allowed(origin: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(origin, p) for p in patterns)


def make_handler(api: Api):
    class Handler(BaseHTTPRequestHandler):
        server_version = "DopTrainer/" + __version__

        def log_message(self, fmt, *args):  # keep the console for the training log
            pass

        def _cors(self) -> bool:
            origin = self.headers.get("Origin")
            if origin is None:
                return True  # not a browser page (curl, scripts on this PC)
            if not origin_allowed(origin, api.t.settings.allowed_origins):
                return False
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            return True

        def _send(self, code: int, obj: dict) -> None:
            data = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            allowed = self._cors()
            if not allowed:
                data = json.dumps({"error": "This website is not allowed to use the trainer. Add it with: "
                                            "run-trainer --allow-origin <site>"}).encode()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self.send_response(204)
            if self._cors():
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                # Chrome asks this before a public site may call a server on this PC.
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

        def _handle(self, fn):
            origin = self.headers.get("Origin")
            if origin is not None and not origin_allowed(origin, api.t.settings.allowed_origins):
                return self._send(403, {})
            try:
                self._send(200, fn())
            except ApiError as e:
                self._send(e.code, {"error": str(e)})
            except Exception as e:
                traceback.print_exc()
                self._send(500, {"error": str(e)})

        def do_GET(self):
            path = self.path.split("?")[0]
            if path in ("/", "/api/status"):
                return self._handle(api.status)
            if path == "/api/history":
                return self._handle(api.history)
            self._send(404, {"error": "not found"})

        def do_POST(self):
            path = self.path.split("?")[0]
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self._send(400, {"error": "bad JSON"})
            if path == "/api/play":
                return self._handle(lambda: api.play(body))
            if path == "/api/control":
                return self._handle(lambda: api.control(body))
            self._send(404, {"error": "not found"})

    return Handler


def serve(trainer: Trainer, port: int) -> tuple[ThreadingHTTPServer, Api]:
    api = Api(trainer)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(api))
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, api
