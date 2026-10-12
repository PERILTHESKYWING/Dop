#!/usr/bin/env python3
"""
DOPPELGANGER PC helper: runs native KataGo with a big network on this computer's graphics
card and lets the site use it. While it runs, the site on this computer analyses with it
(Lizzie-class speed and strength, instead of what a browser can do), and your phone can use
it too, at home or away, over a free Cloudflare tunnel (no account; the pairing code guards
it). Link the phone once by scanning the code on the PC's Settings page; when the helper
restarts with a new tunnel address, the phone finds it again through the site.

Nothing to install but Python 3 (standard library only). On first start it downloads
KataGo (OpenCL build, works with NVIDIA, AMD and Intel graphics drivers) and the network
into ~/DopPC, then keeps them there.

    python dop_pc.py                 # kata1 b18 network (strong, ~100 MB)
    python dop_pc.py --network b28   # kata1 b28 (strongest, ~260 MB, needs a good GPU)
    python dop_pc.py --katago "C:/LizzieYzy/katago/katago.exe" --model "C:/LizzieYzy/weights/xxx.bin.gz"
    python dop_pc.py --no-tunnel     # this computer only (no phone)
    python dop_pc.py --train 8       # train the site's small network on this graphics card for 8 hours
                                     # (needs PyTorch; start-training-windows.bat installs it)

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

VERSION = "1.1"
KATAGO_VERSION = "v1.18.1"
NETWORKS = {
    "b18": ("kata1-b18c384nbt", "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz"),
    "b28": ("kata1-b28c512nbt", "kata1-b28c512nbt-s8326494464-d4628051565.bin.gz"),
}
NET_URL = "https://media.katagotraining.org/uploaded/networks/models/kata1/"
# The site's own small network, for the Doppelganger copy's moves: the copy learned its
# habits from this network's view, so the PC answers with the same one.
SMALL_NET = "g170e-b10c128-s1141046784-d204142634.bin.gz"
SMALL_URLS = [
    "https://cdn.jsdelivr.net/gh/saigo-online/katago-webgpu@d5ad1c0423dba989c60a2f06b1848e7eec2b5941/cpp/tests/models/" + SMALL_NET,
    "https://raw.githubusercontent.com/saigo-online/katago-webgpu/d5ad1c0423dba989c60a2f06b1848e7eec2b5941/cpp/tests/models/" + SMALL_NET,
]
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


def find_small(sites):
    dest = os.path.join(HOME, SMALL_NET)
    for url in [s + "/models/" + SMALL_NET for s in sites] + SMALL_URLS:
        try:
            return download(url, dest)
        except Exception as e:  # noqa: BLE001 (try the next copy)
            log("could not download", url, e)
    return None


def find_model(args):
    if args.model:
        return args.model, os.path.basename(args.model).split(".bin")[0]
    net_id, name = NETWORKS[args.network]
    return download(NET_URL + name, os.path.join(HOME, name)), net_id


class KataGo:
    """The `katago analysis` JSON engine, with answers routed back by query id."""

    def __init__(self, binary, model, threads, name="analysis", search_threads=16):
        cfg = os.path.join(HOME, name + ".cfg")
        with open(cfg, "w") as f:
            f.write(
                "\n".join(
                    [
                        f"logDir = {os.path.join(HOME, 'logs')}",
                        f"numAnalysisThreads = {threads}",
                        f"numSearchThreadsPerAnalysisThread = {search_threads}",
                        "nnMaxBatchSize = 64",
                        "nnCacheSizePowerOfTwo = 22",
                        "nnMutexPoolSizePowerOfTwo = 17",
                        "reportAnalysisWinratesAs = BLACK",
                        "wideRootNoise = 0.0",
                        # The small network answers like the site's own copy: the board as given,
                        # not turned at random (the site asks for turned boards itself).
                        "nnRandomize = " + ("false" if name == "small" else "true"),
                        "",
                    ]
                )
            )
        self.name = name
        log("starting KataGo:", binary, "(" + name + ")")
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
                log("KataGo is ready" if self.name == "analysis" else "KataGo (small network) is ready")
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


class Engines:
    """The big network for analysis, and the site's small network (started the first time
    it is asked for) for the Doppelganger copy's moves."""

    def __init__(self, big, binary, sites):
        self.big = big
        self.binary = binary
        self.sites = sites
        self.small = None
        self.small_started = False
        self.lock = threading.Lock()

    def get_small(self):
        with self.lock:
            if not self.small_started:
                self.small_started = True

                def start():
                    model = find_small(self.sites)
                    if model:
                        self.small = KataGo(self.binary, model, 2, name="small", search_threads=1)

                threading.Thread(target=start, daemon=True).start()
            return self.small


