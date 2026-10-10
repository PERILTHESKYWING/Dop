#!/usr/bin/env python3
"""
DOPPELGANGER PC helper: runs native KataGo with a big network on this computer's graphics
card and lets the site use it. While it runs, the site on this computer analyses with it
(Lizzie-class speed and strength, instead of what a browser can do), and the analyses it
makes sync to your phone through your account. Optionally (--tunnel) your phone can use it
live too, over a free Cloudflare tunnel.

Nothing to install but Python 3 (standard library only). On first start it downloads
KataGo (OpenCL build, works with NVIDIA, AMD and Intel graphics drivers) and the network
into ~/DopPC, then keeps them there.

    python dop_pc.py                 # kata1 b18 network (strong, ~100 MB)
    python dop_pc.py --network b28   # kata1 b28 (strongest, ~260 MB, needs a good GPU)
    python dop_pc.py --katago "C:/LizzieYzy/katago/katago.exe" --model "C:/LizzieYzy/weights/xxx.bin.gz"
    python dop_pc.py --tunnel        # also reachable from your phone (prints an address and a code)

The first start with the OpenCL build tunes KataGo for your graphics card, which takes a
few minutes once.
"""
import argparse
import json
import os
import platform
import queue
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.0"
KATAGO_VERSION = "v1.18.1"
NETWORKS = {
    "b18": ("kata1-b18c384nbt", "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz"),
    "b28": ("kata1-b28c512nbt", "kata1-b28c512nbt-s8326494464-d4628051565.bin.gz"),
}
NET_URL = "https://media.katagotraining.org/uploaded/networks/models/kata1/"
PORT = 7474
HOME = os.path.join(os.path.expanduser("~"), "DopPC")
DEFAULT_ORIGINS = [
    r"https://[a-z0-9-]+\.vercel\.app",
    r"http://localhost(:\d+)?",
    r"http://127\.0\.0\.1(:\d+)?",
    r"https://periltheskywing\.github\.io",
]


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    log("downloading", url)
    tmp = dest + ".part"
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        last = 0.0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            got += len(chunk)
            if time.time() - last > 2:
                last = time.time()
                pct = f" {got * 100 // total}%" if total else ""
                print(f"  {got >> 20} MB{pct}", end="\r", flush=True)
    os.replace(tmp, dest)
    print()
    return dest


def find_katago(args):
    if args.katago:
        return args.katago
    system = platform.system()
    if system == "Windows":
        asset, exe = f"katago-{KATAGO_VERSION}-opencl-windows-x64.zip", "katago.exe"
    elif system == "Linux":
        asset, exe = f"katago-{KATAGO_VERSION}-opencl-linux-x64.zip", "katago"
    else:
        found = shutil.which("katago")
        if found:
            return found
        sys.exit("On macOS install KataGo with Homebrew (brew install katago), then run this again.")
    folder = os.path.join(HOME, "katago-" + KATAGO_VERSION)
    path = os.path.join(folder, exe)
    if not os.path.exists(path):
        os.makedirs(folder, exist_ok=True)
        z = download(f"https://github.com/lightvector/KataGo/releases/download/{KATAGO_VERSION}/{asset}", os.path.join(HOME, asset))
        with zipfile.ZipFile(z) as zf:
            zf.extractall(folder)
        if system != "Windows":
            os.chmod(path, 0o755)
    return path


def find_model(args):
    if args.model:
        return args.model, os.path.basename(args.model).split(".bin")[0]
    net_id, name = NETWORKS[args.network]
    return download(NET_URL + name, os.path.join(HOME, name)), net_id


