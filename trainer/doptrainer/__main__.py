"""Command line: python -m doptrainer setup | run | serve | status"""

from __future__ import annotations

import argparse
import json
import signal
import sys
import time
import urllib.request
from pathlib import Path

from . import KATAGO_VERSION, __version__
from .settings import Settings, default_home

BANNER = f"Dop Trainer {__version__} (KataGo {KATAGO_VERSION})"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="doptrainer", description=BANNER)
    ap.add_argument("--home", type=Path, default=None, help="data folder (default: ~/DopTrainer)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("setup", help="download KataGo, its training scripts and PyTorch")
    s.add_argument("--backend", choices=["opencl", "cuda", "trt", "eigen"], help="KataGo build (default opencl)")
    s.add_argument("--preset", choices=["gpu", "tiny"], help="training sizes (default gpu)")
    s.add_argument("--katago-src", type=Path, help="use this KataGo source checkout instead of downloading")
    s.add_argument("--skip-torch", action="store_true", help="do not install or check PyTorch")

    r = sub.add_parser("run", help="train forever and serve the website")
    r.add_argument("--allow-origin", action="append", default=[], help="another website address allowed to connect")
    r.add_argument("--port", type=int)

    v = sub.add_parser("serve", help="only serve the website (play the networks trained so far)")
    v.add_argument("--allow-origin", action="append", default=[])
    v.add_argument("--port", type=int)

    sub.add_parser("status", help="print the running trainer's status")

    args = ap.parse_args(argv)
    home = (args.home or default_home()).expanduser().resolve()
    settings = Settings.load(home)

    if args.cmd == "setup":
        from .install import setup
        if args.backend:
            settings.backend = args.backend
        if args.preset:
            settings.apply_preset(args.preset)
        setup(home, settings, args.katago_src, args.skip_torch)
        return 0

    if args.cmd == "status":
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{settings.port}/api/status", timeout=5) as r:
                print(json.dumps(json.load(r), indent=2))
            return 0
        except Exception as e:
            print(f"The trainer is not running ({e})")
            return 1

    from .loop import Trainer
    from .server import serve
    from .settings import Paths

    if not Paths(home).katago_exe.exists():
        print("Run setup first:  python -m doptrainer setup")
        return 1
    for o in args.allow_origin:
        o = o.rstrip("/")
        if o not in settings.allowed_origins:
            settings.allowed_origins.append(o)
            settings.save(home)
    port = args.port or settings.port
    trainer = Trainer(home, settings)
    httpd, api = serve(trainer, port)
    print(BANNER)
    print(f"Home folder: {home}")
    print(f"Website connection: http://127.0.0.1:{port}  (open the Trainer page on the Doppelgänger site)")
    print("Press Ctrl+C to stop. Training picks up where it left off next time.\n", flush=True)

    def on_signal(*_):
        print("\nStopping ...", flush=True)
        trainer.stop()

    # Stop the running step too (self-play, training ...), so nothing keeps using the GPU.
    for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), on_signal)

    try:
        if args.cmd == "serve":
            trainer.set_phase("stopped", "training is off; you can still play the networks trained so far")
            while not trainer.stop_event.is_set():
                time.sleep(0.5)
        else:
            trainer.loop()
    except Exception:
        # Keep serving so the website can show the error, until Ctrl+C.
        while not trainer.stop_event.is_set():
            time.sleep(0.5)
        return 1
    finally:
        api.engine.close()
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