class Guard:
    """Wrong pairing codes: after 20 in a minute, everyone waits a minute (the helper is
    reachable from the internet through the tunnel)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.wrong = []
        self.until = 0.0

    def locked(self):
        return time.time() < self.until

    def failed(self):
        with self.lock:
            now = time.time()
            self.wrong = [t for t in self.wrong if now - t < 60] + [now]
            if len(self.wrong) >= 20:
                self.until = now + 60
                self.wrong = []
                log("too many wrong pairing codes: refusing everyone for a minute")


def make_handler(engines, token, origins, info):
    allowed = [re.compile("^" + o + "$") for o in origins]
    kg = engines.big
    guard = Guard()

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
                small = engines.small
                return self.reply(200, dict(info, app="dop-pc", version=VERSION, ready=kg.ready.is_set(), visits=kg.visits, uptime=int(up),
                                            small=bool(small and small.ready.is_set())))
            if self.path.startswith("/pair"):
                # Only the site itself (an allowed origin, checked by the browser) can read the code.
                if not self.headers.get("Origin") or not self.origin_ok():
                    return self.reply(403, {"error": "not allowed"})
                return self.reply(200, {"token": token})
            self.reply(404, {"error": "not found"})

        def do_POST(self):
            if guard.locked():
                return self.reply(429, {"error": "too many wrong pairing codes; wait a minute"})
            if not self.origin_ok() or not secrets.compare_digest(self.headers.get("X-Dop-Token") or "", token):
                guard.failed()
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
            eng = kg
            if body.get("net") == "small":
                # Answer at once while the small network starts; the site looks itself meanwhile.
                eng = engines.get_small()
                if eng is None or not eng.ready.is_set():
                    return self.reply(503, {"error": "the small network is starting"})
            elif not kg.ready.wait(timeout=600):
                return self.reply(503, {"error": "KataGo is still starting"})
            query = {k: v for k, v in body.items() if k in ALLOWED_KEYS}
            query.setdefault("rules", "chinese")
            query.setdefault("boardXSize", 19)
            query.setdefault("boardYSize", query["boardXSize"])
            query["maxVisits"] = max(1, min(int(query.get("maxVisits", 500)), 1_000_000))
            turns = len(query.get("analyzeTurns") or [None])
            stream = bool(query.get("reportDuringSearchEvery"))
            qid, q = eng.send(query)
            try:
                if stream:
                    # One JSON line per update until the search ends (or the browser goes away).
                    self.send_response(200)
                    self.cors()
                    self.send_header("Content-Type", "application/x-ndjson")
                    # The tunnel must pass each line on at once, not gather or compress them.
                    self.send_header("Cache-Control", "no-cache, no-transform")
                    self.send_header("X-Accel-Buffering", "no")
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
                eng.terminate(qid)
            finally:
                eng.done(qid)

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
            # The address it prints in a box; error lines name api.trycloudflare.com, which is not it.
            m = re.search(r"https://(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com", line)
            if m:
                found.put(m.group(0))
            elif " ERR " in line or "error" in line.lower() or "failed" in line.lower():
                log("tunnel:", line.strip()[:200])
        found.put(None)  # cloudflared stopped

    threading.Thread(target=watch, daemon=True).start()
    try:
        url = found.get(timeout=60)
    except queue.Empty:
        url = None
    if not url:
        log("the tunnel did not start, so only this computer can use the helper (check the internet connection and start again)")
    return url


def site_origins():
    """The address of the site this helper was downloaded from (site.txt, written into the
    zip when the site is built), so a site on its own domain works without --origin."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site.txt")
    if not os.path.exists(path):
        return []
    return [re.escape(s) for s in site_urls()]


def site_urls():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site.txt")
    if not os.path.exists(path):
        return []
    return [line.strip().rstrip("/") for line in open(path) if line.strip().startswith("https://")]


