"""First-time setup: download KataGo, its training scripts and PyTorch into the home folder."""

from __future__ import annotations

import io
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

from . import KATAGO_VERSION
from .settings import Paths, Settings

RELEASES = f"https://github.com/lightvector/KataGo/releases/download/{KATAGO_VERSION}/"
SOURCE_ZIP = f"https://github.com/lightvector/KataGo/archive/refs/tags/{KATAGO_VERSION}.zip"
TORCH_CUDA_INDEX = "https://download.pytorch.org/whl/cu128"  # CUDA 12.8: the first to support RTX 50xx (Blackwell)

# Release asset per (os, backend).
ASSETS = {
    ("Windows", "opencl"): "opencl-windows-x64",
    ("Windows", "cuda"): "cuda12.8-cudnn9.8.0-windows-x64",
    ("Windows", "trt"): "trt10.9.0-cuda12.8-windows-x64",
    ("Windows", "eigen"): "eigenavx2-windows-x64",
    ("Linux", "opencl"): "opencl-linux-x64",
    ("Linux", "cuda"): "cuda12.8-cudnn9.8.0-linux-x64",
    ("Linux", "trt"): "trt10.9.0-cuda12.8-linux-x64",
    ("Linux", "eigen"): "eigen-linux-x64",
}

PACKAGE_DIR = Path(__file__).resolve().parent
BUNDLED_REFERENCE = PACKAGE_DIR.parent / "reference"


def say(msg: str) -> None:
    print(f"[setup] {msg}", flush=True)