class KataGo:
    """The `katago analysis` JSON engine, with answers routed back by query id."""

    def __init__(self, binary, model, threads):
        cfg = os.path.join(HOME, "analysis.cfg")
        with open(cfg, "w") as f:
            f.write(
                "\n".join(
                    [
                        f"logDir = {os.path.join(HOME, 'logs')}",
                        f"numAnalysisThreads = {threads}",
                        "numSearchThreadsPerAnalysisThread = 16",
                        "nnMaxBatchSize = 64",
                        "nnCacheSizePowerOfTwo = 22",
                        "nnMutexPoolSizePowerOfTwo = 17",
                        "reportAnalysisWinratesAs = BLACK",
                        "wideRootNoise = 0.0",
                        "",
                    ]
                )
            )
        log("starting KataGo:", binary)
        self.proc = subprocess.Popen(
            [binary, "analysis", "-config", cfg, "-model", model],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.lock = threading.Lock()
        self.waiting = {}
        self.ready = threading.Event()
        self.visits = 0
        self.started = time.time()
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._errors, daemon=True).start()

    def _errors(self):
        for line in self.proc.stderr:
            line = line.rstrip()
            if "Started, ready to begin handling requests" in line:
                self.ready.set()
                log("KataGo is ready")
            elif line and ("tun" in line.lower() or "error" in line.lower() or "Loaded" in line or "Found" in line):
                log("katago:", line[:200])
        log("KataGo stopped")

    def _read(self):
        for line in self.proc.stdout:
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            q = self.waiting.get(msg.get("id"))
            if q is not None:
                if not msg.get("isDuringSearch"):
                    self.visits += msg.get("rootInfo", {}).get("visits", 0)
                q.put(msg)

    def send(self, query):
        qid = "q" + secrets.token_hex(6)
        query = dict(query, id=qid)
        q = queue.Queue()
        self.waiting[qid] = q
        with self.lock:
            self.proc.stdin.write(json.dumps(query) + "\n")
            self.proc.stdin.flush()
        return qid, q

    def done(self, qid):
        self.waiting.pop(qid, None)

    def terminate(self, qid):
        with self.lock:
            self.proc.stdin.write(json.dumps({"id": "t" + qid, "action": "terminate", "terminateId": qid}) + "\n")
            self.proc.stdin.flush()


ALLOWED_KEYS = {
    "moves", "initialStones", "initialPlayer", "komi", "rules", "boardXSize", "boardYSize", "maxVisits", "analyzeTurns",
    "includeOwnership", "includePolicy", "includePVVisits", "reportDuringSearchEvery", "allowMoves", "avoidMoves",
}