def announce(sites, token, url):
    """Tell the site where this helper is now (a quick tunnel gets a new address on every
    start), so a phone already linked with the pairing code finds it again by itself. Needs
    the site's account storage; without it the phone scans the code again."""
    body = json.dumps({"code": token, "address": url}).encode()
    for site in sites:
        try:
            req = urllib.request.Request(site + "/api/account?action=pc-here", data=body, method="POST",
                                         headers={"content-type": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as r:
                if r.status == 200:
                    log("the site knows the new address; linked phones find it by themselves")
                    return True
        except Exception as e:  # noqa: BLE001
            if getattr(e, "code", None) == 503:
                log("the site has no account storage, so after a restart scan the code on the PC's Settings page again")
                return False
    return False


REPO = "PERILTHESKYWING/Dop"


def train(hours, upload):
    """Evolve the site's small network on this computer's graphics card: fetch the
    training scripts and run scripts/student/evolve_local.py (it downloads the cloud
    training's data and sends a winner back to the cloud arena with --upload)."""
    try:
        import torch  # noqa: F401
    except ImportError:
        log("Training needs PyTorch. For an NVIDIA RTX 50-series card run:")
        log("  " + sys.executable + " -m pip install numpy torch --index-url https://download.pytorch.org/whl/cu128")
        sys.exit(1)
    code = os.path.join(HOME, "train-code")
    zip_path = os.path.join(HOME, "train-code.zip")
    if os.path.exists(zip_path):
        os.remove(zip_path)
    download(f"https://codeload.github.com/{REPO}/zip/refs/heads/main", zip_path)
    shutil.rmtree(code, ignore_errors=True)
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            if "/scripts/student/" in name or name.endswith("data/student/seed-champion.pt"):
                z.extract(name, code)
    root = next(os.path.join(code, d) for d in os.listdir(code))
    cmd = [sys.executable, os.path.join(root, "scripts", "student", "evolve_local.py"), "--hours", str(hours),
           "--dir", os.path.join(HOME, "training")]
    if upload:
        cmd.append("--upload")
    log("Training for", hours, "hours. Keep this window open; it can be stopped with Ctrl+C and continues next time.")
    sys.exit(subprocess.call(cmd))


def main():
    ap = argparse.ArgumentParser(description="DOPPELGANGER PC helper (native KataGo for the site)")
    ap.add_argument("--network", choices=sorted(NETWORKS), default="b18")
    ap.add_argument("--katago", help="use this KataGo binary (for example LizzieYzy's)")
    ap.add_argument("--model", help="use this network file")
    ap.add_argument("--threads", type=int, default=4, help="positions searched at once")
    ap.add_argument("--origin", action="append", default=[], help="another site address allowed to use the helper (regex)")
    ap.add_argument("--tunnel", action="store_true", help=argparse.SUPPRESS)  # the default now
    ap.add_argument("--no-tunnel", action="store_true", help="this computer only: no tunnel for the phone")
    ap.add_argument("--site", action="append", default=[], help="the site's address (https://...), if not in site.txt")
    ap.add_argument("--train", type=float, metavar="HOURS", help="train the site's small network on this graphics card instead")
    ap.add_argument("--upload", action="store_true", help="with --train: send a winner to the cloud arena (needs GITHUB_TOKEN)")
    args = ap.parse_args()
    os.makedirs(HOME, exist_ok=True)
    if args.train:
        train(args.train, args.upload)
    tok_file = os.path.join(HOME, "pairing-code.txt")
    if os.path.exists(tok_file):
        token = open(tok_file).read().strip()
    else:
        token = "-".join(secrets.token_hex(2).upper() for _ in range(3))
        with open(tok_file, "w") as f:
            f.write(token)
    binary = find_katago(args)
    model, net_id = find_model(args)
    sites = [s.rstrip("/") for s in args.site] + site_urls()
    kg = KataGo(binary, model, args.threads)
    engines = Engines(kg, binary, sites)
    info = {"network": net_id, "katago": os.path.basename(binary), "backend": "opencl" if "opencl" in binary.lower() else "native"}
    origins = DEFAULT_ORIGINS + [re.escape(s) for s in sites] + args.origin
    server = ThreadingHTTPServer(("127.0.0.1", PORT), make_handler(engines, token, origins, info))
    log(f"PC helper on http://127.0.0.1:{PORT} with {net_id}. Keep this window open.")
    if not args.no_tunnel:
        url = start_tunnel()
        if url:
            info["tunnel"] = url
            log("Phone: open the site's Settings page on this PC and scan the code with your phone.")
            log("Or on the phone: Settings > PC helper, address", url, "and pairing code", token)
            threading.Thread(target=announce, args=(sites, token, url), daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        kg.proc.terminate()
        if engines.small:
            engines.small.proc.terminate()


if __name__ == "__main__":
    main()