def download(url: str, what: str) -> bytes:
    say(f"Downloading {what} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "dop-trainer"})
    with urllib.request.urlopen(req, timeout=60) as r:
        total = int(r.headers.get("Content-Length") or 0)
        buf = io.BytesIO()
        last = -1
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            buf.write(chunk)
            if total:
                pct = buf.tell() * 100 // total
                if pct // 10 != last // 10:
                    last = pct
                    print(f"  {pct}% of {total / 1e6:.0f} MB", flush=True)
    return buf.getvalue()


def install_katago(paths: Paths, backend: str, force: bool = False) -> None:
    marker = paths.katago_dir / "dop-backend.txt"
    want = f"{KATAGO_VERSION} {backend}"
    if paths.katago_exe.exists() and marker.exists() and marker.read_text().strip() == want and not force:
        say(f"KataGo {want} already installed")
        return
    system = platform.system()
    key = ASSETS.get((system, backend))
    if not key:
        raise SystemExit(f"No KataGo {backend} build for {system}. Use Windows or Linux (WSL works too).")
    name = f"katago-{KATAGO_VERSION}-{key}.zip"
    data = download(RELEASES + name, f"KataGo {KATAGO_VERSION} ({backend})")
    if paths.katago_dir.exists():
        shutil.rmtree(paths.katago_dir)
    paths.katago_dir.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(paths.katago_dir)
    if system != "Windows":
        exe = paths.katago_exe
        exe.chmod(exe.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    marker.write_text(want)
    say(f"KataGo installed in {paths.katago_dir}")


def install_source(paths: Paths, local_src: Path | None = None) -> None:
    """KataGo's Python training code and training configs, from the same release as the binary."""
    marker = paths.src_dir / "dop-version.txt"
    if marker.exists() and marker.read_text().strip() == KATAGO_VERSION and local_src is None:
        say(f"KataGo {KATAGO_VERSION} training scripts already installed")
        return
    if paths.src_dir.exists():
        shutil.rmtree(paths.src_dir)
    wanted = ("python/", "cpp/configs/")
    if local_src is not None:
        for sub in ("python", "cpp/configs"):
            shutil.copytree(local_src / sub, paths.src_dir / sub, ignore=shutil.ignore_patterns(".git", "__pycache__"))
    else:
        try:
            data = download(SOURCE_ZIP, f"KataGo {KATAGO_VERSION} training scripts")
        except Exception as e:  # e.g. codeload blocked: fall back to git
            say(f"Zip download failed ({e}); trying git")
            if not shutil.which("git"):
                raise SystemExit("Could not download KataGo's source. Check your internet connection and run setup again.")
            tmp = paths.home / "katago-src-git"
            shutil.rmtree(tmp, ignore_errors=True)
            subprocess.run(["git", "clone", "--depth", "1", "--branch", KATAGO_VERSION,
                            "https://github.com/lightvector/KataGo", str(tmp)], check=True)
            install_source(paths, tmp)
            shutil.rmtree(tmp, ignore_errors=True)
            return
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for info in z.infolist():
                parts = info.filename.split("/", 1)
                if len(parts) < 2 or not parts[1].startswith(wanted) or info.is_dir():
                    continue
                dst = paths.src_dir / parts[1]
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(z.read(info))
    marker.write_text(KATAGO_VERSION)
    say(f"Training scripts installed in {paths.src_dir}")


def install_reference(paths: Paths) -> None:
    """The MIT-licensed g170e-b10c128 network, used as a fixed yardstick in rating matches."""
    paths.reference_dir.mkdir(parents=True, exist_ok=True)
    for f in BUNDLED_REFERENCE.glob("*.bin.gz"):
        dst = paths.reference_dir / f.name
        if not dst.exists():
            shutil.copy2(f, dst)
            say(f"Reference network {f.name} ready")


def torch_info(python: str = sys.executable) -> dict:
    code = (
        "import json,torch\n"
        "d={'version':torch.__version__,'cuda':torch.cuda.is_available()}\n"
        "if d['cuda']:\n"
        "  d['device']=torch.cuda.get_device_name(0)\n"
        "  d['capability']='sm_%d%d'%torch.cuda.get_device_capability(0)\n"
        "  d['arch_list']=torch.cuda.get_arch_list()\n"
        "print(json.dumps(d))\n"
    )
    try:
        out = subprocess.run([python, "-c", code], capture_output=True, text=True, timeout=180)
        if out.returncode != 0:
            return {"error": out.stderr.strip().splitlines()[-1] if out.stderr.strip() else "torch failed to import"}
        return json.loads(out.stdout.strip().splitlines()[-1])
    except Exception as e:
        return {"error": str(e)}


def has_nvidia_gpu() -> bool:
    return shutil.which("nvidia-smi") is not None


def install_python_deps(want_cuda: bool) -> dict:
    info = torch_info()
    need_torch = "error" in info or (want_cuda and not info.get("cuda"))
    if need_torch:
        say("Installing PyTorch (about 3 GB, this takes a while) ...")
        cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "torch"]
        if want_cuda:
            cmd += ["--index-url", TORCH_CUDA_INDEX, "--extra-index-url", "https://pypi.org/simple"]
        subprocess.run(cmd, check=True)
    missing = [m for m in ("numpy", "psutil", "packaging")
               if subprocess.run([sys.executable, "-c", f"import {m}"], capture_output=True).returncode != 0]
    if missing:
        subprocess.run([sys.executable, "-m", "pip", "install", *missing], check=True)
    return torch_info()


def setup(home: Path, settings: Settings, local_src: Path | None = None, skip_torch: bool = False) -> None:
    paths = Paths(home)
    home.mkdir(parents=True, exist_ok=True)
    say(f"Home folder: {home}")
    install_katago(paths, settings.backend)
    install_source(paths, local_src)
    install_reference(paths)
    if not skip_torch:
        info = install_python_deps(want_cuda=has_nvidia_gpu())
        if "error" in info:
            raise SystemExit(f"PyTorch is not working: {info['error']}")
        if info.get("cuda"):
            cap = info.get("capability", "")
            arch = info.get("arch_list", [])
            if cap and arch and cap not in arch:
                raise SystemExit(f"PyTorch {info['version']} does not support your GPU ({cap}). "
                                 f"Reinstall it with: {sys.executable} -m pip install --upgrade torch --index-url {TORCH_CUDA_INDEX}")
            say(f"PyTorch {info['version']} will train on {info.get('device')}")
        else:
            say(f"PyTorch {info.get('version')} found no CUDA GPU; training will run on the CPU (very slow).")
    paths.ensure()
    settings.save(home)
    say("Setup finished.")


def katago_env(paths: Paths, backend: str) -> dict:
    """Environment for running KataGo. The CUDA build borrows the CUDA/cuDNN DLLs that ship inside PyTorch."""
    env = dict(os.environ)
    if backend in ("cuda", "trt"):
        try:
            import torch  # noqa: F401
            lib = Path(torch.__file__).parent / "lib"
            env["PATH"] = str(lib) + os.pathsep + env.get("PATH", "")
            if platform.system() != "Windows":
                env["LD_LIBRARY_PATH"] = str(lib) + os.pathsep + env.get("LD_LIBRARY_PATH", "")
        except Exception:
            pass
    return env