def make_handler(kg, token, origins, info):
    allowed = [re.compile("^" + o + "$") for o in origins]

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *a):
            pass

        def origin_ok(self):
            o = self.headers.get("Origin")
            return o is None or any(p.match(o) for p in allowed)

        def cors(self):
            o = self.headers.get("Origin")
            if o and any(p.match(o) for p in allowed):
                self.send_header("Access-Control-Allow-Origin", o)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "content-type, x-dop-token")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                # Chrome's Private Network Access: a public site may call this computer.
                self.send_header("Access-Control-Allow-Private-Network", "true")

        def reply(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self.send_response(204)
            self.cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            if self.path.startswith("/status"):
                up = max(1.0, time.time() - kg.started)
                return self.reply(200, dict(info, app="dop-pc", version=VERSION, ready=kg.ready.is_set(), visits=kg.visits, uptime=int(up)))
            if self.path.startswith("/pair"):
                # Only the site itself (an allowed origin, checked by the browser) can read the code.
                if not self.headers.get("Origin") or not self.origin_ok():
                    return self.reply(403, {"error": "not allowed"})
                return self.reply(200, {"token": token})
            self.reply(404, {"error": "not found"})

        def do_POST(self):
            if not self.origin_ok() or self.headers.get("X-Dop-Token") != token:
                return self.reply(403, {"error": "wrong or missing pairing code"})
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self.reply(400, {"error": "bad json"})
            if self.path.startswith("/stop"):
                kg.terminate(str(body.get("id", "")))
                return self.reply(200, {"ok": True})
            if not self.path.startswith("/analyze"):
                return self.reply(404, {"error": "not found"})
            if not kg.ready.wait(timeout=600):
                return self.reply(503, {"error": "KataGo is still starting"})
            query = {k: v for k, v in body.items() if k in ALLOWED_KEYS}
            query.setdefault("rules", "chinese")
            query.setdefault("boardXSize", 19)
            query.setdefault("boardYSize", query["boardXSize"])
            query["maxVisits"] = max(1, min(int(query.get("maxVisits", 500)), 1_000_000))
            turns = len(query.get("analyzeTurns") or [None])
            stream = bool(query.get("reportDuringSearchEvery"))
            qid, q = kg.send(query)
            try:
                if stream:
                    # One JSON line per update until the search ends (or the browser goes away).
                    self.send_response(200)
                    self.cors()
                    self.send_header("Content-Type", "application/x-ndjson")
                    self.send_header("Transfer-Encoding", "chunked")
                    self.send_header("X-Query-Id", qid)
                    self.end_headers()
                    self.chunk(json.dumps({"queryId": qid}) + "\n")
                    while True:
                        msg = q.get(timeout=3600)
                        self.chunk(json.dumps(msg) + "\n")
                        if "error" in msg or not msg.get("isDuringSearch"):
                            break
                    self.chunk("")
                else:
                    out = []
                    while len(out) < turns:
                        msg = q.get(timeout=3600)
                        if "error" in msg:
                            return self.reply(400, msg)
                        if not msg.get("isDuringSearch"):
                            out.append(msg)
                    self.reply(200, sorted(out, key=lambda m: m.get("turnNumber", 0)))
            except (BrokenPipeError, ConnectionResetError):
                kg.terminate(qid)
            finally:
                kg.done(qid)

        def chunk(self, text):
            data = text.encode()
            self.wfile.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
            self.wfile.flush()

    return Handler


def start_tunnel():
    """A free Cloudflare quick tunnel (no account): a public https address for this helper."""
    system = platform.system()
    name = {"Windows": "cloudflared-windows-amd64.exe", "Linux": "cloudflared-linux-amd64"}.get(system)
    exe = shutil.which("cloudflared")
    if not exe and name:
        exe = download("https://github.com/cloudflare/cloudflared/releases/latest/download/" + name, os.path.join(HOME, name))
        if system != "Windows":
            os.chmod(exe, 0o755)
    if not exe:
        log("install cloudflared to use --tunnel on this system")
        return None
    proc = subprocess.Popen([exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{PORT}"], stderr=subprocess.PIPE, text=True)
    found = queue.Queue()

    def watch():
        for line in proc.stderr:
            m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            if m:
                found.put(m.group(0))

    threading.Thread(target=watch, daemon=True).start()
    try:
        return found.get(timeout=60)
    except queue.Empty:
        log("the tunnel did not start")
        return None


def site_origins():
    """The address of the site this helper was downloaded from (site.txt, written into the
    zip when the site is built), so a site on its own domain works without --origin."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site.txt")
    if not os.path.exists(path):
        return []
    return [re.escape(line.strip().rstrip("/")) for line in open(path) if line.strip().startswith("https://")]


def main():
    ap = argparse.ArgumentParser(description="DOPPELGANGER PC helper (native KataGo for the site)")
    ap.add_argument("--network", choices=sorted(NETWORKS), default="b18")
    ap.add_argument("--katago", help="use this KataGo binary (for example LizzieYzy's)")
    ap.add_argument("--model", help="use this network file")
    ap.add_argument("--threads", type=int, default=4, help="positions searched at once")
    ap.add_argument("--origin", action="append", default=[], help="another site address allowed to use the helper (regex)")
    ap.add_argument("--tunnel", action="store_true", help="also reachable from your phone through a free Cloudflare tunnel")
    args = ap.parse_args()
    os.makedirs(HOME, exist_ok=True)
    tok_file = os.path.join(HOME, "pairing-code.txt")
    if os.path.exists(tok_file):
        token = open(tok_file).read().strip()
    else:
        token = "-".join(secrets.token_hex(2).upper() for _ in range(3))
        with open(tok_file, "w") as f:
            f.write(token)
    binary = find_katago(args)
    model, net_id = find_model(args)
    kg = KataGo(binary, model, args.threads)
    info = {"network": net_id, "katago": os.path.basename(binary), "backend": "opencl" if "opencl" in binary.lower() else "native"}
    server = ThreadingHTTPServer(("127.0.0.1", PORT), make_handler(kg, token, DEFAULT_ORIGINS + site_origins() + args.origin, info))
    log(f"PC helper on http://127.0.0.1:{PORT} with {net_id}. Keep this window open; open the site on this computer.")
    if args.tunnel:
        url = start_tunnel()
        if url:
            log("On your phone: Settings > Engine > PC helper, address", url, "and pairing code", token)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        kg.proc.terminate()


if __name__ == "__main__":
    main()
